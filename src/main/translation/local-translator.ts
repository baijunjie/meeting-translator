// 本地翻译通用实现：Transformers.js 跑 seq2seq 翻译模型（onnxruntime-node，纯本地）。
// 模型的差异全部收敛到「LocalModelSpec」这份数据里——新增本地模型只需加一份 spec，
// 翻译流程（懒加载 / 缓存判定 / 语言码映射 / 简繁脚本回退）完全通用，做到优雅插拔。
import fs from 'node:fs';
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';
import { sify, tify } from 'chinese-conv';
import type { Translator, TranslateProgress } from './translator';
import type { LocalEngine } from '../../shared/types';

/** 某个 app 语言在该模型下如何处理：用哪个模型语言码 + 目标产出的脚本后处理 */
interface LangEntry {
  /** 模型自己的语言码（M2M100: zh/en…；NLLB: zho_Hans/eng_Latn…） */
  code: string;
  /**
   * 作为目标语言时对译文的后处理。仅当模型本身不区分该脚本时才需要：
   * 例如 M2M100 只有一个 'zh'，繁體目标靠 tify 转换回退；NLLB 原生区分则无需。
   */
  toScript?: (text: string) => string;
}

export interface LocalModelSpec {
  id: LocalEngine;
  /** HuggingFace 仓库标识（首次联网下载后离线复用） */
  modelId: string;
  /** 量化档位 */
  dtype: 'q8' | 'q4';
  /** app 语言（含 ASR 源码 yue）→ 处理方式；未列出的语言回退到 fallbackLang */
  langs: Record<string, LangEntry>;
  /** 未知语言的回退（通常英语） */
  fallbackLang: string;
}

// M2M100-418M（MIT，轻量）。不区分简/繁：繁體目标翻成中文后用 tify 转换。
export const M2M100_SPEC: LocalModelSpec = {
  id: 'm2m100',
  modelId: 'Xenova/m2m100_418M',
  dtype: 'q8',
  fallbackLang: 'en',
  langs: {
    zh: { code: 'zh', toScript: sify },
    'zh-Hant': { code: 'zh', toScript: tify },
    en: { code: 'en' },
    ja: { code: 'ja' },
    ko: { code: 'ko' },
    yue: { code: 'zh' },
  },
};

// NLLB-200-distilled-600M（CC-BY-NC，较大）。原生区分简/繁，且支持粤语，无需脚本转换。
// 用 q4(4-bit MatMulNBits) 而非 q8：q8 会把 25.6 万词表权重反量化成 ~1GB 的 fp32 单块，
// 在 Electron 进程里会被分配器直接 abort；q4 在 kernel 内分块解量化，不产生巨块分配。
export const NLLB_SPEC: LocalModelSpec = {
  id: 'nllb',
  modelId: 'Xenova/nllb-200-distilled-600M',
  dtype: 'q4',
  fallbackLang: 'en',
  langs: {
    zh: { code: 'zho_Hans' },
    'zh-Hant': { code: 'zho_Hant' },
    en: { code: 'eng_Latn' },
    ja: { code: 'jpn_Jpan' },
    ko: { code: 'kor_Hang' },
    yue: { code: 'yue_Hant' },
  },
};

const SPECS: Record<LocalEngine, LocalModelSpec> = {
  m2m100: M2M100_SPEC,
  nllb: NLLB_SPEC,
};

// pipeline() 返回的可调用对象：输入文本 + 源/目标语言码，输出 [{ translation_text }]
type TranslationFn = (
  text: string,
  opts: {
    src_lang: string;
    tgt_lang: string;
    no_repeat_ngram_size?: number;
    repetition_penalty?: number;
    max_new_tokens?: number;
  }
) => Promise<Array<{ translation_text: string }>>;

class LocalTranslator implements Translator {
  private translate$: TranslationFn | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly spec: LocalModelSpec,
    private readonly cacheDir: string
  ) {
    env.cacheDir = cacheDir;
    env.allowRemoteModels = true;
  }

  /** 取某 app 语言在本模型下的处理项，未知语言回退 */
  private entry(lang?: string): LangEntry {
    return this.spec.langs[lang ?? ''] ?? this.spec.langs[this.spec.fallbackLang];
  }

  /** 模型文件是否已在本地缓存（已下载过） */
  private isCached(): boolean {
    return fs.existsSync(path.join(this.cacheDir, this.spec.modelId, 'onnx'));
  }

  init(onProgress?: (p: TranslateProgress) => void): Promise<void> {
    if (this.translate$) return Promise.resolve();
    if (!this.loading) {
      // 已缓存：只是把模型从磁盘载入内存，不报字节进度（避免每次启动都显示像下载的 %）。
      // 未缓存：首次联网下载，报进度。
      const reportProgress = this.isCached() ? undefined : onProgress;
      this.loading = pipeline('translation', this.spec.modelId, {
        dtype: this.spec.dtype,
        progress_callback: reportProgress,
      }).then((fn) => {
        this.translate$ = fn as unknown as TranslationFn;
      });
    }
    return this.loading;
  }

  async translate(text: string, opts: { source?: string; target: string }): Promise<string> {
    if (!text.trim()) return text;
    const src = this.entry(opts.source);
    const tgt = this.entry(opts.target);

    // 模型层面同语言：无需经模型；但若目标需脚本后处理（如 M2M100 简体语音→繁體目标）仍要转换
    if (src.code === tgt.code) {
      return tgt.toScript ? tgt.toScript(text) : text;
    }

    await this.init();
    if (!this.translate$) {
      throw new Error('翻译模型未就绪');
    }
    const out = await this.translate$(text, {
      src_lang: src.code,
      tgt_lang: tgt.code,
      // 杂乱的 ASR 文本容易让模型陷入复读，加重复惩罚 + 禁止重复 3-gram + 长度上限兜底
      no_repeat_ngram_size: 3,
      repetition_penalty: 1.3,
      max_new_tokens: 256,
    });
    const result = out[0]?.translation_text ?? '';
    return tgt.toScript ? tgt.toScript(result) : result;
  }
}

/** 按引擎 id 创建本地翻译器 */
export function createLocalTranslator(engine: LocalEngine, cacheDir: string): Translator {
  return new LocalTranslator(SPECS[engine], cacheDir);
}
