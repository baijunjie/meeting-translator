import path from 'node:path';
import fs from 'node:fs';
import { Vad, OfflineRecognizer } from 'sherpa-onnx-node';
import type { SegmentPayload, PartialPayload } from '../shared/types';

export const SAMPLE_RATE = 16000;
const VAD_WINDOW_SIZE = 512;

const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';

// 历史缓冲上限（秒），用于段前回补和实时部分识别
const MAX_HISTORY_SECONDS = 30;

// 连续说话强制断句的时长上限（秒）。注意：sherpa-onnx-node 1.13.3 的 silero VAD
// 原生 maxSpeechDuration 不生效（实测连续说话不会被切分），所以这里自己实现：
// 单段未闭合语音一旦超过该时长就强制定稿，避免长段迟迟不出结果、且长音频一次性
// 解码时 SenseVoice 容易丢内容。
const MAX_SEGMENT_SECONDS = 8;

// 说话过程中每隔这么久就对当前未结束的语音做一次部分识别，让文字实时出现（最小间隔）
const PARTIAL_INTERVAL_SECONDS = 0.6;
// 检测到语音时，部分识别向前回看的时长（弥补 VAD 确认偏晚）
const PARTIAL_LOOKBACK_SECONDS = 0.6;
// 部分识别单次最多回看的音频时长：防止长句/连续说话时重复解码的窗口无限增长，
// 否则单次解码会超过实时、拖垮主进程，导致 VAD 段迟迟无法闭合（不出定稿、不翻译）
const PARTIAL_MAX_WINDOW_SECONDS = 8;

interface PipelineCallbacks {
  onSegment: (segment: SegmentPayload) => void;
  onPartial?: (partial: PartialPayload) => void;
}

// 连续重复达到这个次数才视为退化（复读机幻觉），折叠
const REPEAT_MIN = 4;
// 折叠后保留的份数（保留少量，既不刷屏又能看出原文带重复）
const REPEAT_KEEP = 2;
// 重复检测的最大单元长度（覆盖单字到短词的复读，如「快快…」「公公…」「ABAB…」）
const REPEAT_MAX_UNIT = 4;

// CJK 字符集合：平假名/片假名、CJK 扩展A+统一表意、兼容表意、半角片假名
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uf900-\\ufaff\\uff66-\\uff9f';
// SenseVoice 对中日韩会逐 token 输出并夹空格，去掉 CJK 之间的空格
const CJK_SPACE_RE = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');

function stripCjkSpaces(text: string): string {
  return text.replace(CJK_SPACE_RE, '$1');
}

function gramEqual(chars: string[], a: number, b: number, unit: number): boolean {
  for (let k = 0; k < unit; k++) {
    if (chars[a + k] !== chars[b + k]) return false;
  }
  return true;
}

/**
 * 折叠 ASR 退化产生的连续重复：同一段 1~REPEAT_MAX_UNIT 字的单元连续重复
 * 达到 REPEAT_MIN 次时，收敛为 REPEAT_KEEP 份。阈值偏保守，避免误伤
 * 「そうそう」「いいい」这类正常的少量重叠。
 */
function collapseRepeats(text: string): string {
  let chars = Array.from(text); // 按码点切分，避免破坏代理对
  for (let unit = 1; unit <= REPEAT_MAX_UNIT; unit++) {
    if (chars.length < unit * REPEAT_MIN) continue;
    const out: string[] = [];
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

/** ASR 原始文本后处理：去 CJK 空格 + 折叠复读机幻觉 */
function cleanAsrText(text: string): string {
  return collapseRepeats(stripCjkSpaces(text.trim()));
}

interface HistoryChunk {
  start: number;
  samples: Float32Array;
}

function assertModelsExist(modelsDir: string): void {
  const required = [
    'silero_vad.onnx',
    path.join(SENSE_VOICE_DIR, 'model.int8.onnx'),
    path.join(SENSE_VOICE_DIR, 'tokens.txt'),
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(modelsDir, f)));
  if (missing.length > 0) {
    throw new Error(
      `模型文件缺失: ${missing.join(', ')}。请重启应用以重新下载模型`
    );
  }
}

/**
 * 实时转写管线：16kHz 单声道 PCM 输入，输出文本段。
 *
 * 流程: 音频 -> Silero VAD 切出语音段 -> SenseVoice 识别文本
 *
 * 为了让文字实时出现，说话过程中会周期性地对“尚未结束”的语音做部分识别
 * （onPartial），语音段结束后再吐出最终结果（onSegment）。
 */
export class TranscriptionPipeline {
  private readonly onSegment: (segment: SegmentPayload) => void;
  private readonly onPartial: (partial: PartialPayload) => void;

  private readonly vad: Vad;
  private readonly recognizer: OfflineRecognizer;

  // VAD 要求按固定窗口大小喂数据，这里做积攒
  private pending = new Float32Array(0);
  // 最近音频的历史缓冲
  private historyChunks: HistoryChunk[] = [];
  private totalSamples = 0;

  // 定稿段自增序号，供译文异步回填对应
  private segmentId = 0;

  // 切段 / 部分识别状态
  private speechActive = false; // 当前是否处于一段语音中
  private segStart = 0; // 当前未闭合语音段的起始采样（含句首回看）
  private partialFloor = 0; // 已最终确定的音频边界，部分识别不回看到此之前
  private lastPartialAt = 0; // 上次做部分识别时的 totalSamples
  private partialGap = Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE); // 自适应间隔（采样）

  constructor(modelsDir: string, callbacks: PipelineCallbacks) {
    assertModelsExist(modelsDir);
    this.onSegment = callbacks.onSegment;
    this.onPartial = callbacks.onPartial ?? (() => {});

    this.vad = new Vad(
      {
        sileroVad: {
          model: path.join(modelsDir, 'silero_vad.onnx'),
          // 偏低的阈值让 VAD 更早进入语音状态，减少句首被截断
          threshold: 0.35,
          minSpeechDuration: 0.25,
          minSilenceDuration: 0.6,
          // 注意：该版本原生 maxSpeechDuration 不生效，连续说话的强制断句改由
          // 管线用 MAX_SEGMENT_SECONDS 自行实现（见 updateSpeech）
          maxSpeechDuration: MAX_SEGMENT_SECONDS,
          windowSize: VAD_WINDOW_SIZE,
        },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        debug: 0,
      },
      120 // 内部环形缓冲区时长(秒)
    );

    this.recognizer = new OfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: path.join(modelsDir, SENSE_VOICE_DIR, 'model.int8.onnx'),
          useInverseTextNormalization: 1,
        },
        tokens: path.join(modelsDir, SENSE_VOICE_DIR, 'tokens.txt'),
        numThreads: 2,
        debug: 0,
      },
    });

    // 预热识别器：ONNX 首次推理要做图优化/线程池/内存分配（可能数秒）。
    // 在构造期（=“加载模型中”，此时尚未开始采集音频）先用 1s 静音跑一次，
    // 把这次冷启动开销挪走，避免用户已经在说话时第一次推理拖垮实时管线。
    try {
      this.transcribe(new Float32Array(SAMPLE_RATE));
    } catch {
      // 预热失败忽略，不影响正常使用
    }
  }

  private rememberHistory(samples: Float32Array): void {
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

  /** 从历史缓冲取出 [from, to) 区间的采样，越界部分忽略 */
  private historySlice(from: number, to: number): Float32Array {
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

  /** @param samples 16kHz 单声道 */
  acceptWaveform(samples: Float32Array): void {
    this.rememberHistory(samples);
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending);
    merged.set(samples, this.pending.length);

    let offset = 0;
    while (offset + VAD_WINDOW_SIZE <= merged.length) {
      this.vad.acceptWaveform(merged.subarray(offset, offset + VAD_WINDOW_SIZE));
      offset += VAD_WINDOW_SIZE;
    }
    this.pending = merged.slice(offset);
    // 我们只用 VAD 的 isDetected() 判定语音/静音，自己按历史缓冲切段；
    // VAD 内部完成的段不再使用，排空以释放其环形缓冲
    while (!this.vad.isEmpty()) {
      this.vad.pop();
    }
    this.updateSpeech();
  }

  /** 录音结束时调用，把未闭合的语音段定稿 */
  flush(): void {
    this.vad.flush();
    while (!this.vad.isEmpty()) {
      this.vad.pop();
    }
    if (this.speechActive) {
      this.finalizeSegment(this.segStart, this.totalSamples);
      this.speechActive = false;
    }
    this.onPartial({ text: '' });
  }

  /**
   * 基于 VAD 的 isDetected() 自行切段：
   * - 静音→语音：开一段（起点向前回看，弥补 VAD 确认偏晚导致的句首截字）
   * - 语音中超过 MAX_SEGMENT_SECONDS：强制定稿，继续作为新段（VAD 原生上限不生效）
   * - 语音→静音：定稿当前段
   * 段内周期性做部分识别，文字实时出现。
   */
  private updateSpeech(): void {
    const detected = this.vad.isDetected();

    if (detected && !this.speechActive) {
      this.speechActive = true;
      const lookback = Math.round(PARTIAL_LOOKBACK_SECONDS * SAMPLE_RATE);
      this.segStart = Math.max(this.partialFloor, this.totalSamples - lookback);
      this.lastPartialAt = 0;
      this.partialGap = Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE);
    }

    if (this.speechActive && this.totalSamples - this.segStart >= MAX_SEGMENT_SECONDS * SAMPLE_RATE) {
      // 连续说话超上限：先把已累积的吐成一段，再从当前点续接新段
      this.finalizeSegment(this.segStart, this.totalSamples);
      this.segStart = this.totalSamples;
    }

    if (!detected && this.speechActive) {
      this.speechActive = false;
      this.finalizeSegment(this.segStart, this.totalSamples);
      this.onPartial({ text: '' });
      return;
    }

    if (this.speechActive) {
      this.maybePartial();
    }
  }

  /** 段内周期性部分识别（自适应降频 + 回看窗口封顶） */
  private maybePartial(): void {
    if (this.totalSamples - this.lastPartialAt < this.partialGap) return;
    const maxWindow = PARTIAL_MAX_WINDOW_SECONDS * SAMPLE_RATE;
    const from = Math.max(this.segStart, this.totalSamples - maxWindow);
    const audio = this.historySlice(from, this.totalSamples);
    const t0 = Date.now();
    const result = this.transcribe(audio);
    const decodeSamples = ((Date.now() - t0) / 1000) * SAMPLE_RATE;
    // 自适应降频：部分识别约只占用 2/3 时间，给 VAD/音频处理留余量（慢机自动降频）
    this.partialGap = Math.max(
      Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE),
      Math.round(decodeSamples * 1.5)
    );
    if (result.text) {
      this.onPartial({ text: result.text });
    }
    this.lastPartialAt = this.totalSamples;
  }

  /** 把历史缓冲 [from, to) 这段音频定稿为一个最终段 */
  private finalizeSegment(from: number, to: number): void {
    if (to <= from) return;
    // 该段已最终确定，部分识别不应再回看到它之前
    this.partialFloor = to;
    this.onPartial({ text: '' });

    const audio = this.historySlice(from, to);
    const result = this.transcribe(audio);
    if (!result.text) {
      return; // 纯噪音段
    }

    this.onSegment({
      id: this.segmentId++,
      text: result.text,
      lang: result.lang,
      start: from / SAMPLE_RATE,
      duration: (to - from) / SAMPLE_RATE,
    });
  }

  private transcribe(samples: Float32Array): { text: string; lang: string } {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream);
    return {
      text: cleanAsrText(result.text || ''),
      // SenseVoice 的语言标记形如 <|zh|>
      lang: (result.lang || '').replace(/[<|>]/g, ''),
    };
  }
}
