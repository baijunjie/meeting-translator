// sherpa-onnx WASM 识别 Worker（module worker）。
//
// 切段策略与文本清理在 @rt/core 的 TranscriptionPipeline（与 macOS 共用同一实现），
// 这里只负责平台绑定的部分：加载 Emscripten 胶水、把模型字节写入 WASM FS、
// 用 createVad/OfflineRecognizer 实现 core 的 AsrInferenceEngine，以及消息协议。
//
// 为什么是 module worker + fetch/eval：worker 需要 import @rt/core，而 Vite 在 dev
// 模式不打包 classic worker（import 语句会原样送达浏览器、直接 SyntaxError），
// module worker 则 dev（原生 ESM）与 build（打包）都成立。module worker 没有
// importScripts，胶水与两个包装器又是「顶层声明共享全局」的 classic 脚本，故用
// fetch + 间接 eval 在全局作用域执行，并在 eval 末尾把所需符号显式挂到 self
// （兼容 function/class/const 任意声明形式）。
//
// 运行模型：Silero VAD（512 采样窗口@16k）+ SenseVoice 离线识别（int8）。
// 单线程 WASM 构建 → 无需 COOP/COEP。模型由主线程下载/缓存后以字节数组传进来。
// worker 跨录音会话复用（stop 只 flush 不销毁）：模型常驻 MEMFS，再次开始录音
// 只需 reset 计时基线，免去重读 ~230MB 模型与重新构图预热。
//
// 用 ts-nocheck 避开 Worker 全局 + 动态注入的 sherpa 全局（Module/createVad/
// OfflineRecognizer）之间的类型冲突。协议字段见 ./worker-protocol.ts。
// @ts-nocheck
/// <reference lib="webworker" />
import { TranscriptionPipeline, SAMPLE_RATE, VAD_WINDOW_SIZE, MIN_SILENCE_SECONDS } from '@rt/core';

// SenseVoice VAD 参数（句首不截断：偏低阈值更早进入语音态）。
const VAD_THRESHOLD = 0.35;
const VAD_MIN_SPEECH = 0.25;

let vad = null;
let recognizer = null;
let pipeline = null;
let frameQueue = []; // init 完成前先暂存帧

function post(msg) {
  self.postMessage(msg);
}

/**
 * 加载 classic 全局脚本：fetch 源码后间接 eval（全局作用域执行，var/function 顶层
 * 声明直接成为 worker 全局），末尾追加 self.<name> = <name> 把 exportNames 显式挂到
 * 全局——覆盖 class/const 等词法声明在 eval 结束后即被丢弃的情形。
 */
async function importClassicScript(url, exportNames) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`加载失败 ${url}: HTTP ${res.status}`);
  }
  const code = await res.text();
  const exports = exportNames
    .map((n) => `if (typeof ${n} !== 'undefined') self.${n} = ${n};`)
    .join('\n');
  (0, eval)(`${code}\n;${exports}\n//# sourceURL=${url}`);
}

/** 加载 sherpa 胶水（包装器先、Emscripten 胶水后），resolve 于 WASM 运行时就绪。 */
async function loadGlue(baseUrl) {
  // 预设配置对象：胶水的 `var Module = typeof Module != "undefined" ? Module : {}` 会复用它。
  const M = {
    locateFile: (path) => baseUrl + path, // 让 .wasm/.data 从 sherpa/ 目录加载
  };
  const ready = new Promise((resolve, reject) => {
    M.onRuntimeInitialized = () => resolve();
    // wasm 取不到（404/离线）或实例化失败时 Emscripten 会 abort：转成 reject，
    // 否则运行时永不初始化、ready 永久 pending，主线程 start() 随之永久挂起。
    M.onAbort = (reason) => reject(new Error(`sherpa WASM 加载失败: ${reason ?? 'abort'}`));
  });
  self.Module = M;
  await importClassicScript(baseUrl + 'sherpa-onnx-vad.js', ['createVad', 'CircularBuffer']);
  await importClassicScript(baseUrl + 'sherpa-onnx-asr.js', [
    'OfflineRecognizer',
    'createOnlineRecognizer',
  ]);
  await importClassicScript(baseUrl + 'sherpa-onnx-wasm-main-vad-asr.js', ['Module']);
  await ready;
  return self.Module;
}

// ===== init：加载 WASM 胶水 + 写入模型 + 建引擎与管线 =====
async function handleInit(msg) {
  try {
    const M = await loadGlue(msg.sherpaBaseUrl);
    // 把模型字节写入 WASM MEMFS（扁平文件名，recognizer/VAD 用 './<name>' 引用）。
    for (const { name, bytes } of msg.models) {
      M.FS.writeFile(name, bytes);
    }

    // VAD（Silero）。maxSpeechDuration 用包装器默认值 20s：切段由 core 管线负责，
    // 不消费 VAD 内部段队列，无需让 VAD 提前强制断句。
    vad = self.createVad(self.Module, {
      sileroVad: {
        model: './silero_vad.onnx',
        threshold: VAD_THRESHOLD,
        minSpeechDuration: VAD_MIN_SPEECH,
        minSilenceDuration: MIN_SILENCE_SECONDS,
        windowSize: VAD_WINDOW_SIZE,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      bufferSizeInSeconds: 120,
    });

    // SenseVoice 离线识别。tokens.txt 与 model.int8.onnx 已写入 FS（扁平名）。
    recognizer = new self.OfflineRecognizer(
      {
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          senseVoice: {
            model: './model.int8.onnx',
            useInverseTextNormalization: 1,
          },
          tokens: './tokens.txt',
          numThreads: 1,
          debug: 0,
        },
      },
      self.Module,
    );

    // core 管线对推理引擎的最小依赖（见 @rt/core AsrInferenceEngine）。
    const engine = {
      acceptVadWindow: (samples) => vad.acceptWaveform(samples),
      isSpeechDetected: () => vad.isDetected(),
      drainVad: () => {
        while (!vad.isEmpty()) {
          vad.pop();
        }
      },
      flushVad: () => vad.flush(),
      transcribe: (samples) => {
        const stream = recognizer.createStream();
        stream.acceptWaveform(SAMPLE_RATE, samples);
        recognizer.decode(stream);
        const result = recognizer.getResult(stream);
        stream.free();
        return { text: result.text || '', lang: result.lang || '' };
      },
    };

    // 预热一次（吞掉首次构图开销，避免首段卡顿）。
    try {
      engine.transcribe(new Float32Array(SAMPLE_RATE));
    } catch {
      /* ignore warmup error */
    }

    pipeline = new TranscriptionPipeline(engine, {
      onSegment: (seg) => post({ type: 'segment', ...seg }),
      onPartial: (p) => post({ type: 'partial', text: p.text }),
    });
    post({ type: 'ready' });
    // 排空 init 前积压的帧。
    const queued = frameQueue;
    frameQueue = [];
    for (const samples of queued) pipeline.acceptWaveform(samples);
  } catch (e) {
    post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      void handleInit(msg);
      break;
    case 'frame':
      if (pipeline) {
        try {
          pipeline.acceptWaveform(msg.samples);
        } catch (e) {
          post({ type: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        // init 尚未完成：暂存（避免丢句首）。
        frameQueue.push(msg.samples);
      }
      break;
    case 'flush':
      if (pipeline) {
        try {
          pipeline.flush();
        } catch {
          /* ignore */
        }
      }
      // 回执：flush 定稿的最后一段 segment 已按消息顺序先行送达。
      post({ type: 'flushed' });
      break;
    case 'reset':
      // 新一次录音会话：worker/模型复用，只重置计时基线与跨会话残留。
      pipeline?.reset();
      break;
    case 'stop':
      try {
        if (vad) vad.free();
        if (recognizer) recognizer.free();
      } catch {
        /* ignore */
      }
      vad = null;
      recognizer = null;
      pipeline = null;
      frameQueue = [];
      post({ type: 'stopped' });
      break;
    default:
      break;
  }
};
