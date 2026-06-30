// sherpa-worker 与主线程之间的消息协议（type-only，无运行时代码）。
// 主线程 (web-asr.ts) 与 Worker (sherpa-worker.ts) 共享此契约。

/** 主线程 → Worker。 */
export type ToWorker =
  // 初始化：传入已下载好的模型字节（fsName → bytes），Worker 写入 WASM FS 并建 VAD/recognizer。
  | { type: 'init'; models: Array<{ name: string; bytes: Uint8Array }>; sherpaBaseUrl: string }
  // 一帧 16kHz 单声道 PCM（Float32）。
  | { type: 'frame'; samples: Float32Array }
  // 录音结束：把未闭合的语音段定稿。
  | { type: 'flush' }
  // 停止并释放（销毁 VAD/recognizer，可重新 init）。
  | { type: 'stop' };

/** Worker → 主线程。 */
export type FromWorker =
  // 模型已加载、引擎已就绪，可以开始喂帧。
  | { type: 'ready' }
  // 实时部分识别（text 为空表示清除）。
  | { type: 'partial'; text: string }
  // 一条定稿段。
  | { type: 'segment'; id: number; text: string; lang: string; start: number; duration: number }
  // 错误（init 失败 / 解码异常等）。
  | { type: 'error'; error: string }
  // 已处理完 flush 并释放完毕（主线程据此再 terminate，避免提前杀掉 worker 丢掉最后一段）。
  | { type: 'stopped' };
