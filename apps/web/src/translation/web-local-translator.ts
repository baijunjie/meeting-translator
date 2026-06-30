// 浏览器端本地翻译：把 Transformers.js M2M100 的推理放到 Web Worker（见 ./translate-worker），
// 主线程不被模型推理阻塞。本类是瘦代理：做语言码映射 + 同语言短路 + 繁體 toScript 后处理（都很轻），
// 实际推理通过消息发给 worker、按 id 对应结果。模型差异收敛在 @mt/core 的 M2M100_SPEC。
//
// 对外 API（translate）与之前一致，故 bridge 无需改动。
import { M2M100_SPEC, type LocalModelSpec } from '@mt/core';
import type { ToTranslateWorker, FromTranslateWorker } from './translate-worker-protocol';

/** Transformers.js progress_callback 回吐的进度对象（结构稳定字段）。 */
export interface ModelProgress {
  status: string;
  file?: string;
  progress?: number; // 0~100（单文件）
  loaded?: number;
  total?: number;
}

export class WebLocalTranslator {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private progressCb: ((p: ModelProgress) => void) | null = null;

  constructor(private readonly spec: LocalModelSpec = M2M100_SPEC) {}

  /** 取某 app 语言在本模型下的处理项，未知语言回退。 */
  private entry(lang?: string): LocalModelSpec['langs'][string] {
    return this.spec.langs[lang ?? ''] ?? this.spec.langs[this.spec.fallbackLang];
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./translate-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<FromTranslateWorker>) => {
      const m = ev.data;
      switch (m.type) {
        case 'progress':
          this.progressCb?.(m.progress as ModelProgress);
          break;
        case 'result': {
          const p = this.pending.get(m.id);
          if (p) {
            this.pending.delete(m.id);
            p.resolve(m.text);
          }
          break;
        }
        case 'error': {
          const p = this.pending.get(m.id);
          if (p) {
            this.pending.delete(m.id);
            p.reject(new Error(m.error));
          }
          break;
        }
        // 'ready' 暂不需要：translate 由 worker 内部懒加载，首条会等模型就绪。
      }
    };
    this.worker = w;
    return w;
  }

  /**
   * 把 text 翻成 target（短码 zh/en/ja/ko/yue），经 M2M100 语言码映射。
   * 目标若需脚本后处理（M2M100 只有一个 'zh'，繁體靠脚本转换）则套 toScript。
   * onProgress 透传 worker 的模型下载进度（首次会下载 ~400MB）。
   */
  async translate(
    text: string,
    opts: { source?: string; target: string },
    onProgress?: (p: ModelProgress) => void
  ): Promise<string> {
    if (!text.trim()) return text;
    const src = this.entry(opts.source);
    const tgt = this.entry(opts.target);

    // 模型层面同语言：无需经模型，仅按需做脚本归一化（不动 worker）。
    if (src.code === tgt.code) {
      return tgt.toScript ? tgt.toScript(text) : text;
    }

    this.progressCb = onProgress ?? null;
    const w = this.ensureWorker();
    const id = this.nextId++;
    const result = await new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({
        type: 'translate',
        id,
        text,
        srcLang: src.code,
        tgtLang: tgt.code,
        modelId: this.spec.modelId,
        dtype: this.spec.dtype,
      } satisfies ToTranslateWorker);
    });
    return tgt.toScript ? tgt.toScript(result) : result;
  }
}
