// 主进程与渲染进程之间通过 IPC 传递的数据结构，以及暴露给渲染进程的 API。

/** 一条最终确定的转写结果 */
export interface SegmentPayload {
  /** 段序号，译文异步回来时用它对应到正确的行 */
  id: number;
  text: string;
  /** 语言代码，如 zh / ja / en */
  lang: string;
  /** 段起始时间（秒） */
  start: number;
  /** 段时长（秒） */
  duration: number;
}

/** 某条转写段的译文，按 id 对应回原文行 */
export interface TranslationPayload {
  id: number;
  text: string;
}

/** 说话过程中实时更新的部分识别结果，text 为空表示清除 */
export interface PartialPayload {
  text: string;
}

export interface StatusPayload {
  state: 'loading' | 'running' | 'error' | 'stopped';
  error?: string;
}

export interface StartResult {
  ok: boolean;
  error?: string;
}

/** 翻译模型的加载状态（首次需联网下载约 600MB） */
export interface TranslationStatusPayload {
  state: 'loading' | 'ready' | 'error';
  /** 0~1 下载进度（若有） */
  progress?: number;
  error?: string;
}

/** ASR 子进程(utilityProcess) ←→ 主进程 的消息协议 */
export type MainToAsr =
  | { type: 'init'; modelsDir: string }
  | { type: 'audio'; samples: Float32Array }
  | { type: 'flush' };

export type AsrToMain =
  | { type: 'ready' }
  | { type: 'segment'; payload: SegmentPayload }
  | { type: 'partial'; payload: PartialPayload }
  | { type: 'error'; message: string };

/** 翻译子进程(utilityProcess) ←→ 主进程 的消息协议 */
export type MainToTranslate =
  | { type: 'configure'; engine: TranslationEngine; cloud: CloudTranslationConfig; cacheDir: string }
  | { type: 'preheat' }
  | { type: 'translate'; id: number; text: string; source?: string; target: string };

export type TranslateToMain =
  | { type: 'status'; payload: TranslationStatusPayload }
  | { type: 'result'; id: number; text: string };

/** 首次启动下载 ASR 模型的状态 */
export interface SetupStatus {
  asrReady: boolean;
}

/** ASR 模型下载进度 */
export interface SetupProgress {
  /** 已下载字节 */
  loaded: number;
  /** 总字节 */
  total: number;
}

/** OpenAI 兼容云端翻译配置 */
export interface CloudTranslationConfig {
  /** 形如 https://api.openai.com/v1 */
  baseURL: string;
  apiKey: string;
  /** 模型名，如 gpt-4o-mini */
  model: string;
}

/** 本地翻译模型：即插即用，新增模型只加一份 spec（许可须可自由分发） */
export type LocalEngine = 'm2m100';
/** 翻译引擎：本地模型 + 云端 */
export type TranslationEngine = LocalEngine | 'cloud';

export interface TranslationSettings {
  /** 是否开启翻译（目标恒为母语 nativeLang） */
  enabled: boolean;
  engine: TranslationEngine;
  cloud: CloudTranslationConfig;
}

/** 主页转写字体大小档位 */
export type FontSize = 'small' | 'medium' | 'large';

/** 界面/母语语言码（界面文案 + 翻译目标）。zh=简体中文，zh-Hant=繁體中文 */
export type UiLang = 'zh' | 'zh-Hant' | 'ja' | 'en' | 'ko';

/** 主题偏好：浅色 / 深色 / 跟随系统 */
export type ThemePref = 'light' | 'dark' | 'system';

/** 归档里的一行对话 */
export interface ArchiveLine {
  time: string;
  text: string;
  translation: string;
}

/** 一条完整归档记录（持久化） */
export interface ArchiveRecord {
  id: string;
  name: string;
  createdAt: number;
  lines: ArchiveLine[];
}

/** 归档列表项（不含完整内容，仅摘要） */
export interface ArchiveSummary {
  id: string;
  name: string;
  createdAt: number;
  /** 最后一条对话的原文，列表里弱色小字显示 */
  lastLine: string;
}

/** 持久化到本地（electron userData）的应用设置 */
export interface AppSettings {
  /** 是否已完成首次语言引导 */
  onboarded: boolean;
  /** 母语：界面语言 + 翻译目标 */
  nativeLang: UiLang;
  fontSize: FontSize;
  /** 主题偏好 */
  theme: ThemePref;
  translation: TranslationSettings;
}

/** preload 通过 contextBridge 暴露到渲染进程 window.api 上的接口 */
export interface MeetingApi {
  startPipeline(): Promise<StartResult>;
  stopPipeline(): Promise<{ ok: boolean }>;
  sendAudio(samples: Float32Array): void;
  /** 开/关翻译（目标恒为母语） */
  setTranslateEnabled(enabled: boolean): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  /** 首次启动：查询 ASR 模型是否已就绪 */
  getSetupStatus(): Promise<SetupStatus>;
  /** 下载 ASR 模型，返回结果（失败带 error，供重试） */
  downloadAsrModels(): Promise<{ ok: boolean; error?: string }>;
  /** 归档：保存一次对话，返回更新后的列表 */
  saveArchive(name: string, lines: ArchiveLine[]): Promise<ArchiveSummary[]>;
  listArchives(): Promise<ArchiveSummary[]>;
  getArchive(id: string): Promise<ArchiveRecord | null>;
  deleteArchive(id: string): Promise<ArchiveSummary[]>;
  onSetupProgress(cb: (progress: SetupProgress) => void): void;
  onSegment(cb: (segment: SegmentPayload) => void): void;
  onPartial(cb: (partial: PartialPayload) => void): void;
  onTranslation(cb: (translation: TranslationPayload) => void): void;
  onStatus(cb: (status: StatusPayload) => void): void;
  onTranslationStatus(cb: (status: TranslationStatusPayload) => void): void;
}
