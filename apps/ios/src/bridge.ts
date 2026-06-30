// iOS（Capacitor）平台桥接：实现 @mt/core 的 AppBridge，注入给 @mt/ui。
//
// 各能力来源：
//  - 设置 / 归档持久化：@capacitor/preferences（异步 KV），纯逻辑复用 @mt/core
//    （makeDefaults / withDefaults / listSummaries / makeArchiveId / toSummary）。
//  - ASR：原生 Capacitor 插件 MeetingAsr（sherpa-onnx 端上识别 + AVAudioEngine 采集），
//    通过 'partial' / 'segment' / 'status' 事件回吐；startPipeline/stopPipeline 即启停整个会话
//    （含原生采麦），无需 JS 侧送音频。
//  - 翻译：segment 到达且开启翻译时翻成母语并触发 onTranslation，两种引擎：
//    · engine==='cloud'  → JS 侧 @mt/core CloudTranslator（WebView 内 fetch）。
//    · 否则（设备端）     → 原生插件 MeetingTranslate（Apple Translation 框架，iOS 18+，离线）。
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
} from '@mt/core';
import type {
  AppBridge,
  AppSettings,
  ArchiveLine,
  ArchiveRecord,
  ArchiveSummary,
  StartResult,
  MicPermission,
  SetupStatus,
  SetupProgress,
  SegmentPayload,
  PartialPayload,
  TranslationPayload,
  StatusPayload,
  TranslationStatusPayload,
} from '@mt/core';
import { MeetingAsr, MeetingTranslate } from '../native-plugin';

const SETTINGS_KEY = 'mt.settings';
const ARCHIVES_KEY = 'mt.archives';

/** 母语 app 语言码 → SenseVoice/翻译用的短码（zh-Hant 走 zh，靠脚本后处理）。 */
function targetCode(spec: typeof M2M100_SPEC, nativeLang: string): string {
  return spec.langs[nativeLang]?.code ?? spec.fallbackLang;
}

export function createIosBridge(): AppBridge {
  // —— UI 注册的回调（mountApp → registerTranscriptionListeners 时注入） ——
  let segmentCb: ((s: SegmentPayload) => void) | null = null;
  let partialCb: ((p: PartialPayload) => void) | null = null;
  let translationCb: ((t: TranslationPayload) => void) | null = null;
  let statusCb: ((s: StatusPayload) => void) | null = null;
  let translationStatusCb: ((s: TranslationStatusPayload) => void) | null = null;
  let setupProgressCb: ((p: SetupProgress) => void) | null = null;

  // —— 缓存设置：segment 到达时同步读取翻译开关/引擎/母语，避免每段都 await KV ——
  let cachedSettings: AppSettings | null = null;

  // —— 翻译开关（轻量，独立于 settings.translation.enabled 持久化，与 macOS 一致语义） ——
  let translateEnabled = false;

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
    const settings = withDefaults(raw, defaults);
    cachedSettings = settings;
    translateEnabled = settings.translation.enabled;
    return settings;
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

  // ---- 翻译：segment 到达时按当前设置翻成母语（云 / 设备端两条路径） ----
  async function translateSegment(seg: SegmentPayload): Promise<void> {
    if (!translateEnabled) return;
    const s = cachedSettings ?? (await readSettings());

    const target = targetCode(M2M100_SPEC, s.nativeLang);
    if (seg.lang === target) return; // 同语言不译
    // 目标脚本后处理（zh-Hant 繁體化等）：模型/系统只产出一个 'zh'，繁體靠脚本转换兜底。
    const toScript = M2M100_SPEC.langs[s.nativeLang]?.toScript;

    // —— 设备端（非云）翻译：Apple Translation 框架（iOS 18+），原生插件 MeetingTranslate ——
    if (s.translation.engine !== 'cloud') {
      translationStatusCb?.({ state: 'loading' });
      try {
        const r = await MeetingTranslate.translate({
          text: seg.text,
          source: seg.lang,
          target,
        });
        if (r.unavailable || !r.text) {
          translationStatusCb?.({
            state: 'error',
            error: `On-device translation unavailable (${r.reason ?? 'unknown'}); switch to cloud translation in settings.`,
          });
          return;
        }
        translationStatusCb?.({ state: 'ready' });
        translationCb?.({ id: seg.id, text: toScript ? toScript(r.text) : r.text });
      } catch (e) {
        translationStatusCb?.({
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    // —— 云翻译 ——
    translationStatusCb?.({ state: 'loading' });
    try {
      const translator = new CloudTranslator(s.translation.cloud);
      const text = await translator.translate(seg.text, { source: seg.lang, target });
      translationStatusCb?.({ state: 'ready' });
      // 云翻译已直接产出目标语，这里仅在母语需要脚本归一化时再兜一层。
      translationCb?.({ id: seg.id, text: toScript ? toScript(text) : text });
    } catch (e) {
      translationStatusCb?.({
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ---- 订阅原生 ASR 插件事件，转发给 UI 注册的回调 ----
  // 纯浏览器预览（无原生壳）下 addListener 会 reject，吞掉即可，不影响 UI 挂载。
  function subscribeNative(): void {
    void MeetingAsr.addListener('partial', (p) => partialCb?.(p)).catch(() => undefined);
    void MeetingAsr.addListener('segment', (seg) => {
      segmentCb?.(seg);
      void translateSegment(seg);
    }).catch(() => undefined);
    void MeetingAsr.addListener('status', (s) => statusCb?.(s)).catch(() => undefined);
    void MeetingAsr.addListener('setupProgress', (p) => setupProgressCb?.(p)).catch(
      () => undefined,
    );
  }
  subscribeNative();

  // ---- MicPermission 归一化（原生返回的字符串 → @mt/core 联合类型） ----
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
        const r = await MeetingAsr.start();
        return { ok: r.ok, error: r.error };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async stopPipeline(): Promise<{ ok: boolean }> {
      try {
        return await MeetingAsr.stop();
      } catch {
        return { ok: false };
      }
    },
    // ===== 翻译开关 =====
    setTranslateEnabled(enabled: boolean): void {
      translateEnabled = enabled;
      if (cachedSettings) cachedSettings.translation.enabled = enabled;
    },

    // ===== 麦克风权限（原生）=====
    async getMicStatus(): Promise<MicPermission> {
      try {
        const r = await MeetingAsr.getMicStatus();
        return asMicPermission(r.status);
      } catch {
        return 'unknown';
      }
    },
    openMicSettings(): void {
      void MeetingAsr.openMicSettings().catch(() => undefined);
    },

    // ===== 设置（Preferences）=====
    getSettings(): Promise<AppSettings> {
      return readSettings();
    },
    async saveSettings(settings: AppSettings): Promise<AppSettings> {
      // 复用 withDefaults 做一次补齐/校验，确保落盘的是规范结构
      const normalized = withDefaults(settings, makeDefaults([]));
      await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(normalized) });
      cachedSettings = normalized;
      translateEnabled = normalized.translation.enabled;
      return normalized;
    },

    // ===== 首次安装 / 模型下载（原生）=====
    async getSetupStatus(): Promise<SetupStatus> {
      try {
        return await MeetingAsr.getSetupStatus();
      } catch {
        // 无原生壳（纯浏览器预览）：当作就绪，避免卡在首启引导。
        return { asrReady: true };
      }
    },
    async downloadAsrModels(): Promise<{ ok: boolean; error?: string }> {
      try {
        return await MeetingAsr.downloadModels();
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

  // 预读一次设置，填充缓存（异步，不阻塞返回）。
  void readSettings();

  return api;
}
