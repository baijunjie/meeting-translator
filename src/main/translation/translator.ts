// 翻译能力的抽象层：上层（main/pipeline/渲染）只依赖 Translator 接口，
// 具体用哪个本地模型 / 云 API 由工厂决定，方便以后替换。
import { createLocalTranslator } from './local-translator';
import { CloudTranslator } from './cloud-translator';
import type { CloudTranslationConfig, TranslationEngine } from '../../shared/types';

export interface TranslateProgress {
  /** 如 "initiate" / "download" / "progress" / "done" / "ready" */
  status: string;
  /** 当前文件的百分比（0~100，单文件） */
  progress?: number;
  /** 正在下载的文件名 */
  file?: string;
  /** 当前文件已下载字节 */
  loaded?: number;
  /** 当前文件总字节 */
  total?: number;
}

export interface Translator {
  /** 懒加载模型，首次翻译前调用；重复调用应是幂等的 */
  init(onProgress?: (p: TranslateProgress) => void): Promise<void>;
  /**
   * 把 text 翻成 target 语言。source 缺省时由实现决定如何处理。
   * 语言码用 SenseVoice 风格的短码：zh / en / ja / ko / yue。
   */
  translate(text: string, opts: { source?: string; target: string }): Promise<string>;
}

export interface TranslatorConfig {
  /** 引擎：本地模型（m2m100 / nllb）或云端 */
  backend: TranslationEngine;
  /** [本地] 模型缓存目录（首次下载后离线复用） */
  cacheDir?: string;
  /** [cloud] OpenAI 兼容端点配置 */
  cloud?: CloudTranslationConfig;
}

export function createTranslator(cfg: TranslatorConfig): Translator {
  if (cfg.backend === 'cloud') {
    if (!cfg.cloud) {
      throw new Error('云翻译缺少配置');
    }
    return new CloudTranslator(cfg.cloud);
  }
  if (!cfg.cacheDir) {
    throw new Error('本地翻译缺少 cacheDir');
  }
  return createLocalTranslator(cfg.backend, cfg.cacheDir);
}
