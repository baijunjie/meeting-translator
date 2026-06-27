// MVP 本地翻译实现：Meta M2M100-418M（MIT 许可），多语言多向互译，
// 经 Transformers.js 在 onnxruntime-node 上跑，纯本地推理。
import { pipeline, env } from '@huggingface/transformers';
import type { Translator, TranslatorConfig, TranslateProgress } from './translator';

const DEFAULT_MODEL = 'Xenova/m2m100_418M';

// SenseVoice 的语言短码 -> M2M100 语言码。M2M100 没有粤语，回退到中文。
const LANG_MAP: Record<string, string> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  yue: 'zh',
};

function toM2M100(lang: string | undefined, fallback: string): string {
  if (!lang) return fallback;
  return LANG_MAP[lang] ?? fallback;
}

// pipeline() 返回的可调用对象：输入文本 + 源/目标语言，输出 [{ translation_text }]
type TranslationFn = (
  text: string,
  opts: { src_lang: string; tgt_lang: string }
) => Promise<Array<{ translation_text: string }>>;

export class M2M100Translator implements Translator {
  private readonly modelId: string;
  private translate$: TranslationFn | null = null;
  private loading: Promise<void> | null = null;

  constructor(cfg: TranslatorConfig) {
    if (!cfg.cacheDir) {
      throw new Error('本地翻译缺少 cacheDir');
    }
    this.modelId = cfg.modelId ?? DEFAULT_MODEL;
    // 模型缓存到本地目录，首次联网下载后即可离线运行
    env.cacheDir = cfg.cacheDir;
    env.allowRemoteModels = true;
  }

  init(onProgress?: (p: TranslateProgress) => void): Promise<void> {
    if (this.translate$) return Promise.resolve();
    // 并发首句不要重复加载
    if (!this.loading) {
      this.loading = pipeline('translation', this.modelId, {
        dtype: 'q8',
        progress_callback: onProgress,
      }).then((fn) => {
        this.translate$ = fn as unknown as TranslationFn;
      });
    }
    return this.loading;
  }

  async translate(text: string, opts: { source?: string; target: string }): Promise<string> {
    const src = toM2M100(opts.source, 'en');
    const tgt = toM2M100(opts.target, 'en');
    if (!text.trim() || src === tgt) {
      return text; // 同语言无需翻译
    }
    await this.init();
    if (!this.translate$) {
      throw new Error('翻译模型未就绪');
    }
    const out = await this.translate$(text, { src_lang: src, tgt_lang: tgt });
    return out[0]?.translation_text ?? '';
  }
}
