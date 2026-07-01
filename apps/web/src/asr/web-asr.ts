// Web ASR 执行层（Phase 2 = 真识别）。
//
// 这是桥接 (../bridge.ts) 调用的统一接口：start() 起一条「采麦 → 16kHz 单声道 PCM → sherpa-onnx
// WASM（Silero VAD + SenseVoice）」的实时识别管线，stop() 拆除。
//
// 架构：
//  - 采麦：getUserMedia + AudioContext(16k) + AudioWorklet（见 ./pcm-worklet.ts），每 100ms 一帧。
//  - 识别：放在经典 Web Worker（./sherpa-worker.ts，importScripts 加载 Emscripten 胶水）里跑，
//    主线程只负责把帧 postMessage 过去，避免 WASM 解码阻塞 UI。
//  - 模型：start 前确保 @rt/core ASR_MODELS 已下载并缓存（Cache Storage），再把字节传给 Worker
//    写入 WASM FS（见 ./model-store.ts）。
//  - 回吐：Worker 的 partial/segment 消息转成 @rt/core 的 PartialPayload/SegmentPayload，
//    经 onPartial/onSegment 回调上抛。

import type { SegmentPayload, PartialPayload, StatusPayload } from '@rt/core';
import { areModelsCached, ensureModelsCached, readCachedModels } from './model-store';
import type { ToWorker, FromWorker } from './worker-protocol';

// sherpa-onnx / SenseVoice 期望的采样率（与 @rt/core 模型一致）。
const SAMPLE_RATE = 16000;

export interface WebAsrCallbacks {
  onSegment?: (s: SegmentPayload) => void;
  onPartial?: (p: PartialPayload) => void;
  onStatus?: (s: StatusPayload) => void;
}

export interface WebAsrStartResult {
  ok: boolean;
  error?: string;
}

/**
 * 浏览器端实时 ASR 管线（Phase 2）：真采麦 + sherpa-onnx WASM 识别。
 * 平台特定的接缝（音频通路、WASM Worker、模型加载、回调）都收敛在这里，桥接只调 start/stop。
 */
export class WebAsr {
  private cbs: WebAsrCallbacks;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private running = false;

  constructor(cbs: WebAsrCallbacks = {}) {
    this.cbs = cbs;
  }

  setCallbacks(cbs: WebAsrCallbacks): void {
    this.cbs = cbs;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** sherpa 静态资源（胶水 + .wasm + 包装器）所在的基址（public/sherpa/，受 Vite base 影响）。 */
  private sherpaBaseUrl(): string {
    // import.meta.env.BASE_URL 形如 '/' 或 '/realtime-translator/'。
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    return new URL(`${base}sherpa/`, self.location.origin).toString();
  }

  /** 起识别 Worker：等模型缓存就绪 → 取字节 → 建 Worker → init（写 FS + 建 VAD/recognizer）。 */
  private async startWorker(): Promise<void> {
    // 确保模型已缓存（正常路径下 SetupScreen 已先下过；这里兜底，命中即秒回）。
    if (!(await areModelsCached())) {
      await ensureModelsCached();
    }
    const models = await readCachedModels();

    // 经典 Worker：sherpa 胶水用 importScripts，必须 type:'classic'。
    // Vite 会把 ./sherpa-worker.ts 单独打成 worker 资源。
    this.worker = new Worker(new URL('./sherpa-worker.ts', import.meta.url), {
      type: 'classic',
    });

    const ready = new Promise<void>((resolve, reject) => {
      const w = this.worker!;
      w.onmessage = (ev: MessageEvent<FromWorker>) => {
        const msg = ev.data;
        switch (msg.type) {
          case 'ready':
            this.workerReady = true;
            resolve();
            break;
          case 'partial':
            this.cbs.onPartial?.({ text: msg.text });
            break;
          case 'segment':
            this.cbs.onSegment?.({
              id: msg.id,
              text: msg.text,
              lang: msg.lang,
              start: msg.start,
              duration: msg.duration,
            });
            break;
          case 'error':
            if (!this.workerReady) reject(new Error(msg.error));
            this.cbs.onStatus?.({ state: 'error', error: msg.error });
            break;
        }
      };
      w.onerror = (e) => {
        if (!this.workerReady) reject(new Error(e.message || 'sherpa worker 加载失败'));
      };
    });

    // init：传模型字节（转移底层 buffer，避免拷贝）+ sherpa 资源基址。
    const initMsg: ToWorker = {
      type: 'init',
      models: Array.from(models, ([name, bytes]) => ({ name, bytes })),
      sherpaBaseUrl: this.sherpaBaseUrl(),
    };
    const transfer = initMsg.models.map((m) => m.bytes.buffer);
    this.worker.postMessage(initMsg, transfer);

    await ready;
  }

  /** 起管线：请求麦克风 → 16kHz AudioContext → AudioWorklet → sherpa Worker。 */
  async start(): Promise<WebAsrStartResult> {
    if (this.running) return { ok: true };
    this.cbs.onStatus?.({ state: 'loading' });
    try {
      // 先把识别 Worker 拉起来（含模型加载）。任何一步失败都不进入 running。
      await this.startWorker();

      // 真请求麦克风（触发浏览器权限弹窗）。仅音频。
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 16kHz 上下文：浏览器会按需重采样到该采样率，省去自己做重采样。
      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      // 标签页因自动播放策略可能挂起，恢复一下。
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      // 加载 AudioWorklet 处理器（Vite 的 ?url 拿到打包后地址）。
      const url = new URL('./pcm-worklet.ts', import.meta.url);
      await this.audioCtx.audioWorklet.addModule(url);

      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.audioCtx, 'pcm-worklet');
      // worklet 把每帧 Float32 PCM（16kHz 单声道）通过 port 回吐到主线程。
      this.worklet.port.onmessage = (ev: MessageEvent) => {
        this.handleFrame(ev.data as Float32Array);
      };
      this.source.connect(this.worklet);
      // 不连到 destination：避免把麦克风原声播回扬声器（回授）。worklet 自身会驱动 process。

      this.running = true;
      this.cbs.onStatus?.({ state: 'running' });
      return { ok: true };
    } catch (e) {
      await this.stop();
      const msg = e instanceof Error ? e.message : String(e);
      this.cbs.onStatus?.({ state: 'error', error: msg });
      return { ok: false, error: msg };
    }
  }

  /** 拆除管线，释放麦克风 + Worker。 */
  async stop(): Promise<{ ok: boolean }> {
    this.running = false;
    try {
      if (this.worklet) {
        this.worklet.port.onmessage = null;
        this.worklet.disconnect();
        this.worklet = null;
      }
      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }
      if (this.audioCtx) {
        await this.audioCtx.close().catch(() => undefined);
        this.audioCtx = null;
      }
      if (this.stream) {
        for (const track of this.stream.getTracks()) track.stop();
        this.stream = null;
      }
      const w = this.worker;
      const wasReady = this.workerReady;
      this.worker = null;
      this.workerReady = false;
      if (w) {
        if (wasReady) {
          // flush 把未闭合段定稿并回吐最后一段 segment；stop 释放后回 'stopped'。
          // 必须等 'stopped'（或超时兜底）再 terminate —— 同步 terminate 会在 worker
          // 处理 flush 前杀掉它，导致停止瞬间正在说的那句永远丢失。
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => {
              if (done) return;
              done = true;
              w.terminate();
              resolve();
            };
            w.addEventListener('message', (ev: MessageEvent) => {
              if ((ev.data as FromWorker | undefined)?.type === 'stopped') finish();
            });
            w.postMessage({ type: 'flush' } satisfies ToWorker);
            w.postMessage({ type: 'stop' } satisfies ToWorker);
            setTimeout(finish, 3000); // 兜底：worker 异常时也不挂起
          });
        } else {
          w.terminate();
        }
      }
    } finally {
      this.cbs.onStatus?.({ state: 'stopped' });
    }
    return { ok: true };
  }

  /**
   * 单帧 16kHz 单声道 PCM 到达：转发给 sherpa Worker（转移底层 buffer，零拷贝）。
   * Worker 内做 VAD 切段 + SenseVoice 识别，结果经 partial/segment 消息回吐。
   */
  private handleFrame(frame: Float32Array): void {
    if (!this.worker) return;
    const msg: ToWorker = { type: 'frame', samples: frame };
    this.worker.postMessage(msg, [frame.buffer]);
  }
}
