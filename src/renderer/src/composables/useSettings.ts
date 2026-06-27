import { ref } from 'vue';
import { i18n } from '../i18n';
import type { AppSettings, FontSize, UiLang } from '@shared/types';

const FONT_PX: Record<FontSize, string> = { small: '13px', medium: '15px', large: '18px' };

// 全局单例：整个渲染进程共享同一份设置
export const settings = ref<AppSettings | null>(null);

function applyLocale(lang: UiLang): void {
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang;
}

export function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty('--transcript-size', FONT_PX[size]);
}

/** 启动时加载设置并应用语言/字体 */
export async function loadSettings(): Promise<AppSettings> {
  const s = await window.api.getSettings();
  settings.value = s;
  applyLocale(s.nativeLang);
  applyFontSize(s.fontSize);
  return s;
}

/** 持久化整份设置，并重新应用语言/字体 */
export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const saved = await window.api.saveSettings(next);
  settings.value = saved;
  applyLocale(saved.nativeLang);
  applyFontSize(saved.fontSize);
  return saved;
}

/** 仅预览界面语言/字体（设置页未保存前的实时预览） */
export function previewLocale(lang: UiLang): void {
  applyLocale(lang);
}

/** 主页翻译开关（轻量，不重建翻译器） */
export function setTranslateEnabled(enabled: boolean): void {
  if (settings.value) {
    settings.value.translation.enabled = enabled;
  }
  window.api.setTranslateEnabled(enabled);
}
