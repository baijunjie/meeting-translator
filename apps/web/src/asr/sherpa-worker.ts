// sherpa-onnx WASM 识别 Worker（经典 Web Worker，非 ESM）。
//
// 为什么是经典 Worker：Emscripten 的胶水 (sherpa-onnx-wasm-main-vad-asr.js) 与两个包装器
// (sherpa-onnx-vad.js / sherpa-onnx-asr.js) 都是 UMD/全局脚本，需用 importScripts 加载，
// 不能走 ESM import。Vite 用 `new Worker(url, { type: 'classic' })` 起它（见 web-asr.ts）。
//
// 运行模型：Silero VAD（512 采样窗口@16k）+ SenseVoice 离线识别（int8）。
// 单线程 WASM 构建 → 无需 COOP/COEP。模型由主线程下载/缓存后，以字节数组传进来，
// 这里 Module.FS.writeFile 写入 MEMFS，再让 recognizer/VAD 指向这些扁平文件名。
//
// 切段策略移植自 apps/macos 的 TranscriptionPipeline：
//  - 维护历史缓冲（最多 60s），按 512 采样窗口喂 VAD；
//  - 用 vad.isDetected() 自行切段（静音→语音开段、语音→静音定稿、超长兜底在能量最低点断句）；
//  - 段内周期性做部分识别（partial），自适应降频。
//
// 注意：本文件被 Vite 当作 worker 入口打包；它不参与主 bundle，用 ts-nocheck 避开
// DOM/ESM 与 Worker 全局 + 动态注入的 sherpa 全局（Module/createVad/OfflineRecognizer/
// CircularBuffer）之间的类型冲突。协议字段见 ./worker-protocol.ts。
// @ts-nocheck
/// <reference lib="webworker" />

// ===== 常量（与 apps/macos asr-process 对齐） =====
const SAMPLE_RATE = 16000;
const VAD_WINDOW_SIZE = 512;
const MAX_HISTORY_SECONDS = 60;
const MIN_SILENCE_SECONDS = 0.35;
const MAX_SEGMENT_SECONDS = 7;
const SPLIT_SEARCH_SECONDS = 2;
const MIN_SEGMENT_SECONDS = 4;
const PARTIAL_INTERVAL_SECONDS = 0.6;
const PARTIAL_LOOKBACK_SECONDS = 0.6;
const PARTIAL_MAX_WINDOW_SECONDS = 8;

// SenseVoice VAD 参数（句首不截断：偏低阈值更早进入语音态）。
const VAD_THRESHOLD = 0.35;
const VAD_MIN_SPEECH = 0.25;

// 文本清理（CJK 去空格 + 折叠复读）。
const REPEAT_MIN = 4;
const REPEAT_KEEP = 2;
const REPEAT_MAX_UNIT = 4;
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff\\uff66-\\uff9f';
const CJK_SPACE_RE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');

function stripCjkSpaces(text) {
  return text.replace(CJK_SPACE_RE, '$1');
}
function gramEqual(chars, a, b, unit) {
  for (let k = 0; k < unit; k++) {
    if (chars[a + k] !== chars[b + k]) return false;
  }
  return true;
}
function collapseRepeats(text) {
  let chars = Array.from(text);
  for (let unit = 1; unit <= REPEAT_MAX_UNIT; unit++) {
    if (chars.length < unit * REPEAT_MIN) continue;
    const out = [];
    let i = 0;
    while (i < chars.length) {
      if (i + unit > chars.length) {
        out.push(chars[i]);
        i++;
        continue;
      }
      let count = 1;
      let j = i + unit;
      while (j + unit <= chars.length && gramEqual(chars, i, j, unit)) {
        count++;
        j += unit;
      }
      if (count >= REPEAT_MIN) {
        for (let k = 0; k < REPEAT_KEEP * unit; k++) out.push(chars[i + k]);
        i = j;
      } else {
        out.push(chars[i]);
        i++;
      }
    }
    chars = out;
  }
  return chars.join('');
}
function cleanAsrText(text) {
  return collapseRepeats(stripCjkSpaces(text.trim()));
}

// ===== 全局：sherpa 胶水注入的对象（importScripts 后可用） =====
// 不要在此声明 `let Module`：Emscripten 胶水在 worker 全局用 `var Module` 声明，
// 与 lexical 的 let/const 同名会报 "Identifier 'Module' has already been declared"。
// 统一用 self.Module 引用胶水模块（胶水会复用我们预设到 self.Module 的配置对象）。
let vad = null;
let recognizer = null;
let pipeline = null;
let frameQueue = []; // init 完成前先暂存帧

function post(msg) {
  // segment/partial 等小对象，直接 postMessage。
  self.postMessage(msg);
}

// ===== 识别管线（移植自 macOS TranscriptionPipeline） =====
class TranscriptionPipeline {
  constructor() {
    this.pending = new Float32Array(0);
    this.historyChunks = [];
    this.totalSamples = 0;
    this.segmentId = 0;
    this.speechActive = false;
    this.segStart = 0;
    this.speechEnd = 0;
    this.partialFloor = 0;
    this.lastPartialAt = 0;
    this.partialGap = Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE);

    // VAD（Silero）：模型已以扁平名 silero_vad.onnx 写入 FS。
    vad = createVad(self.Module, {
      sileroVad: {
        model: './silero_vad.onnx',
        threshold: VAD_THRESHOLD,
        minSpeechDuration: VAD_MIN_SPEECH,
        minSilenceDuration: MIN_SILENCE_SECONDS,
        windowSize: VAD_WINDOW_SIZE,
        // maxSpeechDuration 用包装器默认值 20s：我们靠 isDetected() + MAX_SEGMENT_SECONDS 自切段，
        // 不消费 VAD 内部段队列，故无需让 VAD 提前强制断句（与 apps/macos 行为一致）。
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      bufferSizeInSeconds: 120,
    });

    // SenseVoice 离线识别。tokens.txt 与 model.int8.onnx 已写入 FS（扁平名）。
    recognizer = new OfflineRecognizer(
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

    // 预热一次（吞掉首次构图开销，避免首段卡顿）。
    try {
      this.transcribe(new Float32Array(SAMPLE_RATE));
    } catch {
      /* ignore warmup error */
    }
  }

  rememberHistory(samples) {
    this.historyChunks.push({ start: this.totalSamples, samples: samples.slice() });
    this.totalSamples += samples.length;
    const cutoff = this.totalSamples - MAX_HISTORY_SECONDS * SAMPLE_RATE;
    while (
      this.historyChunks.length > 0 &&
      this.historyChunks[0].start + this.historyChunks[0].samples.length < cutoff
    ) {
      this.historyChunks.shift();
    }
  }

  historySlice(from, to) {
    const out = new Float32Array(Math.max(0, to - from));
    for (const chunk of this.historyChunks) {
      const begin = Math.max(from, chunk.start);
      const end = Math.min(to, chunk.start + chunk.samples.length);
      if (begin < end) {
        out.set(chunk.samples.subarray(begin - chunk.start, end - chunk.start), begin - from);
      }
    }
    return out;
  }

  acceptWaveform(samples) {
    this.rememberHistory(samples);
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);
    let offset = 0;
    while (offset + VAD_WINDOW_SIZE <= merged.length) {
      vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW_SIZE));
      offset += VAD_WINDOW_SIZE;
    }
    this.pending = merged.slice(offset);
    // 我们靠 isDetected() 自切段，不消费 VAD 内部的段队列，但仍要把它排空避免无限增长。
    while (!vad.isEmpty()) {
      vad.pop();
    }
    this.updateSpeech();
  }

  flush() {
    vad.flush();
    while (!vad.isEmpty()) {
      vad.pop();
    }
    if (this.speechActive) {
      this.finalizeSegment(this.segStart, this.totalSamples);
      this.speechActive = false;
    }
    post({ type: 'partial', text: '' });
  }

  updateSpeech() {
    const detected = vad.isDetected();
    if (detected) {
      if (!this.speechActive) {
        this.speechActive = true;
        const lookback = Math.round(PARTIAL_LOOKBACK_SECONDS * SAMPLE_RATE);
        this.segStart = Math.max(this.partialFloor, this.totalSamples - lookback);
        this.lastPartialAt = 0;
        this.partialGap = Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE);
      }
      this.speechEnd = this.totalSamples;
      if (this.totalSamples - this.segStart >= MAX_SEGMENT_SECONDS * SAMPLE_RATE) {
        const earliest = this.segStart + Math.round(MIN_SEGMENT_SECONDS * SAMPLE_RATE);
        const from = Math.max(
          earliest,
          this.totalSamples - Math.round(SPLIT_SEARCH_SECONDS * SAMPLE_RATE),
        );
        const cut = this.quietestPoint(from, this.totalSamples);
        this.finalizeSegment(this.segStart, cut);
        this.segStart = cut;
      }
      this.maybePartial();
    } else if (this.speechActive) {
      if (this.totalSamples - this.speechEnd >= MIN_SILENCE_SECONDS * SAMPLE_RATE) {
        this.speechActive = false;
        this.finalizeSegment(this.segStart, this.speechEnd);
        post({ type: 'partial', text: '' });
      }
    }
  }

  quietestPoint(from, to) {
    const win = Math.round(0.1 * SAMPLE_RATE);
    if (to - from <= win) return to;
    const audio = this.historySlice(from, to);
    const hop = Math.round(win / 2);
    let bestOffset = 0;
    let bestEnergy = Infinity;
    for (let i = 0; i + win <= audio.length; i += hop) {
      let e = 0;
      for (let k = 0; k < win; k++) e += audio[i + k] * audio[i + k];
      if (e < bestEnergy) {
        bestEnergy = e;
        bestOffset = i;
      }
    }
    return from + bestOffset + Math.floor(win / 2);
  }

  maybePartial() {
    if (this.totalSamples - this.lastPartialAt < this.partialGap) return;
    const maxWindow = PARTIAL_MAX_WINDOW_SECONDS * SAMPLE_RATE;
    const from = Math.max(this.segStart, this.totalSamples - maxWindow);
    const audio = this.historySlice(from, this.totalSamples);
    const t0 = Date.now();
    const result = this.transcribe(audio);
    const decodeSamples = ((Date.now() - t0) / 1e3) * SAMPLE_RATE;
    this.partialGap = Math.max(
      Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE),
      Math.round(decodeSamples * 1.5),
    );
    if (result.text) {
      post({ type: 'partial', text: result.text });
    }
    this.lastPartialAt = this.totalSamples;
  }

  finalizeSegment(from, to) {
    if (to <= from) return;
    this.partialFloor = to;
    post({ type: 'partial', text: '' });
    const audio = this.historySlice(from, to);
    const result = this.transcribe(audio);
    if (!result.text || !/[\p{L}\p{N}]/u.test(result.text)) {
      return;
    }
    post({
      type: 'segment',
      id: this.segmentId++,
      text: result.text,
      lang: result.lang,
      start: from / SAMPLE_RATE,
      duration: (to - from) / SAMPLE_RATE,
    });
  }

  transcribe(samples) {
    const stream = recognizer.createStream();
    stream.acceptWaveform(SAMPLE_RATE, samples);
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    stream.free();
    return {
      text: cleanAsrText(result.text || ''),
      // SenseVoice 的语言标记形如 <|zh|>；getResult 的 JSON 字段名为 lang。
      lang: (result.lang || '').replace(/[<|>]/g, ''),
    };
  }
}

// ===== init：加载 WASM 胶水 + 写入模型 + 建管线 =====
function loadGlue(baseUrl) {
  return new Promise((resolve, reject) => {
    // baseUrl 形如 `${origin}${BASE_PATH}sherpa/`，三个脚本都在该目录下。
    const M = {
      locateFile: (path) => baseUrl + path, // 让 .wasm/.data 从 sherpa/ 目录加载
      onRuntimeInitialized: () => resolve(M),
    };
    // 暴露为全局，供胶水脚本读取/写入（胶水的 `var Module` 会复用它）。
    self.Module = M;
    try {
      // 包装器（定义 createVad / OfflineRecognizer / CircularBuffer 等全局），再加载胶水。
      importScripts(baseUrl + 'sherpa-onnx-vad.js');
      importScripts(baseUrl + 'sherpa-onnx-asr.js');
      importScripts(baseUrl + 'sherpa-onnx-wasm-main-vad-asr.js');
    } catch (e) {
      reject(e);
    }
  });
}

async function handleInit(msg) {
  try {
    const M = await loadGlue(msg.sherpaBaseUrl);
    // 把模型字节写入 WASM MEMFS（扁平文件名，recognizer/VAD 用 './<name>' 引用）。
    for (const { name, bytes } of msg.models) {
      M.FS.writeFile(name, bytes);
    }
    pipeline = new TranscriptionPipeline();
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
      // 回执：主线程收到后才 terminate（确保上面 flush 回吐的最后一段已送达）。
      post({ type: 'stopped' });
      break;
    default:
      break;
  }
};
