// macOS 端转写管线适配层：切段策略与文本清理在 @rt/core 的 TranscriptionPipeline，
// 这里只负责平台绑定的部分——模型文件检查、sherpa-onnx-node（N-API）的 VAD/识别器
// 构造与预热，并把它们包装成 core 需要的 AsrInferenceEngine 注入。
// 对 asr-process/测试脚本暴露的公开面（TranscriptionPipeline / SAMPLE_RATE）保持不变。
import path from 'node:path';
import fs from 'node:fs';
import { Vad, OfflineRecognizer } from 'sherpa-onnx-node';
import {
  SENSE_VOICE_DIR,
  SAMPLE_RATE,
  VAD_WINDOW_SIZE,
  MIN_SILENCE_SECONDS,
  TranscriptionPipeline as CorePipeline,
  type AsrInferenceEngine,
  type PipelineCallbacks,
} from '@rt/core';

export { SAMPLE_RATE } from '@rt/core';
export type { PipelineCallbacks } from '@rt/core';

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

export class TranscriptionPipeline {
  private readonly core: CorePipeline;
  private readonly vad: Vad;
  private readonly recognizer: OfflineRecognizer;

  constructor(modelsDir: string, callbacks: PipelineCallbacks) {
    assertModelsExist(modelsDir);

    this.vad = new Vad(
      {
        sileroVad: {
          model: path.join(modelsDir, 'silero_vad.onnx'),
          // 偏低的阈值让 VAD 更早进入语音状态，减少句首被截断
          threshold: 0.35,
          minSpeechDuration: 0.25,
          minSilenceDuration: MIN_SILENCE_SECONDS,
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

    const engine: AsrInferenceEngine = {
      acceptVadWindow: (samples) => this.vad.acceptWaveform(samples),
      isSpeechDetected: () => this.vad.isDetected(),
      drainVad: () => {
        while (!this.vad.isEmpty()) {
          this.vad.pop();
        }
      },
      flushVad: () => this.vad.flush(),
      transcribe: (samples) => {
        const stream = this.recognizer.createStream();
        stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
        this.recognizer.decode(stream);
        const result = this.recognizer.getResult(stream);
        return { text: result.text || '', lang: result.lang || '' };
      },
    };

    // 预热识别器：ONNX 首次推理要做图优化/线程池/内存分配（可能数秒）。
    // 在构造期（=“加载模型中”，此时尚未开始采集音频）先用 1s 静音跑一次，
    // 把这次冷启动开销挪走，避免用户已经在说话时第一次推理拖垮实时管线。
    try {
      engine.transcribe(new Float32Array(SAMPLE_RATE));
    } catch {
      // 预热失败忽略，不影响正常使用
    }

    this.core = new CorePipeline(engine, callbacks);
  }

  /** @param samples 16kHz 单声道 */
  acceptWaveform(samples: Float32Array): void {
    this.core.acceptWaveform(samples);
  }

  /** 录音结束时调用，把未闭合的语音段定稿 */
  flush(): void {
    this.core.flush();
  }

  /** 开始新一次录音会话：重置 segment.start 的计时基线 */
  reset(): void {
    this.core.reset();
  }
}
