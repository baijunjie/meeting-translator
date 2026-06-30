// AsrModels.swift — GENERATED, do not edit by hand.
//
// 由 apps/ios/native-plugin/scripts/gen-asr-models-swift.mjs 从 @mt/core 的共享
// ASR 模型登记表（packages/core/src/models.ts）生成。登记表变更后请重跑：
//   pnpm --filter @mt/ios gen:models
//
// 与 macOS 端 (apps/macos/src/main/model-downloader.ts) 消费同一份登记表，保证
// URL/文件名/目录/校验清单不漂移。

import Foundation

/// 单个需下载的 ASR 模型文件（对应 @mt/core 的 AsrModelFile）。
struct AsrModelFile {
  /// 远程下载地址（URLSession 会自动跟随 GitHub/HF 重定向）。
  let url: String
  /// 落地文件名。
  let filename: String
  /// 目标子目录（相对 models 根目录）。空串表示直接放在 models 根目录下。
  let dir: String
  /// 近似大小（字节），用于下载进度估算，非精确值。
  let approxBytes: Int
}

enum AsrModels {
  /// SenseVoice 多语种离线识别模型所在的子目录名（相对 models 根目录）。
  static let senseVoiceDir = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"

  /// 全部需下载的 ASR 模型文件，顺序：小文件先、大文件最后（带进度）。
  static let files: [AsrModelFile] = [
    AsrModelFile(url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx", filename: "silero_vad.onnx", dir: "", approxBytes: 2300000),
    AsrModelFile(url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt", filename: "tokens.txt", dir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", approxBytes: 309000),
    AsrModelFile(url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx", filename: "model.int8.onnx", dir: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", approxBytes: 239000000),
  ]

  /// “模型是否齐全”检查所用的相对路径清单（相对 models 根目录，POSIX 分隔符）。
  static let requiredRelativePaths: [String] = [
    "silero_vad.onnx",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tokens.txt",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.int8.onnx",
  ]
}
