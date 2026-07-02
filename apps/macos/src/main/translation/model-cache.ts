// 本地翻译模型缓存的完整性检查（Node fs 侧）。主进程（下载页状态/预热门控）与
// 翻译子进程的 LocalTranslator 共用此判据，避免两处各写一份而漂移。
import fs from 'node:fs';
import path from 'node:path';
import { hasAllWeightFiles, type LocalModelSpec } from '@rt/core';

/**
 * 模型是否已完整缓存于 cacheDir（transformers.js FileCache 布局：<cacheDir>/<modelId>/onnx/）。
 * spec 的全部权重文件都在才算已缓存——缓存按文件粒度写入，只查目录存在会把下载中断的
 * 残缺缓存误判为已就绪。
 */
export function localModelCached(cacheDir: string, spec: LocalModelSpec): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(cacheDir, spec.modelId, 'onnx'));
  } catch {
    return false;
  }
  return hasAllWeightFiles(spec, entries);
}
