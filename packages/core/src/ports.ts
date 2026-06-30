// 平台能力的端口接口（type-only，无实现）。
// 这是 macOS / iOS 等各端要实现的契约，供后续阶段把更多逻辑下沉到 core 时使用。
// 当前 apps/macos 尚未使用这些端口，保持精简、合理即可。
import type { MicPermission, SetupProgress } from './types';
import type { TranslateProgress } from './translation/translator';

/** 键值持久化（异步）。各端用 fs / IndexedDB / 文件等实现。 */
export interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** ASR 识别引擎：喂入音频帧，回吐部分/最终识别结果。 */
export interface AsrEngine {
  /** 启动引擎（如加载模型、建立会话） */
  start(): Promise<void>;
  /** 喂入一帧 PCM 音频（单声道 Float32，[-1,1]） */
  acceptAudio(samples: Float32Array): void;
  /** 停止并释放资源 */
  stop(): Promise<void>;
  /** 实时部分识别结果回调 */
  onPartial(cb: (text: string) => void): void;
  /** 最终段识别结果回调 */
  onSegment(cb: (segment: { text: string; lang: string; start: number; duration: number }) => void): void;
  /** 引擎就绪回调 */
  onReady(cb: () => void): void;
  /** 错误回调 */
  onError(cb: (error: Error) => void): void;
}

/** 音频采集：开始/停止，向回调持续吐出 Float32 音频帧。 */
export interface AudioCapture {
  /** 开始采集；frames 回调收到单声道 Float32 帧 */
  start(onFrame: (samples: Float32Array) => void): Promise<void>;
  /** 停止采集 */
  stop(): Promise<void>;
}

/** 模型下载：确保 ASR / 翻译模型已就绪，可上报进度。 */
export interface ModelDownloader {
  /** 确保 ASR 模型已下载到本地 */
  ensureAsrModels(onProgress?: (p: SetupProgress) => void): Promise<void>;
  /** 确保翻译模型已下载到本地 */
  ensureTranslationModel?(onProgress?: (p: TranslateProgress) => void): Promise<void>;
}

/** 系统权限：麦克风状态查询、跳转系统设置。 */
export interface Permissions {
  getMicStatus(): Promise<MicPermission>;
  openSettings(): void;
}

/** 系统区域设置：偏好语言列表（用于推断默认母语）。 */
export interface SystemLocale {
  preferredLanguages(): string[];
}
