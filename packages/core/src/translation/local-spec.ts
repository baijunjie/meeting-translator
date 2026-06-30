// 本地翻译模型的平台无关数据：模型规格（LocalModelSpec）、M2M100 规格与语言码映射，
// 以及简繁脚本归一化（normalizeZh，基于 chinese-conv）。
// 具体跑模型的 LocalTranslator 实现（依赖 onnxruntime-node）留在各端。
import { sify, tify } from 'chinese-conv';
import type { LocalEngine } from '../types';

/** 简繁脚本归一化：把中文文本转成简体或繁體。 */
export function normalizeZh(text: string, script: 'simplified' | 'traditional'): string {
  return script === 'traditional' ? tify(text) : sify(text);
}

/** 某个 app 语言在该模型下如何处理：用哪个模型语言码 + 目标产出的脚本后处理 */
export interface LangEntry {
  /** 模型自己的语言码（M2M100: zh/en…；NLLB: zho_Hans/eng_Latn…） */
  code: string;
  /**
   * 作为目标语言时对译文的后处理。仅当模型本身不区分该脚本时才需要：
   * 例如 M2M100 只有一个 'zh'，繁體目标靠脚本转换回退；NLLB 原生区分则无需。
   */
  toScript?: (text: string) => string;
}

export interface LocalModelSpec {
  id: LocalEngine;
  /** HuggingFace 仓库标识（首次联网下载后离线复用） */
  modelId: string;
  /** 量化档位 */
  dtype: 'q8';
  /** app 语言（含 ASR 源码 yue）→ 处理方式；未列出的语言回退到 fallbackLang */
  langs: Record<string, LangEntry>;
  /** 未知语言的回退（通常英语） */
  fallbackLang: string;
}

// M2M100-418M（MIT，轻量）。不区分简/繁：繁體目标翻成中文后用脚本转换。
export const M2M100_SPEC: LocalModelSpec = {
  id: 'm2m100',
  modelId: 'Xenova/m2m100_418M',
  dtype: 'q8',
  fallbackLang: 'en',
  langs: {
    zh: { code: 'zh', toScript: (t) => normalizeZh(t, 'simplified') },
    'zh-Hant': { code: 'zh', toScript: (t) => normalizeZh(t, 'traditional') },
    en: { code: 'en' },
    ja: { code: 'ja' },
    ko: { code: 'ko' },
    yue: { code: 'zh' },
  },
};
