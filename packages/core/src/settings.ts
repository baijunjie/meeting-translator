// 应用设置的纯逻辑：默认值生成、字段补齐与旧版本兼容、语言码校验。
// 不依赖任何平台 API——系统语言由调用方传入，持久化（fs 等）留在各端实现。
import type { AppSettings, UiLang } from './types';

export const UI_LANGS: UiLang[] = ['zh', 'zh-Hant', 'ja', 'en', 'ko'];

/**
 * 按系统语言猜母语，落到支持的语言之一，否则英语。
 * @param systemLangs 系统偏好语言列表（由各端提供，如 Electron 的 app.getPreferredSystemLanguages()）
 */
function defaultNativeLang(systemLangs: string[]): UiLang {
  const candidates = systemLangs.map((l) => (l || '').toLowerCase());
  for (const c of candidates) {
    if (c.startsWith('zh')) {
      // 繁体地区/脚本（台/港/澳、Hant）→ 繁體；其余中文 → 简体
      return /hant|tw|hk|mo/.test(c) ? 'zh-Hant' : 'zh';
    }
    const hit = (['ja', 'en', 'ko'] as UiLang[]).find((l) => c.startsWith(l));
    if (hit) return hit;
  }
  return 'en';
}

/** 生成默认设置；母语按传入的系统语言推断 */
export function makeDefaults(systemLangs: string[]): AppSettings {
  return {
    onboarded: false,
    nativeLang: defaultNativeLang(systemLangs),
    fontSize: 'medium',
    theme: 'system',
    translation: {
      enabled: false,
      engine: 'm2m100',
      // 云端三项默认留空：主页设置里由预设选择或手动输入填入（占位符仅作示例提示）
      cloud: {
        baseURL: '',
        apiKey: '',
        model: '',
      },
    },
  };
}

export function asUiLang(v: unknown): UiLang | null {
  return typeof v === 'string' && (UI_LANGS as string[]).includes(v) ? (v as UiLang) : null;
}

/**
 * 补齐缺省字段，并兼容旧版本（translation.targetLang）的 JSON。
 * @param raw 反序列化得到的原始对象
 * @param defaults 由调用方按系统语言生成的默认值
 */
export function withDefaults(raw: unknown, defaults: AppSettings): AppSettings {
  const d = defaults;
  const s = (raw ?? {}) as Record<string, unknown>;
  const t = (s.translation ?? {}) as Record<string, unknown>;
  const cloud = (t.cloud ?? {}) as Record<string, unknown>;

  // 旧字段迁移：targetLang 既当母语初值、也决定是否开启翻译
  const legacyTarget = asUiLang(t.targetLang);
  const enabled =
    typeof t.enabled === 'boolean'
      ? t.enabled
      : typeof t.targetLang === 'string'
        ? t.targetLang !== 'off'
        : d.translation.enabled;

  return {
    onboarded: typeof s.onboarded === 'boolean' ? s.onboarded : d.onboarded,
    nativeLang: asUiLang(s.nativeLang) ?? legacyTarget ?? d.nativeLang,
    fontSize:
      s.fontSize === 'small' || s.fontSize === 'large' ? s.fontSize : d.fontSize,
    theme:
      s.theme === 'light' || s.theme === 'dark' ? s.theme : d.theme,
    translation: {
      enabled,
      // 旧值 'local' / 已移除的 'nllb' 一律迁移到 'm2m100'
      engine: t.engine === 'cloud' ? 'cloud' : 'm2m100',
      cloud: {
        baseURL: (cloud.baseURL as string) || d.translation.cloud.baseURL,
        apiKey: (cloud.apiKey as string) ?? '',
        model: (cloud.model as string) || d.translation.cloud.model,
      },
    },
  };
}
