// 下载 sherpa-onnx 的 iOS 预编译 xcframework（ASR + VAD 用），放到 ios/App/Frameworks/。
// 这些二进制很大（~179MB），不入库——全新 clone 后跑一次本脚本即可构建 iOS app。
//
// 用法：pnpm --filter @mt/ios fetch:frameworks
//
// 版本必须与 native-plugin/ios/SherpaOnnx.swift + App-Bridging-Header.h 所基于的 tag 一致。
// 升级版本时：改这里的 VERSION，并从同一 tag 重新 vendor 上述两个文件。
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1.13.3'; // onnxruntime 1.26.0
const ASSET = `sherpa-onnx-${VERSION}-ios-no-tts.tar.bz2`; // 不含 TTS，仅 ASR + VAD（更小）
const DOWNLOAD_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${VERSION}/${ASSET}`;

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..'); // apps/ios
const fwDir = path.join(appDir, 'ios', 'App', 'Frameworks');
const sherpa = path.join(fwDir, 'sherpa-onnx.xcframework');
const onnx = path.join(fwDir, 'onnxruntime.xcframework');

if (existsSync(sherpa) && existsSync(onnx)) {
  console.log(`✓ xcframework 已存在（${VERSION}），跳过。删 ${path.relative(process.cwd(), fwDir)} 可强制重下。`);
  process.exit(0);
}

const run = (cmd) => execSync(cmd, { cwd: fwDir, stdio: 'inherit' });
mkdirSync(fwDir, { recursive: true });

console.log(`▶ 下载 sherpa-onnx ${VERSION} iOS xcframework (~39MB)…`);
run(`curl -L --fail -o sherpa-ios.tar.bz2 "${DOWNLOAD_URL}"`);

console.log('▶ 解压并就位…');
run('tar xjf sherpa-ios.tar.bz2');
// 解压目录名形如 build-ios-no-tts/
const extracted = path.join(fwDir, 'build-ios-no-tts');
run(`mv "${extracted}/sherpa-onnx.xcframework" .`);
run(`mv "${extracted}/ios-onnxruntime/1.26.0/onnxruntime.xcframework" .`);
rmSync(extracted, { recursive: true, force: true });
rmSync(path.join(fwDir, 'sherpa-ios.tar.bz2'), { force: true });

console.log(`✓ 完成：${path.relative(process.cwd(), sherpa)} + onnxruntime.xcframework`);
