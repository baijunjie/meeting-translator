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
  translateFinalizedSegment,
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
import { WebAsr } from './asr/web-asr';
import { areModelsCached, ensureModelsCached } from './asr/model-store';
import { WebLocalTranslator, type ModelProgress } from './translation/web-local-translator';
import { isIOS } from './platform';

const DB_NAME = 'mt';
const DB_VERSION = 1;
const KV_STORE = 'kv'; // 设置等单键值
const ARCHIVE_STORE = 'archives'; // 归档记录，keyPath = id
const SETTINGS_KEY = 'settings';

// iOS/iPadOS 的 WebKit 单标签页内存装不下本地翻译模型（与 ASR 共存会崩，且 4-bit 量化在
// ORT-web 里也跑不起来），故这些设备不提供本地翻译、引擎恒为云端。所有产出 settings 的
// 路径（读/写）统一经此收口，保证 getSettings 与翻译热路径看到的引擎一致，且不会去建本地模型。
function applyPlatformConstraints(s: AppSettings): AppSettings {
  if (isIOS()) s.translation.engine = 'cloud';
  return s;
}

export function createWebBridge(): AppBridge {
  // —— UI 注册的回调（mountApp → registerTranscriptionListeners 时注入） ——
  let segmentCb: ((s: SegmentPayload) => void) | null = null;
  let partialCb: ((p: PartialPayload) => void) | null = null;
  let translationCb: ((t: TranslationPayload) => void) | null = null;
  let statusCb: ((s: StatusPayload) => void) | null = null;
  let translationStatusCb: ((s: TranslationStatusPayload) => void) | null = null;
  let setupProgressCb: ((p: SetupProgress) => void) | null = null;

  // —— 缓存设置：翻译热路径（segment 到达）同步读开关/引擎/母语，免得每段都 await IndexedDB。
  //    翻译开关就是 cachedSettings.translation.enabled，改后即时生效并落盘，不再另存一份布尔。 ——
  let cachedSettings: AppSettings | null = null;

  // —— 本地翻译器（懒建，缓存模型实例，首次翻译触发下载） ——
  let localTranslator: WebLocalTranslator | null = null;
  function getLocalTranslator(): WebLocalTranslator {
    if (!localTranslator) localTranslator = new WebLocalTranslator(M2M100_SPEC);
    return localTranslator;
  }

  // —— 本地模型预热（只下载/装载不翻译）：打开翻译开关时、以及启动时翻译已开着都会调，
  //    进度经 onTranslationStatus 上报，第一句不再等下载。warmUp 幂等，重复调用安全。 ——
  function warmUpLocalModel(): void {
    translationStatusCb?.({ state: 'loading' });
    getLocalTranslator()
      .warmUp((p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          translationStatusCb?.({ state: 'loading', progress: p.progress / 100 });
        }
      })
      .then(() => translationStatusCb?.({ state: 'ready' }))
      .catch((e) => {
        console.error('[translate:warmup]', e);
        translationStatusCb?.({
          state: 'error',
          error: e instanceof Error ? e.message : String(e),
        });
      });
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
    cachedSettings = applyPlatformConstraints(withDefaults(raw, defaults));
    return cachedSettings;
  }

  // 写设置：补齐/校验后落盘并刷新缓存。所有写入路径（保存设置、切翻译开关）都走这里。
  async function writeSettings(next: AppSettings): Promise<AppSettings> {
    cachedSettings = applyPlatformConstraints(withDefaults(next, makeDefaults([])));
    await (await db()).put(KV_STORE, cachedSettings, SETTINGS_KEY);
    return cachedSettings;
  }

  // 首次读取去重：启动预读与 UI 首次 getSettings() 并发触发，共享同一次 IndexedDB 读；
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
    try {
      const all = (await (await db()).getAll(ARCHIVE_STORE)) as ArchiveRecord[];
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }

  // ---- 翻译：segment 到达时按当前设置翻成母语。编排（是否翻 / pending / 字形归一化 /
  //      错误上报）统一在 @rt/core.translateFinalizedSegment，三端一致；这里只注入引擎调用：
  //      云端 CloudTranslator 或本地 WebLocalTranslator（首次下载模型的进度经 status 上报）。 ----
  async function translateSegment(seg: SegmentPayload): Promise<void> {
    const s = cachedSettings ?? (await readSettingsOnce());
    await translateFinalizedSegment({
      spec: M2M100_SPEC,
      segment: seg,
      enabled: s.translation.enabled,
      nativeLang: s.nativeLang,
      translate: (req) => {
        if (s.translation.engine === 'cloud') {
          // 云端传母语 app 语言键（zh-Hant 等），让 LLM 直接产出对应字形。
          return new CloudTranslator(s.translation.cloud).translate(req.text, {
            source: req.source,
            target: req.targetLang,
          });
        }
        // 本地 target 同样传 app 语言键：translate 内部按 langs 条目映射模型码并做字形归一化。
        return getLocalTranslator().translate(
          req.text,
          { source: req.source, target: req.targetLang },
          (p: ModelProgress) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
              translationStatusCb?.({ state: 'loading', progress: p.progress / 100 });
            }
          },
        );
      },
      emitTranslation: (p) => translationCb?.(p),
      emitStatus: (st) => {
        if (st.state === 'error') console.error('[translate]', st.error);
        translationStatusCb?.(st);
      },
    });
  }

  // ---- Web ASR（Phase 2：sherpa-onnx WASM 真识别）。回调转发给 UI；segment 还会触发翻译 ----
  // 行 id 由桥接层统一分配，跨录音会话单调递增：识别 worker 每次 start 都会重建、其内部
  // id 从 0 计数，而 UI 的行与译文回填都按 id 对应，必须全局唯一，故在此改写后再上抛。
  let nextLineId = 0;
  const asr = new WebAsr({
    onStatus: (st) => statusCb?.(st),
    onPartial: (p) => partialCb?.(p),
    onSegment: (seg) => {
      const line: SegmentPayload = { ...seg, id: nextLineId++ };
      segmentCb?.(line);
      void translateSegment(line);
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
    // iOS/iPadOS 上本地翻译模型装不下 WebKit 内存 → 只提供云端翻译（UI 据此隐藏本地引擎选项）。
    localTranslationAvailable: !isIOS(),

    // ===== ASR 管线（Web，Phase 1 桩） =====
    async startPipeline(): Promise<StartResult> {
      // 真请求麦克风 + 建 AudioWorklet 采音；Phase 1 不识别（不回吐 segment）。
      return asr.start();
    },
    async stopPipeline(): Promise<{ ok: boolean }> {
      return asr.stop();
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
      return readSettingsOnce();
    },
    async saveSettings(settings: AppSettings): Promise<AppSettings> {
      const saved = await writeSettings(settings);
      // 主页已无翻译开关，开/关改由设置里选「翻译方式」并保存触发：若开启且用本地引擎，保存即预热
      // 本地模型（warmUp 幂等），第一句不再等下载。iOS 上 engine 已被收敛为 cloud，不会触发本地加载。
      if (saved.translation.enabled && saved.translation.engine !== 'cloud') {
        warmUpLocalModel();
      }
      return saved;
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

  // 预读一次设置，填充缓存（异步，不阻塞返回）。与 UI 首次 getSettings() 共享同一次读。
  // 翻译已开 + 本地引擎则启动即预热（保存设置之外的另一预热入口：重开/刷新时设置早已持久化为开），
  // 否则模型要拖到第一句才下载/装载。
  // .then 在 IndexedDB 读完后才跑，届时 registerTranscriptionListeners 已注册好状态回调。
  void readSettingsOnce().then((s) => {
    if (s.translation.enabled && s.translation.engine !== 'cloud') {
      warmUpLocalModel();
    }
  });

  return api;
}
