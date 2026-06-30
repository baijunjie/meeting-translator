// ASR 模型存取（浏览器端）。
//
// 职责：把 @mt/core 的 ASR_MODELS（Silero VAD + SenseVoice tokens/model.int8.onnx，合计 ~230MB）
// 从 HuggingFace / GitHub Release 拉下来，缓存进 Cache Storage（首次下载后离线可复用），
// 并以「已下载字节 / 总字节」的形式回吐聚合进度（透传给 bridge 的 setupProgressCb）。
//
// 为什么用 Cache Storage 而非 IndexedDB：
//  - 单文件 ~228MB，Cache Storage 以 Response（流）为单位存储大二进制最自然、内存占用低；
//  - 与 PWA/Service Worker 的缓存模型一致，可被显式管理（caches.open/match/put/delete）。
//
// 注意：模型文件本身**绝不**进仓库，只在运行时按需下载 + 缓存。WASM 侧（worker）拿到这里
// 解出的 ArrayBuffer 后，再 Module.FS.writeFile 进 MEMFS 给 sherpa 用。

import { ASR_MODEL_FILES, requiredAsrFiles, type AsrModelFile } from '@mt/core';

/** Cache Storage 里存放 ASR 模型的缓存名。 */
const CACHE_NAME = 'mt-asr-models-v1';

// 浏览器跨源：GitHub Releases 不发 CORS 头（且 302 跳 S3），浏览器 fetch 会被拦。
// Silero VAD 很小（~0.6MB），改为随应用同源托管在 public/models/（同源无 CORS、可即时离线）；
// SenseVoice 仍从 HuggingFace 拉（HF 带 Access-Control-Allow-Origin，浏览器可跨源取）。
const SAME_ORIGIN_BUNDLED: Record<string, string> = {
  'silero_vad.onnx': `${import.meta.env.BASE_URL}models/silero_vad.onnx`,
};

/** 解析浏览器实际可 fetch 的地址：同源托管的优先，否则用 @mt/core 的远程 URL。 */
function resolveUrl(file: AsrModelFile): string {
  return SAME_ORIGIN_BUNDLED[file.filename] ?? file.url;
}

/** 聚合下载进度（与 @mt/core SetupProgress 同形）。 */
export interface DownloadProgress {
  /** 已下载字节（已缓存命中的文件按其声明大小计入） */
  loaded: number;
  /** 总字节（各文件 approxBytes 之和，作为分母；不精确但足够做进度条） */
  total: number;
}

/** 某个模型文件在 WASM FS 里应使用的扁平文件名（不带子目录，便于 recognizer 直接引用）。 */
export function fsName(file: AsrModelFile): string {
  return file.filename;
}

/** Cache Storage 里某文件的稳定 key（用文件的相对路径，避免重名冲突）。 */
function cacheKey(file: AsrModelFile): string {
  // 用一个站内绝对路径作 Request key（同源），与真实远程 URL 解耦，便于版本管理。
  const rel = file.dir ? `${file.dir}/${file.filename}` : file.filename;
  return `/__mt_asr__/${rel}`;
}

/** 各文件 approxBytes 之和，作为进度分母。 */
function totalBytes(): number {
  return ASR_MODEL_FILES.reduce((sum, f) => sum + f.approxBytes, 0);
}

/** 检查所有所需模型文件是否都已在 Cache Storage 中（用于 getSetupStatus）。 */
export async function areModelsCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    // requiredAsrFiles() 与 ASR_MODEL_FILES 顺序一致，这里直接按文件检查。
    for (const file of ASR_MODEL_FILES) {
      const hit = await cache.match(cacheKey(file));
      if (!hit) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保所有模型已下载并缓存。已缓存的文件跳过下载（但其大小计入已完成进度）。
 * onProgress 以聚合字节回吐（loaded/total）；total 为各文件 approxBytes 之和。
 *
 * 跨域说明：单线程 WASM 构建不需要 COOP/COEP，因此对 HF/GitHub 的普通 `fetch` 即可，
 * 无需 credentialless 处理，响应也能正常进 Cache Storage。
 */
export async function ensureModelsCached(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (typeof caches === 'undefined') {
    throw new Error('Cache Storage 不可用，无法缓存 ASR 模型');
  }
  const cache = await caches.open(CACHE_NAME);
  const total = totalBytes();
  // 已完成字节按「文件粒度」累计：未开始的文件实时累加其流式进度，
  // 完成/命中的文件按 approxBytes 计入 base。
  let completedBase = 0;

  for (const file of ASR_MODEL_FILES) {
    const key = cacheKey(file);
    const cached = await cache.match(key);
    if (cached) {
      completedBase += file.approxBytes;
      onProgress?.({ loaded: completedBase, total });
      continue;
    }

    const blob = await fetchWithProgress(file, (fileLoaded) => {
      onProgress?.({ loaded: completedBase + fileLoaded, total });
    });

    // 存进 Cache Storage（用同源 key 的 Response）。
    await cache.put(key, new Response(blob));
    completedBase += file.approxBytes;
    onProgress?.({ loaded: completedBase, total });
  }

  onProgress?.({ loaded: total, total });
}

/**
 * 取出已缓存的模型字节（用于写入 WASM FS）。返回 fsName → Uint8Array 映射。
 * 若有文件缺失则抛错（调用方应先 ensureModelsCached）。
 */
export async function readCachedModels(): Promise<Map<string, Uint8Array>> {
  if (typeof caches === 'undefined') {
    throw new Error('Cache Storage 不可用');
  }
  const cache = await caches.open(CACHE_NAME);
  const out = new Map<string, Uint8Array>();
  for (const file of ASR_MODEL_FILES) {
    const hit = await cache.match(cacheKey(file));
    if (!hit) {
      throw new Error(`模型文件缺失（未缓存）: ${file.filename}`);
    }
    const buf = await hit.arrayBuffer();
    out.set(fsName(file), new Uint8Array(buf));
  }
  return out;
}

/** 已缓存文件的相对路径清单（与 @mt/core requiredAsrFiles 对齐，调试用）。 */
export function modelFileList(): string[] {
  return requiredAsrFiles();
}

/**
 * 流式下载单个文件并回吐其已下载字节。
 * 优先用 ReadableStream 读 Content-Length 做精确单文件进度；不可用时回退到一次性 arrayBuffer。
 */
async function fetchWithProgress(
  file: AsrModelFile,
  onFileProgress: (loaded: number) => void,
): Promise<Blob> {
  const res = await fetch(resolveUrl(file), { mode: 'cors', redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`下载失败 ${file.filename}: HTTP ${res.status}`);
  }

  // 无法读 body 流（或无 Content-Length）：退化为整体读取，进度按 approxBytes 兜底。
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onFileProgress(file.approxBytes);
    return new Blob([buf]);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      // 单文件进度用真实已收字节，但封顶到 approxBytes，避免超过分母里该文件的份额。
      onFileProgress(Math.min(received, file.approxBytes));
    }
  }
  return new Blob(chunks as BlobPart[]);
}
