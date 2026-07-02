// 翻译模型下载进度的平台无关聚合：Transformers.js 的 progress_callback 按「单个文件」
// 回吐百分比，且多个文件并行下载——直接透传会让单一进度条在文件间来回跳。
// 这里把逐文件事件聚合成「总进度（按字节）+ 各文件独立进度」，macOS 子进程与 Web 桥接共用。
import type { TranslateProgress } from './translator';
import type { TranslationFileProgress } from '../types';

export interface AggregatedTranslateProgress {
  /**
   * 0~1 总进度：全部已知文件的 loaded 之和 / total 之和。文件在首个带字节的事件到达时
   * 才进入分母，故下载最初几秒新文件陆续注册时总进度可能回落，此后随字节单调推进。
   */
  progress: number;
  /** 各文件独立进度，按发现顺序排列 */
  files: TranslationFileProgress[];
}

/**
 * 创建一次模型加载的进度聚合器。把每个 TranslateProgress 事件喂给返回的函数：
 * - `progress` 事件（带 file/loaded/total）更新对应文件的字节数；
 * - `done` 事件把对应文件封顶为完成（此类事件常不带字节数）；
 * - 其余事件（initiate/download/ready 等无字节信息）不改变状态。
 * 状态有变化时返回聚合结果，否则返回 null（调用方可据此决定是否上报）。
 * 每次模型加载新建一个聚合器，不跨加载复用。
 */
export function createTranslateProgressAggregator(): (
  p: TranslateProgress,
) => AggregatedTranslateProgress | null {
  const files = new Map<string, { loaded: number; total: number }>();

  const snapshot = (): AggregatedTranslateProgress => {
    let loaded = 0;
    let total = 0;
    const list: TranslationFileProgress[] = [];
    for (const [file, f] of files) {
      loaded += f.loaded;
      total += f.total;
      list.push({ file, loaded: f.loaded, total: f.total, progress: f.total > 0 ? f.loaded / f.total : 0 });
    }
    return { progress: total > 0 ? loaded / total : 0, files: list };
  };

  return (p: TranslateProgress): AggregatedTranslateProgress | null => {
    if (!p.file) return null;
    if (p.status === 'progress' && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
      files.set(p.file, { loaded: Math.min(p.loaded, p.total), total: p.total });
      return snapshot();
    }
    if (p.status === 'done') {
      const known = files.get(p.file);
      // done 事件通常不带字节数：已知文件封顶为完成；从未报过字节的（缓存命中的小文件）忽略，
      // 避免以 0 字节挤进列表干扰聚合。
      if (known) {
        files.set(p.file, { loaded: known.total, total: known.total });
        return snapshot();
      }
    }
    return null;
  };
}
