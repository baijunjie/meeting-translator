// 定稿段翻译的平台无关编排：三端（macOS 主进程 / Web / iOS 桥接）共用同一套
// 「要不要翻 → pending → 引擎调用 → 字形归一化 → 回填/错误」流程，只把引擎调用
// 本身（本地模型 / 云端 / 原生框架，各端传输方式不同）留给调用方注入。
//
// 状态事件（emitStatus）只反映引擎可用性：单次翻译进行中由 per-line 的 pending
// 表达，这里不发 loading/ready；仅失败时发 error（UI 据此提示并结束所有等待动画）。
import { planTranslation, type LocalModelSpec } from './local-spec';
import type { TranslationPayload, TranslationStatusPayload } from '../types';

/** 注入给平台引擎的一次翻译请求。 */
export interface SegmentTranslateRequest {
  /** 行 id，译文异步回填对应 */
  id: number;
  /** 源文本（定稿段原文） */
  text: string;
  /** ASR 源语言短码（zh/en/ja/ko/yue） */
  source: string;
  /** 目标母语 app 语言键（zh/zh-Hant/ja/en/ko）：能感知字形的引擎（本地模型映射 / 云端提示词）用它 */
  targetLang: string;
  /** 目标的模型短码（M2M100: zh/en/…）：只认短码的引擎（如 iOS 原生框架）用它 */
  targetCode: string;
}

export interface TranslateFinalizedSegmentOptions {
  spec: LocalModelSpec;
  segment: { id: number; text: string; lang: string };
  /** 翻译是否开启（关闭时不发任何事件） */
  enabled: boolean;
  /** 母语 app 语言键（翻译目标恒为母语） */
  nativeLang: string;
  /** 平台引擎调用：把 text 翻成目标语言，失败抛错 */
  translate: (req: SegmentTranslateRequest) => Promise<string>;
  /** 译文事件（pending / 最终结果），三端分别接 IPC / 回调 */
  emitTranslation: (p: TranslationPayload) => void;
  /** 引擎状态事件（此处仅在失败时发 error） */
  emitStatus: (s: TranslationStatusPayload) => void;
}

/**
 * 对一条定稿段执行「翻成母语」的完整编排（fire-and-forget，失败不影响转写）：
 * - `skip`：不发任何事件（不显示译文、不触发等待动画）。
 * - `script`：仅简繁字形不同，直接产出转换后的原文，不经引擎。
 * - `translate`：先发 pending（UI 显示等待动画），引擎产出后套 plan.toScript 做母语
 *   字形归一化（幂等，引擎已自行处理也不受影响）再回填；失败发 error 状态并以空串
 *   结束该行等待动画。
 */
export async function translateFinalizedSegment(
  opts: TranslateFinalizedSegmentOptions,
): Promise<void> {
  const { segment } = opts;
  if (!opts.enabled) return;

  const plan = planTranslation(opts.spec, segment.lang, opts.nativeLang, segment.text);
  if (plan.kind === 'skip') return;
  if (plan.kind === 'script') {
    opts.emitTranslation({ id: segment.id, text: plan.text });
    return;
  }

  opts.emitTranslation({ id: segment.id, text: '', pending: true });
  try {
    const text = await opts.translate({
      id: segment.id,
      text: segment.text,
      source: segment.lang,
      targetLang: plan.targetLang,
      targetCode: plan.targetCode,
    });
    opts.emitTranslation({ id: segment.id, text: plan.toScript ? plan.toScript(text) : text });
  } catch (e) {
    opts.emitStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    opts.emitTranslation({ id: segment.id, text: '' }); // 结束该行等待动画
  }
}
