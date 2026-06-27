// 主进程与渲染进程之间通过 IPC 传递的数据结构，以及暴露给渲染进程的 API。

/** 一条最终确定的转写结果 */
interface SegmentPayload {
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
interface TranslationPayload {
  id: number;
  text: string;
}

/** 说话过程中实时更新的部分识别结果，text 为空表示清除 */
interface PartialPayload {
  text: string;
}

interface StatusPayload {
  state: 'loading' | 'running' | 'error' | 'stopped';
  error?: string;
}

interface StartResult {
  ok: boolean;
  error?: string;
}

/** 翻译模型的加载状态（首次需联网下载约 600MB） */
interface TranslationStatusPayload {
  state: 'loading' | 'ready' | 'error';
  /** 0~1 下载进度（若有） */
  progress?: number;
  error?: string;
}

/** OpenAI 兼容云端翻译配置 */
interface CloudTranslationConfig {
  /** 形如 https://api.openai.com/v1 */
  baseURL: string;
  apiKey: string;
  /** 模型名，如 gpt-4o-mini */
  model: string;
}

interface TranslationSettings {
  /** 是否开启翻译（目标恒为母语 nativeLang） */
  enabled: boolean;
  /** 'local' = 本地 M2M100；'cloud' = OpenAI 兼容云端 */
  engine: 'local' | 'cloud';
  cloud: CloudTranslationConfig;
}

/** 主页转写字体大小档位 */
type FontSize = 'small' | 'medium' | 'large';

/** 界面/母语语言码（界面文案 + 翻译目标） */
type UiLang = 'zh' | 'ja' | 'en' | 'ko';

/** 持久化到本地（electron userData）的应用设置 */
interface AppSettings {
  /** 是否已完成首次语言引导 */
  onboarded: boolean;
  /** 母语：界面语言 + 翻译目标 */
  nativeLang: UiLang;
  fontSize: FontSize;
  translation: TranslationSettings;
}

/** preload 通过 contextBridge 暴露到渲染进程 window.api 上的接口 */
interface MeetingApi {
  startPipeline(): Promise<StartResult>;
  stopPipeline(): Promise<{ ok: boolean }>;
  sendAudio(samples: Float32Array): void;
  /** 开/关翻译（目标恒为母语） */
  setTranslateEnabled(enabled: boolean): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  onSegment(cb: (segment: SegmentPayload) => void): void;
  onPartial(cb: (partial: PartialPayload) => void): void;
  onTranslation(cb: (translation: TranslationPayload) => void): void;
  onStatus(cb: (status: StatusPayload) => void): void;
  onTranslationStatus(cb: (status: TranslationStatusPayload) => void): void;
}

interface Window {
  api: MeetingApi;
}

// --- AudioWorklet 运行上下文的全局声明（不在标准 lib.dom 里）---
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor
): void;
