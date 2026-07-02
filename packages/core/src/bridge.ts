// 平台无关的 UI ←→ 平台桥接契约。
// 渲染层（@rt/ui）只依赖此接口，由各宿主（Electron 渲染层 / iOS Capacitor 等）注入实现。
// 仅引用 @rt/core 内的领域类型与回调，保持平台无关；音频采集不在此契约内（隐藏在各宿主实现中）。

import type {
  SegmentPayload,
  PartialPayload,
  TranslationPayload,
  StatusPayload,
  TranslationStatusPayload,
  StartResult,
  MicPermission,
  AppSettings,
  CloudTranslationConfig,
  SetupStatus,
  SetupProgress,
  ArchiveLine,
  ArchiveSummary,
  ArchiveRecord,
} from './types';

/**
 * 宿主提供给渲染层（@rt/ui）的平台桥接契约，由各宿主实现并注入。
 * UI 只负责开/停会话与接收事件，音频采集隐藏在桥接背后、按平台实现：
 *  - macOS（Electron）：渲染层 createMacBridge 用 getUserMedia/AudioWorklet 采集，经 IPC 送音频。
 *  - iOS（Capacitor）：原生插件直接采麦，JS 侧无需送音频。
 */
export interface AppBridge {
  /** 开始整个实时会话（含音频采集） */
  startPipeline(): Promise<StartResult>;
  /** 停止整个实时会话（含音频采集） */
  stopPipeline(): Promise<{ ok: boolean }>;
  /**
   * 本平台是否支持本地（离线）翻译引擎。省略/undefined 视为 true。
   * Web 在 iOS/iPadOS 上为 false：WebKit 单标签页内存装不下本地翻译模型（会崩），只提供
   * 云端翻译——设置里不展示本地引擎选项，引擎恒为 cloud（见 apps/web/src/bridge.ts）。
   */
  localTranslationAvailable?: boolean;
  /** 查询麦克风权限状态（用于在请求权限前先弹说明） */
  getMicStatus(): Promise<MicPermission>;
  /** 打开系统设置的麦克风隐私页（macOS） */
  openMicSettings(): void;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  /**
   * 测试云端翻译配置是否可用：真实打一次最小请求，验证端点 / 密钥 / 模型。ok=false 时带 error。
   * Web / iOS 在 JS 内直接 fetch；macOS 在主进程用 Node fetch（preload 处收紧为必选实现）。
   * UI 仅在本方法存在时才显示「测试连接」按钮，并把云端引擎的「保存」前置为「测试通过」。
   */
  testCloud?(cfg: CloudTranslationConfig): Promise<{ ok: boolean; error?: string }>;
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
