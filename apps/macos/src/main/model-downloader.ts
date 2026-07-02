// 运行时下载 ASR 模型（方案 B：不打包，首次启动联网下载）。
// 只下 int8 量化版所需的文件（~230MB），避免 GitHub 发布的 tar 包还含 894MB 全精度模型。
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { ASR_MODELS, requiredAsrFiles } from '@rt/core';
import type { SetupProgress } from '../shared/types';

/** ASR 模型是否齐全（清单来自 @rt/core 的共享登记表） */
export function asrModelsReady(modelsDir: string): boolean {
  return requiredAsrFiles().every((f) => fs.existsSync(path.join(modelsDir, f)));
}

// 无进展看门狗超时：连续这么久没收到任何新字节即判定连接停滞并中止本次下载。
// 「无进展超时」而非「总时长超时」——大文件慢速下载合法，只在字节流真正停滞时触发。
const STALL_TIMEOUT_MS = 30_000;

async function downloadFile(
  url: string,
  dest: string,
  onBytes?: (loaded: number, total: number) => void
): Promise<void> {
  // 无进展看门狗：字节流停滞（TCP 静默断开、无 RST）时主动 abort，避免永久挂起。
  const controller = new AbortController();
  let stalled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const armWatchdog = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, STALL_TIMEOUT_MS);
  };

  armWatchdog(); // 连接/响应头阶段也受同一 signal 约束
  try {
    const res = await fetch(url, { signal: controller.signal }); // 自动跟随 HF/GitHub 的重定向
    if (!res.ok || !res.body) {
      throw new Error(`下载失败 ${res.status}: ${url}`);
    }
    const total = Number(res.headers.get('content-length')) || 0;
    let loaded = 0;
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on('data', (chunk: Buffer) => {
      loaded += chunk.length;
      armWatchdog(); // 收到新字节即重置无进展计时
      onBytes?.(loaded, total);
    });
    // 先写 .part 临时文件，校验完整后原子 rename 到最终路径：中断/失败不会在最终路径
    // 留下半截文件（模型就绪检查按最终路径的存在性判断，半截文件会被误判为就绪）。
    const part = `${dest}.part`;
    armWatchdog(); // 连接完成，为首字节到达重置一次计时
    try {
      await streamPipeline(body, fs.createWriteStream(part));
      // 只把「少收」判为不完整：CDN 对文本文件可能压缩传输（content-length 为压缩后大小，
      // fetch 自动解压导致实收字节更多）；截断的压缩流会在解压时直接报错，由上面的管道兜底。
      if (total > 0 && loaded < total) {
        throw new Error(`下载不完整 (${loaded}/${total} 字节): ${url}`);
      }
      fs.renameSync(part, dest);
    } catch (err) {
      fs.rmSync(part, { force: true });
      throw err;
    }
  } catch (err) {
    // 看门狗触发的 abort 转成明确的中文停滞错误，交给上层失败→重试 UI 接管。
    if (stalled) throw new Error('下载停滞，请检查网络后重试');
    throw err;
  } finally {
    if (watchdog !== undefined) clearTimeout(watchdog);
  }
}

/**
 * 下载并安装 ASR 模型（Silero VAD + SenseVoice int8，总计 ~230MB）。
 * 进度以 model.int8.onnx 为主（~228MB，占比 99%+）。
 */
export async function downloadAsrModels(
  modelsDir: string,
  onProgress: (p: SetupProgress) => void
): Promise<void> {
  const { sileroVad, senseVoiceTokens, senseVoiceModel } = ASR_MODELS;
  const localPath = (f: { dir: string; filename: string }) =>
    path.join(modelsDir, f.dir, f.filename);

  fs.mkdirSync(path.join(modelsDir, senseVoiceModel.dir), { recursive: true });

  // 小文件先下（瞬间完成）
  await downloadFile(sileroVad.url, localPath(sileroVad));
  await downloadFile(senseVoiceTokens.url, localPath(senseVoiceTokens));

  // 大文件带进度
  await downloadFile(senseVoiceModel.url, localPath(senseVoiceModel), (loaded, total) => {
    onProgress({ loaded, total });
  });

  if (!asrModelsReady(modelsDir)) {
    throw new Error('ASR 模型安装后校验失败');
  }
}
