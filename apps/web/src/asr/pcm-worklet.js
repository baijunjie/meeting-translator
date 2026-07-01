// AudioWorklet 处理器（在音频渲染线程运行）。
// 把每个渲染量子的单声道 PCM（已是 16kHz，由 AudioContext 重采样）攒成定长帧，
// 经 port 回吐主线程（WebAsr.handleFrame → sherpa-onnx WASM）。
//
// ⚠️ 必须是 .js 而非 .ts：本文件经 `new URL('./pcm-worklet.js', import.meta.url)` +
// `audioWorklet.addModule()` 加载。生产构建时 Vite 会把它内联成 data URL，MIME 按扩展名推断。
// `.ts` 会得到 `video/mp2t`，被浏览器的 worklet 加载器按 MIME 拒收（"Unable to load a worklet's
// module"）；`.js` 才是 `text/javascript`。worklet 跑在独立的 AudioWorkletGlobalScope，
// 没有 DOM/主线程类型，本就无需 TS。

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
