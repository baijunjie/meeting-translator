// 应用设置的本地持久化：存到 electron userData/settings.json。
// 注意：API Key 目前明文保存，后续可改用 electron safeStorage 加密。
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppSettings, UiLang } from '../shared/types';

const UI_LANGS: UiLang[] = ['zh', 'zh-Hant', 'ja', 'en', 'ko'];

function defaultNativeLang(): UiLang {
  // 按系统语言猜母语，落到我们支持的语言之一，否则英语。
  // 优先用系统偏好语言（getLocale 返回的是 Chromium/应用语言，开发环境常为 en-US）。
  const candidates = [
    ...(app.getPreferredSystemLanguages?.() ?? []),
    app.getSystemLocale?.() ?? '',
    app.getLocale(),
  ].map((l) => (l || '').toLowerCase());
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

function makeDefaults(): AppSettings {
  return {
    onboarded: false,
    nativeLang: defaultNativeLang(),
    fontSize: 'medium',
    theme: 'system',
    translation: {
      enabled: false,
      engine: 'm2m100',
      cloud: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-4o-mini',
      },
    },
  };
}

let cached: AppSettings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function asUiLang(v: unknown): UiLang | null {
  return typeof v === 'string' && (UI_LANGS as string[]).includes(v) ? (v as UiLang) : null;
}

/** 补齐缺省字段，并兼容旧版本（translation.targetLang）的 JSON */
function withDefaults(raw: unknown): AppSettings {
  const d = makeDefaults();
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

export function loadSettings(): AppSettings {
  if (cached) {
    return cached;
  }
  try {
    cached = withDefaults(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')));
  } catch {
    cached = makeDefaults();
  }
  return cached;
}

export function saveSettings(next: AppSettings): AppSettings {
  cached = withDefaults(next);
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(cached, null, 2));
  } catch (err) {
    console.error('保存设置失败:', (err as Error).message);
  }
  return cached;
}
