// sherpa-onnx-node 没有自带 .d.ts，这里只声明本项目实际用到的 API 表面。
declare module 'sherpa-onnx-node' {
  export interface SileroVadConfig {
    model: string;
    threshold?: number;
    minSpeechDuration?: number;
    minSilenceDuration?: number;
    maxSpeechDuration?: number;
    windowSize?: number;
  }

  export interface VadConfig {
    sileroVad: SileroVadConfig;
    sampleRate: number;
    numThreads?: number;
    debug?: number;
  }

  export interface SpeechSegment {
    samples: Float32Array;
    /** 段起始处在整段音频里的绝对采样序号 */
    start: number;
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    flush(): void;
    clear(): void;
    reset(): void;
  }

  export interface OfflineRecognizerConfig {
    featConfig?: { sampleRate: number; featureDim: number };
    modelConfig: {
      senseVoice?: { model: string; useInverseTextNormalization?: number };
      tokens: string;
      numThreads?: number;
      debug?: number;
    };
  }

  export interface OfflineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  }

  export interface OfflineResult {
    text: string;
    /** SenseVoice 的语言标记，形如 "<|zh|>" */
    lang: string;
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): OfflineResult;
  }

  export interface Wave {
    samples: Float32Array;
    sampleRate: number;
  }

  export function readWave(path: string): Wave;
}
