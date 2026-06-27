// 云端翻译实现：调用任意 OpenAI 兼容的 chat completions 端点。
// 注意：启用云翻译意味着会议文本会发往第三方，与“本地不出机器”相悖，应作为可选项。
import type { Translator } from './translator';

const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  en: 'English',
  ko: 'Korean',
  yue: 'Cantonese',
};

export class CloudTranslator implements Translator {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(cfg: CloudTranslationConfig) {
    this.baseURL = cfg.baseURL.replace(/\/+$/, '');
    this.apiKey = cfg.apiKey;
    this.model = cfg.model;
  }

  async init(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('云翻译未配置 API Key，请在设置里填写');
    }
  }

  async translate(text: string, opts: { source?: string; target: string }): Promise<string> {
    if (!text.trim() || opts.source === opts.target) {
      return text;
    }
    await this.init();
    const targetName = LANG_NAMES[opts.target] ?? opts.target;

    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              `You are a professional translator. Translate the user's text into ${targetName}. ` +
              'Output only the translation itself, with no quotes, explanations, or extra text.',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`云翻译请求失败: ${res.status} ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (data.choices?.[0]?.message?.content ?? '').trim();
  }
}
