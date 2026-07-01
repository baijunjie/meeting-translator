// 平台无关的 ASR 模型登记表：每个所需文件的远程 URL、本地文件名、目标子目录
// （相对 models 目录）与近似大小。纯数据/类型，**不含** Node 的 fs/fetch——
// 各端（macOS Electron 主进程、iOS 原生下载器）共用这里的常量，自行实现下载/校验逻辑。
//
// iOS 注意：iOS 的原生模型下载器应消费同一份 @rt/core 登记表（ASR_MODELS /
// requiredAsrFiles），不要再各端硬编码 URL/文件名/目录，避免与 macOS 漂移。
//
// 翻译模型（Xenova/m2m100_418M）的规格见 ./translation/local-spec.ts。

/** SenseVoice 多语种离线识别模型所在的子目录名（相对 models 目录）。 */
export const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';

/** HuggingFace 上 SenseVoice 仓库的 resolve 基址（文件按 `${HF_BASE}/<file>` 取）。 */
export const SENSE_VOICE_HF_BASE = `https://huggingface.co/csukuangfj/${SENSE_VOICE_DIR}/resolve/main`;

/** 单个需下载的 ASR 模型文件的平台无关描述。 */
export interface AsrModelFile {
  /** 远程下载地址（自动跟随 GitHub/HF 重定向）。 */
  url: string;
  /** 落地文件名。 */
  filename: string;
  /**
   * 目标子目录（相对 models 目录）。空串表示直接放在 models 目录下。
   * 拼接本地路径：`<modelsDir>/<dir>/<filename>`（dir 为空时省略中间段）。
   */
  dir: string;
  /** 近似大小（字节），用于进度/预估，非精确值。 */
  approxBytes: number;
}

/**
 * ASR 模型登记表：运行时下载并校验的全部文件。
 * - Silero VAD：GitHub release 直链。
 * - SenseVoice int8：HuggingFace 上的 tokens.txt + model.int8.onnx（int8 量化，~230MB）。
 */
export const ASR_MODELS = {
  sileroVad: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    filename: 'silero_vad.onnx',
    dir: '',
    approxBytes: 2_300_000, // ~2.2MB
  },
  senseVoiceTokens: {
    url: `${SENSE_VOICE_HF_BASE}/tokens.txt`,
    filename: 'tokens.txt',
    dir: SENSE_VOICE_DIR,
    approxBytes: 309_000, // ~0.3MB
  },
  senseVoiceModel: {
    url: `${SENSE_VOICE_HF_BASE}/model.int8.onnx`,
    filename: 'model.int8.onnx',
    dir: SENSE_VOICE_DIR,
    approxBytes: 239_000_000, // ~228MB，占下载量 99%+
  },
} as const satisfies Record<string, AsrModelFile>;

/** 全部 ASR 模型文件，下载顺序：小文件先、大文件最后（带进度）。 */
export const ASR_MODEL_FILES: readonly AsrModelFile[] = [
  ASR_MODELS.sileroVad,
  ASR_MODELS.senseVoiceTokens,
  ASR_MODELS.senseVoiceModel,
];

/**
 * "模型是否齐全" 检查所用的相对路径清单（相对 models 目录，POSIX 分隔符）。
 * 各端据此 `existsSync(join(modelsDir, rel))` 判断。
 */
export function requiredAsrFiles(): string[] {
  return ASR_MODEL_FILES.map((f) => (f.dir ? `${f.dir}/${f.filename}` : f.filename));
}
