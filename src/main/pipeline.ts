import path from 'node:path';
import fs from 'node:fs';
import {
  Vad,
  OfflineRecognizer,
  type SpeechSegment,
} from 'sherpa-onnx-node';
import type { SegmentPayload, PartialPayload } from '../shared/types';

export const SAMPLE_RATE = 16000;
const VAD_WINDOW_SIZE = 512;

const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';

// VAD 确认语音需要几帧，起始点会偏晚导致句首截字；识别时向前回补这段时长
const SEGMENT_PAD_SECONDS = 0.24;
// 历史缓冲上限（秒），用于段前回补和实时部分识别
const MAX_HISTORY_SECONDS = 30;

// 说话过程中每隔这么久就对当前未结束的语音做一次部分识别，让文字实时出现
const PARTIAL_INTERVAL_SECONDS = 0.6;
// 检测到语音时，部分识别向前回看的时长（弥补 VAD 确认偏晚）
const PARTIAL_LOOKBACK_SECONDS = 0.6;

interface PipelineCallbacks {
  onSegment: (segment: SegmentPayload) => void;
  onPartial?: (partial: PartialPayload) => void;
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
      `模型文件缺失: ${missing.join(', ')}。请先运行 npm run download-models`
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

  // 部分识别状态
  private inSpeech = false;
  private partialStart = 0; // 当前这段部分识别的起始采样
  private partialFloor = 0; // 已最终确定的音频边界，部分识别不回看到此之前
  private lastPartialAt = 0; // 上次做部分识别时的 totalSamples

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
          maxSpeechDuration: 15,
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
    this.drainSegments();
    this.updatePartial();
  }

  /** 录音结束时调用，把 VAD 中未闭合的语音段吐出来 */
  flush(): void {
    this.vad.flush();
    this.drainSegments();
    this.inSpeech = false;
    this.onPartial({ text: '' });
  }

  private drainSegments(): void {
    while (!this.vad.isEmpty()) {
      // false: 不用 external buffer，Electron 禁止 N-API external buffer
      const segment = this.vad.front(false);
      this.vad.pop();
      this.processSegment(segment);
    }
  }

  private processSegment(segment: SpeechSegment): void {
    const duration = segment.samples.length / SAMPLE_RATE;
    // 段前回补一小段音频，弥补 VAD 起始点偏晚造成的句首截字。
    // 段间静音 >= minSilenceDuration，回补不会带入上一个人的声音
    const pad = this.historySlice(
      Math.max(0, segment.start - Math.round(SEGMENT_PAD_SECONDS * SAMPLE_RATE)),
      segment.start
    );
    const padded = new Float32Array(pad.length + segment.samples.length);
    padded.set(pad);
    padded.set(segment.samples, pad.length);

    // 该段已最终确定，部分识别不应再回看到它之前的音频
    this.partialFloor = segment.start + segment.samples.length;
    this.onPartial({ text: '' });

    const result = this.transcribe(padded);
    if (!result.text) {
      return; // 纯噪音段
    }

    this.onSegment({
      id: this.segmentId++,
      text: result.text,
      lang: result.lang,
      start: segment.start / SAMPLE_RATE,
      duration,
    });
  }

  /** 说话过程中周期性地识别当前未结束的语音，产生实时的部分结果 */
  private updatePartial(): void {
    if (this.vad.isDetected()) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        const lookback = Math.round(PARTIAL_LOOKBACK_SECONDS * SAMPLE_RATE);
        this.partialStart = Math.max(this.partialFloor, this.totalSamples - lookback);
        this.lastPartialAt = 0;
      }
      const interval = Math.round(PARTIAL_INTERVAL_SECONDS * SAMPLE_RATE);
      if (this.totalSamples - this.lastPartialAt >= interval) {
        const from = Math.max(this.partialStart, this.partialFloor);
        const audio = this.historySlice(from, this.totalSamples);
        const result = this.transcribe(audio);
        if (result.text) {
          this.onPartial({ text: result.text });
        }
        this.lastPartialAt = this.totalSamples;
      }
    } else if (this.inSpeech) {
      this.inSpeech = false;
      // 最终段已在 drainSegments 里吐出，这里清掉残留的部分结果
      this.onPartial({ text: '' });
    }
  }

  private transcribe(samples: Float32Array): { text: string; lang: string } {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream);
    return {
      text: (result.text || '').trim(),
      // SenseVoice 的语言标记形如 <|zh|>
      lang: (result.lang || '').replace(/[<|>]/g, ''),
    };
  }
}
