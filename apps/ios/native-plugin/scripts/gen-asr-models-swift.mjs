// 从 @mt/core 的共享 ASR 模型登记表生成 Swift 常量文件 AsrModels.swift。
//
// 目的：iOS 原生下载器 / 路径解析必须消费与 macOS 同一份登记表
// （packages/core/src/models.ts 的 ASR_MODELS / requiredAsrFiles），不在 Swift 里
// 各自硬编码 URL/文件名/目录，避免与 macOS 漂移。Swift 运行时无法 import TS 模块，
// 因此用本脚本把登记表编译期“拍平”成一个生成的 Swift 文件并提交进仓库。
//
// 用法：
//   pnpm --filter @mt/ios gen:models          # 写出 AsrModels.swift
//   pnpm --filter @mt/ios gen:models --check   # 只校验已提交的生成物是否最新（CI 用）
//
// @mt/core 以源码 TS 形式发布（main: src/index.ts，靠 bundler 消费），普通 Node ESM
// 无法直接 import。models.ts 是“纯数据 + 类型”、不 import 任何运行时模块，故这里只用
// esbuild 把这一个文件转成 JS 后动态 import，绕开 @mt/core 整个 barrel 的解析。
//
// 注意：生成的 AsrModels.swift 是“生成物”，请勿手改——改 packages/core/src/models.ts 后重跑本脚本。

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { transform } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const modelsTs = path.join(repoRoot, 'packages', 'core', 'src', 'models.ts');
const outPath = path.join(here, '..', 'ios', 'AsrModels.swift');

const tsSource = fs.readFileSync(modelsTs, 'utf8');
const { code: jsSource } = await transform(tsSource, {
  loader: 'ts',
  format: 'esm',
  target: 'esnext',
});
// 以 data: URL 动态 import，拿到登记表常量（models.ts 不依赖其他模块，安全）。
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(jsSource).toString('base64');
const { ASR_MODEL_FILES, requiredAsrFiles, SENSE_VOICE_DIR } = await import(dataUrl);

const swiftString = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const fileEntries = ASR_MODEL_FILES.map(
  (f) =>
    `    AsrModelFile(url: ${swiftString(f.url)}, ` +
    `filename: ${swiftString(f.filename)}, ` +
    `dir: ${swiftString(f.dir)}, ` +
    `approxBytes: ${f.approxBytes}),`,
).join('\n');

const requiredEntries = requiredAsrFiles()
  .map((rel) => `    ${swiftString(rel)},`)
  .join('\n');

const out = `// AsrModels.swift — GENERATED, do not edit by hand.
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
  static let senseVoiceDir = ${swiftString(SENSE_VOICE_DIR)}

  /// 全部需下载的 ASR 模型文件，顺序：小文件先、大文件最后（带进度）。
  static let files: [AsrModelFile] = [
${fileEntries}
  ]

  /// “模型是否齐全”检查所用的相对路径清单（相对 models 根目录，POSIX 分隔符）。
  static let requiredRelativePaths: [String] = [
${requiredEntries}
  ]
}
`;

if (process.argv.includes('--check')) {
  // CI 模式：不写盘，只校验已提交的生成物是否与当前登记表一致。
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (current !== out) {
    console.error(
      `[gen:models] ${path.relative(repoRoot, outPath)} 已过期，请运行 ` +
        '`pnpm --filter @mt/ios gen:models` 并提交。',
    );
    process.exit(1);
  }
  console.log('[gen:models] up to date');
} else {
  fs.writeFileSync(outPath, out, 'utf8');
  console.log(`[gen:models] wrote ${path.relative(repoRoot, outPath)}`);
}
