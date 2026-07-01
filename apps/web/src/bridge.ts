// 浏览器 PWA 平台桥接：实现 @rt/core 的 AppBridge，注入给 @rt/ui。
// 镜像 apps/ios/src/bridge.ts 的结构，但全部用浏览器原生能力：
//
// 各能力来源：
//  - 设置 / 归档持久化：IndexedDB（idb 库），纯逻辑复用 @rt/core
//    （makeDefaults / withDefaults / listSummaries / makeArchiveId / toSummary）。
//  - 翻译：segment 到达且开启翻译时翻成母语，两种引擎与 macOS 对齐：
//    · engine==='cloud'  → @rt/core CloudTranslator（fetch OpenAI 兼容端点）。
//    · 否则（本地 m2m100）→ Transformers.js（Xenova/m2m100_418M，浏览器内 WASM），见 ./translation。
//    繁體等目标脚本后处理沿用 M2M100_SPEC.toScript（两条路径一致）。
//  - 麦克风权限：navigator.permissions.query；openMicSettings 浏览器无法打开系统设置，空实现。
//  - ASR：Phase 2 真识别。getUserMedia + AudioWorklet 采麦（见 ./asr/web-asr），帧送进经典 Web Worker
//    (./asr/sherpa-worker) 跑 sherpa-onnx WASM（Silero VAD + SenseVoice）。模型从 @rt/core ASR_MODELS
//    下载并缓存在 Cache Storage（见 ./asr/model-store），写入 WASM FS 后识别。单线程 WASM，无需 COOP/COEP。
//
// 全部能力均已实现（可在此环境验证类型 + 打包）：设置、归档、云 + 本地翻译、事件转发、回调注册、
// 采麦 + sherpa-onnx WASM 实时识别、getSetupStatus（查缓存）、downloadAsrModels（边下边报进度）。

import { openDB, type IDBPDatabase } from 'idb';
import {
  makeDefaults,
  withDefaults,
  listSummaries,
  makeArchiveId,
  CloudTranslator,
  M2M100_SPEC,
} from '@rt/core';
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
} from '@rt/core';
import { WebAsr } from './asr/web-asr';
import { areModelsCached, ensureModelsCached } from './asr/model-store';
import { WebLocalTranslator, type ModelProgress } from './translation/web-local-translator';

const DB_NAME = 'mt';
const DB_VERSION = 1;
const KV_STORE = 'kv'; // 设置等单键值
const ARCHIVE_STORE = 'archives'; // 归档记录，keyPath = id
const SETTINGS_KEY = 'settings';

/** 母语 app 语言码 → 翻译用的短码（zh-Hant 走 zh，靠脚本后处理）。 */
function targetCode(spec: typeof M2M100_SPEC, nativeLang: string): string {
  return spec.langs[nativeLang]?.code ?? spec.fallbackLang;
}

export function createWebBridge(): AppBridge {
  // —— UI 注册的回调（mountApp → registerTranscriptionListeners 时注入） ——
  let segmentCb: ((s: SegmentPayload) => void) | null = null;
  let partialCb: ((p: PartialPayload) => void) | null = null;
  let translationCb: ((t: TranslationPayload) => void) | null = null;
  let statusCb: ((s: StatusPayload) => void) | null = null;
  let translationStatusCb: ((s: TranslationStatusPayload) => void) | null = null;
  let setupProgressCb: ((p: SetupProgress) => void) | null = null;

  // —— 缓存设置：segment 到达时同步读取翻译开关/引擎/母语，避免每段都 await IndexedDB ——
  let cachedSettings: AppSettings | null = null;

  // —— 翻译开关（轻量，独立于 settings.translation.enabled 持久化，与 macOS/iOS 一致语义） ——
  let translateEnabled = false;

  // —— 本地翻译器（懒建，缓存模型实例，首次翻译触发下载） ——
  let localTranslator: WebLocalTranslator | null = null;
  function getLocalTranslator(): WebLocalTranslator {
    if (!localTranslator) localTranslator = new WebLocalTranslator(M2M100_SPEC);
    return localTranslator;
  }

  // —— IndexedDB 句柄（懒开，幂等） ——
  let dbPromise: Promise<IDBPDatabase> | null = null;
  function db(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(KV_STORE)) {
            database.createObjectStore(KV_STORE);
          }
          if (!database.objectStoreNames.contains(ARCHIVE_STORE)) {
            database.createObjectStore(ARCHIVE_STORE, { keyPath: 'id' });
          }
        },
      });
    }
    return dbPromise;
  }

  // ---- 持久化：设置 ----
  async function readSettings(): Promise<AppSettings> {
    const defaults = makeDefaults(navigator.languages ? [...navigator.languages] : []);
    let raw: unknown = null;
    try {
      raw = (await (await db()).get(KV_STORE, SETTINGS_KEY)) ?? null;
    } catch {
      raw = null;
    }
    const settings = withDefaults(raw, defaults);
    cachedSettings = settings;
    translateEnabled = settings.translation.enabled;
    return settings;
  }

  // ---- 持久化：归档 ----
  async function readArchives(): Promise<ArchiveRecord[]> {
    try {
      const all = (await (await db()).getAll(ARCHIVE_STORE)) as ArchiveRecord[];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }

  // ---- 翻译：segment 到达时按当前设置翻成母语（云 / 本地两条路径） ----
  async function translateSegment(seg: SegmentPayload): Promise<void> {
    if (!translateEnabled) return;
    const s = cachedSettings ?? (await readSettings());

    const target = targetCode(M2M100_SPEC, s.nativeLang);
    if (seg.lang === target) return; // 同语言不译：不发 pending，UI 不显示等待动画
    // 目标脚本后处理（zh-Hant 繁體化等）：模型/系统只产出一个 'zh'，繁體靠脚本转换兜底。
    const toScript = M2M100_SPEC.langs[s.nativeLang]?.toScript;

    // 标记该行进入「翻译中」：UI 在译文区显示等待动画，直到下方发出最终结果。
    translationCb?.({ id: seg.id, text: '', pending: true });

    // —— 云翻译 ——
    if (s.translation.engine === 'cloud') {
      translationStatusCb?.({ state: 'loading' });
      try {
        const translator = new CloudTranslator(s.translation.cloud);
        const text = await translator.translate(seg.text, { source: seg.lang, target });
        translationStatusCb?.({ state: 'ready' });
        // 云翻译已直接产出目标语，这里仅在母语需要脚本归一化时再兜一层。
        translationCb?.({ id: seg.id, text: toScript ? toScript(text) : text });
      } catch (e) {
        console.error('[translate:cloud]', e);
        translationStatusCb?.({
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
        translationCb?.({ id: seg.id, text: '' }); // 结束等待动画
      }
      return;
    }

    // —— 本地翻译：Transformers.js（M2M100，浏览器内）。首次会下载模型 ——
    translationStatusCb?.({ state: 'loading' });
    try {
      const translator = getLocalTranslator();
      // 把模型下载进度透传到 onTranslationStatus（单文件百分比，0~1）。
      const onProgress = (p: ModelProgress) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          translationStatusCb?.({ state: 'loading', progress: p.progress / 100 });
        }
      };
      // translate 内部已做 toScript；这里目标短码即 M2M100_SPEC.langs[nativeLang].code 映射的来源。
      const text = await translator.translate(seg.text, { source: seg.lang, target }, onProgress);
      translationStatusCb?.({ state: 'ready' });
      translationCb?.({ id: seg.id, text });
    } catch (e) {
      console.error('[translate:local]', e);
      translationStatusCb?.({
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
      translationCb?.({ id: seg.id, text: '' }); // 结束等待动画
    }
  }

  // ---- Web ASR（Phase 2：sherpa-onnx WASM 真识别）。回调转发给 UI；segment 还会触发翻译 ----
  const asr = new WebAsr({
    onStatus: (st) => statusCb?.(st),
    onPartial: (p) => partialCb?.(p),
    onSegment: (seg) => {
      segmentCb?.(seg);
      void translateSegment(seg);
    },
  });

  // ---- MicPermission 归一化（Permissions API 的字符串 → @rt/core 联合类型） ----
  // 浏览器只有 granted/denied/prompt；prompt 对应「尚未决定」。
  function asMicPermission(state: PermissionState): MicPermission {
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'denied';
    return 'not-determined'; // 'prompt'
  }

  const api: AppBridge = {
    // ===== ASR 管线（Web，Phase 1 桩） =====
    async startPipeline(): Promise<StartResult> {
      // 真请求麦克风 + 建 AudioWorklet 采音；Phase 1 不识别（不回吐 segment）。
      return asr.start();
    },
    async stopPipeline(): Promise<{ ok: boolean }> {
      return asr.stop();
    },

    // ===== 翻译开关 =====
    setTranslateEnabled(enabled: boolean): void {
      translateEnabled = enabled;
      if (cachedSettings) cachedSettings.translation.enabled = enabled;
    },

    // ===== 麦克风权限（Permissions API） =====
    async getMicStatus(): Promise<MicPermission> {
      try {
        // 'microphone' 不在标准 PermissionName 联合里，浏览器实际支持，断言绕过类型。
        const status = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
        return asMicPermission(status.state);
      } catch {
        // 不支持 Permissions API（如部分 Safari 版本）：未知，UI 会照常尝试 getUserMedia。
        return 'unknown';
      }
    },
    openMicSettings(): void {
      // 浏览器无法以编程方式打开系统/站点设置；空实现（UI 已对 web 做引导文案）。
    },

    // ===== 设置（IndexedDB） =====
    getSettings(): Promise<AppSettings> {
      return readSettings();
    },
    async saveSettings(settings: AppSettings): Promise<AppSettings> {
      // 复用 withDefaults 做一次补齐/校验，确保落盘的是规范结构。
      const normalized = withDefaults(settings, makeDefaults([]));
      await (await db()).put(KV_STORE, normalized, SETTINGS_KEY);
      cachedSettings = normalized;
      translateEnabled = normalized.translation.enabled;
      return normalized;
    },

    // ===== 首次安装 / 模型下载（Phase 2） =====
    async getSetupStatus(): Promise<SetupStatus> {
      // 检查 Cache Storage 里 sherpa-onnx 模型（@rt/core requiredAsrFiles）是否齐全。
      // 齐全则直接落主界面；否则 UI 显示 SetupScreen 触发 downloadAsrModels。
      try {
        return { asrReady: await areModelsCached() };
      } catch {
        return { asrReady: false };
      }
    },
    async downloadAsrModels(): Promise<{ ok: boolean; error?: string }> {
      // 按 @rt/core ASR_MODELS 下载 Silero VAD + SenseVoice（~230MB）到 Cache Storage，
      // 边下边通过 setupProgressCb 回吐 { loaded, total } 聚合进度。首次后命中缓存即秒回。
      try {
        await ensureModelsCached((p) => setupProgressCb?.({ loaded: p.loaded, total: p.total }));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },

    // ===== 归档（IndexedDB） =====
    async saveArchive(name: string, lines: ArchiveLine[]): Promise<ArchiveSummary[]> {
      const createdAt = Date.now();
      const record: ArchiveRecord = {
        id: makeArchiveId(createdAt),
        name,
        createdAt,
        lines,
      };
      await (await db()).put(ARCHIVE_STORE, record);
      return listSummaries(await readArchives());
    },
    async listArchives(): Promise<ArchiveSummary[]> {
      return listSummaries(await readArchives());
    },
    async getArchive(id: string): Promise<ArchiveRecord | null> {
      const r = (await (await db()).get(ARCHIVE_STORE, id)) as ArchiveRecord | undefined;
      return r ?? null;
    },
    async deleteArchive(id: string): Promise<ArchiveSummary[]> {
      await (await db()).delete(ARCHIVE_STORE, id);
      return listSummaries(await readArchives());
    },

    // ===== 回调注册（与 macOS/iOS 语义一致：仅记录，事件由 WebAsr 转发） =====
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
