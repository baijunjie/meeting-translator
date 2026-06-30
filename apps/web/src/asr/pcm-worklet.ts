// AudioWorklet 处理器（在音频渲染线程运行）。
// Phase 1：把每个渲染量子的单声道 PCM（已是 16kHz，由 AudioContext 重采样）攒成定长帧，
// 经 port 回吐主线程。主线程 (WebAsr.handleFrame) 当前丢弃；Phase 2 喂给 sherpa-onnx WASM。
//
// 注意：worklet 在独立的 AudioWorkletGlobalScope 里运行，没有 DOM/主线程类型。
// 这里用 ts-nocheck 避开主线程 lib 与 worklet 全局（AudioWorkletProcessor/registerProcessor/
// sampleRate）的类型冲突——该文件由 Vite 单独打成 worklet 资源，不参与主 bundle。
// @ts-nocheck

// sherpa-onnx 习惯 ~100ms 一帧；16kHz 下 1600 采样点。
const FRAME_SIZE = 1600;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(FRAME_SIZE);
    this._fill = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // 单声道
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buf[this._fill++] = channel[i];
      if (this._fill === FRAME_SIZE) {
        // 拷贝出去（transfer 底层 buffer，避免复制开销）。
        const frame = this._buf.slice(0);
        this.port.postMessage(frame, [frame.buffer]);
        this._fill = 0;
      }
    }
    return true; // 保活
  }
}

registerProcessor('pcm-worklet', PcmWorklet);
