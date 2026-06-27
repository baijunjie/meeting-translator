// 运行时下载 ASR 模型（方案 B：不打包，首次启动联网下载）。
// 只下 int8 量化版所需的文件（~230MB），避免 GitHub 发布的 tar 包还含 894MB 全精度模型。
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { SetupProgress } from '../shared/types';

const SILERO_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';
const SENSE_VOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17';
const HF_BASE = `https://huggingface.co/csukuangfj/${SENSE_VOICE_DIR}/resolve/main`;

/** ASR 模型是否齐全（与 pipeline.ts 的 assertModelsExist 清单一致） */
export function asrModelsReady(modelsDir: string): boolean {
  const required = [
    'silero_vad.onnx',
    path.join(SENSE_VOICE_DIR, 'model.int8.onnx'),
    path.join(SENSE_VOICE_DIR, 'tokens.txt'),
  ];
  return required.every((f) => fs.existsSync(path.join(modelsDir, f)));
}

async function downloadFile(
  url: string,
  dest: string,
  onBytes?: (loaded: number, total: number) => void
): Promise<void> {
  const res = await fetch(url); // 自动跟随 HF/GitHub 的重定向
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 ${res.status}: ${url}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  let loaded = 0;
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  if (onBytes) {
    body.on('data', (chunk: Buffer) => {
      loaded += chunk.length;
      onBytes(loaded, total);
    });
  }
  await streamPipeline(body, fs.createWriteStream(dest));
}

/**
 * 下载并安装 ASR 模型（Silero VAD + SenseVoice int8，总计 ~230MB）。
 * 进度以 model.int8.onnx 为主（~228MB，占比 99%+）。
 */
export async function downloadAsrModels(
  modelsDir: string,
  onProgress: (p: SetupProgress) => void
): Promise<void> {
  const svDir = path.join(modelsDir, SENSE_VOICE_DIR);
  fs.mkdirSync(svDir, { recursive: true });

  // 小文件先下（瞬间完成）
  await downloadFile(SILERO_URL, path.join(modelsDir, 'silero_vad.onnx'));
  await downloadFile(`${HF_BASE}/tokens.txt`, path.join(svDir, 'tokens.txt'));

  // 大文件带进度
  await downloadFile(`${HF_BASE}/model.int8.onnx`, path.join(svDir, 'model.int8.onnx'), (loaded, total) => {
    onProgress({ loaded, total });
  });

  if (!asrModelsReady(modelsDir)) {
    throw new Error('ASR 模型安装后校验失败');
  }
}
