import { ref, computed } from 'vue';
import { i18n } from '../i18n';
import { bridge } from '../bridge';
import type { AppSettings, FontSize, ThemePref, UiLang } from '@rt/core';

const FONT_PX: Record<FontSize, string> = { small: '13px', medium: '15px', large: '18px' };

// 全局单例：整个渲染进程共享同一份设置
export const settings = ref<AppSettings | null>(null);

// 当前是否深色（供 Naive 的 NConfigProvider 与界面响应式使用）
export const isDark = ref(false);
export const themePref = computed<ThemePref>(() => settings.value?.theme ?? 'system');

const darkMql = matchMedia('(prefers-color-scheme: dark)');

function applyTheme(pref: ThemePref): void {
  const dark = pref === 'system' ? darkMql.matches : pref === 'dark';
  isDark.value = dark;
  document.documentElement.classList.toggle('dark', dark);
}

// 跟随系统模式下，系统外观变化时实时更新
darkMql.addEventListener('change', () => {
  if (themePref.value === 'system') {
    applyTheme('system');
  }
});

function applyLocale(lang: UiLang): void {
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang;
}

export function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty('--transcript-size', FONT_PX[size]);
}

/** 启动时加载设置并应用语言/字体/主题 */
export async function loadSettings(): Promise<AppSettings> {
  const s = await bridge().getSettings();
  settings.value = s;
  applyLocale(s.nativeLang);
  applyFontSize(s.fontSize);
  applyTheme(s.theme);
  // 不在启动时主动预热翻译模型：否则每次打开都要把缓存模型重新载入内存、弹"加载中"。
  // 改为用到才载（开翻译开关 / 第一句要翻译时）。
  return s;
}

/** 持久化整份设置，并重新应用语言/字体/主题 */
export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  // 去掉 Vue 响应式 Proxy，否则 Electron IPC 结构化克隆会抛 "could not be cloned"
  const plain: AppSettings = JSON.parse(JSON.stringify(next));
  const saved = await bridge().saveSettings(plain);
  settings.value = saved;
  applyLocale(saved.nativeLang);
  applyFontSize(saved.fontSize);
  applyTheme(saved.theme);
  return saved;
}

/** 直接设置主题偏好（持久化） */
export function setTheme(pref: ThemePref): void {
  if (!settings.value || settings.value.theme === pref) return;
  void saveSettings({ ...settings.value, theme: pref });
}

/** 顶栏单按钮轮替：浅 → 深 → 跟随系统 */
export function cycleTheme(): void {
  if (!settings.value) return;
  const order: ThemePref[] = ['light', 'dark', 'system'];
  setTheme(order[(order.indexOf(settings.value.theme) + 1) % order.length]);
}

/** 仅预览主题（设置页未保存前的实时预览） */
export function previewTheme(pref: ThemePref): void {
  applyTheme(pref);
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
  bridge().setTranslateEnabled(enabled);
}
