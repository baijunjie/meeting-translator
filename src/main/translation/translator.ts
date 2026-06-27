// 翻译能力的抽象层：上层（main/pipeline/渲染）只依赖 Translator 接口，
// 具体用哪个本地模型 / 云 API 由工厂决定，方便以后替换。
import { M2M100Translator } from './m2m100-translator';
import { CloudTranslator } from './cloud-translator';
import type { CloudTranslationConfig } from '../../shared/types';

export interface TranslateProgress {
  /** 如 "downloading" / "loading" / "ready" */
  status: string;
  /** 0~1，下载进度（若有） */
  progress?: number;
  file?: string;
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
  /** 'm2m100' = 本地模型；'cloud' = OpenAI 兼容云端。以后可再扩展 'llm' 等 */
  backend: 'm2m100' | 'cloud';
  /** [m2m100] 模型标识，换模型只改这里。缺省见各实现 */
  modelId?: string;
  /** [m2m100] 模型缓存目录（首次下载后离线复用） */
  cacheDir?: string;
  /** [cloud] OpenAI 兼容端点配置 */
  cloud?: CloudTranslationConfig;
}

export function createTranslator(cfg: TranslatorConfig): Translator {
  switch (cfg.backend) {
    case 'm2m100':
      return new M2M100Translator(cfg);
    case 'cloud':
      if (!cfg.cloud) {
        throw new Error('云翻译缺少配置');
      }
      return new CloudTranslator(cfg.cloud);
    default:
      throw new Error(`未知的翻译后端: ${cfg.backend}`);
  }
}
