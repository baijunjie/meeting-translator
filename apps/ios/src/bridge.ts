// iOS（Capacitor）平台桥接：实现 @rt/core 的 AppBridge，注入给 @rt/ui。
//
// 各能力来源：
//  - 设置 / 归档持久化：@capacitor/preferences（异步 KV），纯逻辑复用 @rt/core
//    （makeDefaults / withDefaults / listSummaries / makeArchiveId / toSummary）。
//  - ASR：原生 Capacitor 插件 RealtimeAsr（sherpa-onnx 端上识别 + AVAudioEngine 采集），
//    通过 'partial' / 'segment' / 'status' 事件回吐；startPipeline/stopPipeline 即启停整个会话
//    （含原生采麦），无需 JS 侧送音频。
//  - 翻译：segment 到达且开启翻译时翻成母语并触发 onTranslation，两种引擎：
//    · engine==='cloud'  → JS 侧 @rt/core CloudTranslator（WebView 内 fetch）。
//    · 否则（设备端）     → 原生插件 RealtimeTranslate（Apple Translation 框架，iOS 18+，离线）。
//      不可用（iOS<18 / 不支持语言对 / 语言包缺失）时发 translation:status error 提示改用云翻译。
//    繁體等目标脚本后处理沿用 M2M100_SPEC.toScript（两条路径一致）。
//
// 实现 vs 桩：
//  - 已实现（纯 JS，可在此环境验证类型 + 打包）：设置、归档、云翻译、事件转发、回调注册。
//  - 依赖原生插件（此环境无 iOS 工具链，未编译/未运行）：startPipeline / stopPipeline /
//    getMicStatus / openMicSettings / getSetupStatus / downloadAsrModels。无原生壳时
//    （如纯浏览器预览）这些调用会 reject，桥接已做兜底，不会崩 UI。

import { Preferences } from '@capacitor/preferences';
import {
  makeDefaults,
  withDefaults,
  listSummaries,
  makeArchiveId,
  CloudTranslator,
  M2M100_SPEC,
  planTranslation,
} from '@rt/core';
import type {
  AppBridge,
  AppSettings,
  ArchiveLine,
  ArchiveRecord,
  ArchiveSummary,
  CloudTranslationConfig,
  StartResult,
  MicPermission,
  SetupStatus,
  SetupProgress,
  SegmentPayload,
  PartialPayload,
  TranslationPayload,
  StatusPayload,
  TranslationStatusPayload,
} from '@rt/core';
import { RealtimeAsr, RealtimeTranslate } from '../native-plugin';

const SETTINGS_KEY = 'mt.settings';
const ARCHIVES_KEY = 'mt.archives';

export function createIosBridge(): AppBridge {
  // —— UI 注册的回调（mountApp → registerTranscriptionListeners 时注入） ——
  let segmentCb: ((s: SegmentPayload) => void) | null = null;
  let partialCb: ((p: PartialPayload) => void) | null = null;
  let translationCb: ((t: TranslationPayload) => void) | null = null;
  let statusCb: ((s: StatusPayload) => void) | null = null;
  let translationStatusCb: ((s: TranslationStatusPayload) => void) | null = null;
  let setupProgressCb: ((p: SetupProgress) => void) | null = null;

  // —— 缓存设置：翻译热路径（segment 到达）同步读开关/引擎/母语，免得每段都 await KV。
  //    翻译开关就是 cachedSettings.translation.enabled，改后即时生效并落盘，不再另存一份布尔。 ——
  let cachedSettings: AppSettings | null = null;

  // ---- 持久化：设置 ----
  async function readSettings(): Promise<AppSettings> {
    const defaults = makeDefaults(navigator.languages ? [...navigator.languages] : []);
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    let raw: unknown = null;
    if (value) {
      try {
        raw = JSON.parse(value);
      } catch {
        raw = null;
      }
    }
    cachedSettings = withDefaults(raw, defaults);
    return cachedSettings;
  }

  // 写设置：补齐/校验后落盘并刷新缓存。所有写入路径（保存设置、切翻译开关）都走这里。
  async function writeSettings(next: AppSettings): Promise<AppSettings> {
    cachedSettings = withDefaults(next, makeDefaults([]));
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(cachedSettings) });
    return cachedSettings;
  }

  // 首次读取去重：启动预读与 UI 首次 getSettings() 并发触发，共享同一次 Preferences 读；
  // 读完即释放，之后再调用会重新读盘（保存后仍能拿到最新值）。
  let readInFlight: Promise<AppSettings> | null = null;
  function readSettingsOnce(): Promise<AppSettings> {
    if (!readInFlight) {
      readInFlight = readSettings().finally(() => {
        readInFlight = null;
      });
    }
    return readInFlight;
  }

  // ---- 持久化：归档 ----
  async function readArchives(): Promise<ArchiveRecord[]> {
    const { value } = await Preferences.get({ key: ARCHIVES_KEY });
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as ArchiveRecord[]) : [];
    } catch {
      return [];
    }
  }

  async function writeArchives(records: ArchiveRecord[]): Promise<void> {
    await Preferences.set({ key: ARCHIVES_KEY, value: JSON.stringify(records) });
  }

  // 「翻译中 → 就绪/失败」统一外壳：loading 状态、结果/错误上报、结束等待动画都在这里，
  // 具体产出交给 produce（返回已做好脚本归一化的最终译文）。云 / 设备端共用，避免两份重复。
  async function runTranslation(
    id: number,
    label: string,
    produce: () => Promise<string>,
  ): Promise<void> {
    translationStatusCb?.({ state: 'loading' });
    try {
      const text = await produce();
      translationStatusCb?.({ state: 'ready' });
      translationCb?.({ id, text });
    } catch (e) {
      console.error(label, e);
      translationStatusCb?.({ state: 'error', error: e instanceof Error ? e.message : String(e) });
      translationCb?.({ id, text: '' }); // 结束等待动画
    }
  }

  // ---- 翻译：segment 到达时按当前设置翻成母语（云 / 设备端两条路径） ----
  async function translateSegment(seg: SegmentPayload): Promise<void> {
    const s = cachedSettings ?? (await readSettingsOnce());
    if (!s.translation.enabled) return;

    // 同语言是否翻、如何翻的判定统一在 @rt/core.planTranslation，三端一致。
    const plan = planTranslation(M2M100_SPEC, seg.lang, s.nativeLang, seg.text);
    if (plan.kind === 'skip') return; // 同语言且字形一致：不发 pending，UI 不显示等待动画
    if (plan.kind === 'script') {
      // 仅简繁字形不同：直接产出转换后的原文，不经模型/云，也不显示等待动画。
      translationCb?.({ id: seg.id, text: plan.text });
      return;
    }

    // 标记该行进入「翻译中」：UI 在译文区显示等待动画，直到下方发出最终结果。
    translationCb?.({ id: seg.id, text: '', pending: true });

    // —— 设备端（非云）翻译：Apple Translation 框架（iOS 18+），原生插件 RealtimeTranslate。
    //    不可用/空结果按失败处理（抛出，走统一错误分支，提示改用云翻译）。 ——
    if (s.translation.engine !== 'cloud') {
      await runTranslation(seg.id, '[translate:device]', async () => {
        const r = await RealtimeTranslate.translate({
          text: seg.text,
          source: seg.lang,
          target: plan.targetCode,
        });
        if (r.unavailable || !r.text) {
          throw new Error(
            `On-device translation unavailable (${r.reason ?? 'unknown'}); switch to cloud translation in settings.`,
          );
        }
        return plan.toScript ? plan.toScript(r.text) : r.text;
      });
      return;
    }

    // —— 云翻译：已直接产出目标语，母语需要脚本归一化时再兜一层。 ——
    await runTranslation(seg.id, '[translate:cloud]', async () => {
      const text = await new CloudTranslator(s.translation.cloud).translate(seg.text, {
        source: seg.lang,
        target: plan.targetCode,
      });
      return plan.toScript ? plan.toScript(text) : text;
    });
  }

  // ---- 订阅原生 ASR 插件事件，转发给 UI 注册的回调 ----
  // 纯浏览器预览（无原生壳）下 addListener 会 reject，吞掉即可，不影响 UI 挂载。
  function subscribeNative(): void {
    void RealtimeAsr.addListener('partial', (p) => partialCb?.(p)).catch(() => undefined);
    void RealtimeAsr.addListener('segment', (seg) => {
      segmentCb?.(seg);
      void translateSegment(seg);
    }).catch(() => undefined);
    void RealtimeAsr.addListener('status', (s) => statusCb?.(s)).catch(() => undefined);
    void RealtimeAsr.addListener('setupProgress', (p) => setupProgressCb?.(p)).catch(
      () => undefined,
    );
  }
  subscribeNative();

  // ---- MicPermission 归一化（原生返回的字符串 → @rt/core 联合类型） ----
  function asMicPermission(v: string): MicPermission {
    return v === 'granted' ||
      v === 'denied' ||
      v === 'restricted' ||
      v === 'not-determined'
      ? v
      : 'unknown';
  }

  const api: AppBridge = {
    // ===== ASR 管线（原生）=====
    async startPipeline(): Promise<StartResult> {
      try {
        const r = await RealtimeAsr.start();
        return { ok: r.ok, error: r.error };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async stopPipeline(): Promise<{ ok: boolean }> {
      try {
        return await RealtimeAsr.stop();
      } catch {
        return { ok: false };
      }
    },
    // ===== 翻译开关（只改 enabled 并落盘） =====
    setTranslateEnabled(enabled: boolean): void {
      // 开关在 UI 渲染前必已 loadSettings 填好缓存；未就绪时忽略（正常不会发生）。
      if (!cachedSettings) return;
      cachedSettings.translation.enabled = enabled; // 内存即时生效，翻译热路径当拍可见
      void writeSettings(cachedSettings).catch((e) => console.error('[settings:save]', e));
    },

    // ===== 麦克风权限（原生）=====
    async getMicStatus(): Promise<MicPermission> {
      try {
        const r = await RealtimeAsr.getMicStatus();
        return asMicPermission(r.status);
      } catch {
        return 'unknown';
      }
    },
    openMicSettings(): void {
      void RealtimeAsr.openMicSettings().catch(() => undefined);
    },

    // ===== 设置（Preferences）=====
    getSettings(): Promise<AppSettings> {
      return readSettingsOnce();
    },
    saveSettings(settings: AppSettings): Promise<AppSettings> {
      return writeSettings(settings);
    },
    async testCloud(cfg: CloudTranslationConfig): Promise<{ ok: boolean; error?: string }> {
      // 真打一次最小翻译请求验证端点/密钥/模型；source≠target 避免被同语言短路直接返回原文。
      try {
        await new CloudTranslator(cfg).translate('hello', { source: 'en', target: 'ja' });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // ===== 首次安装 / 模型下载（原生）=====
    async getSetupStatus(): Promise<SetupStatus> {
      try {
        return await RealtimeAsr.getSetupStatus();
      } catch {
        // 无原生壳（纯浏览器预览）：当作就绪，避免卡在首启引导。
        return { asrReady: true };
      }
    },
    async downloadAsrModels(): Promise<{ ok: boolean; error?: string }> {
      try {
        return await RealtimeAsr.downloadModels();
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // ===== 归档（Preferences）=====
    async saveArchive(name: string, lines: ArchiveLine[]): Promise<ArchiveSummary[]> {
      const records = await readArchives();
      const createdAt = Date.now();
      const record: ArchiveRecord = {
        id: makeArchiveId(createdAt),
        name,
        createdAt,
        lines,
      };
      records.push(record);
      await writeArchives(records);
      return listSummaries(records);
    },
    async listArchives(): Promise<ArchiveSummary[]> {
      return listSummaries(await readArchives());
    },
    async getArchive(id: string): Promise<ArchiveRecord | null> {
      const records = await readArchives();
      return records.find((r) => r.id === id) ?? null;
    },
    async deleteArchive(id: string): Promise<ArchiveSummary[]> {
      const records = (await readArchives()).filter((r) => r.id !== id);
      await writeArchives(records);
      return listSummaries(records);
    },

    // ===== 回调注册（与 macOS preload 的 on* 语义一致：仅记录，事件由 subscribeNative 转发）=====
    onSetupProgress(cb: (progress: SetupProgress) => void): void {
      setupProgressCb = cb;
    },
    onSegment(cb: (segment: SegmentPayload) => void): void {
      segmentCb = cb;
    },
    onPartial(cb: (partial: PartialPayload) => void): void {
      partialCb = cb;
    },
    onTranslation(cb: (translation: TranslationPayload) => void): void {
      translationCb = cb;
    },
    onStatus(cb: (status: StatusPayload) => void): void {
      statusCb = cb;
    },
    onTranslationStatus(cb: (status: TranslationStatusPayload) => void): void {
      translationStatusCb = cb;
    },
  };

  // 预读一次设置，填充缓存（异步，不阻塞返回）。与 UI 首次 getSettings() 共享同一次读。
  void readSettingsOnce();

  return api;
}
