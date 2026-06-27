<script lang="ts">
import type {
  UiLang,
  FontSize,
  ThemePref,
  CloudTranslationConfig,
  TranslationEngine,
} from '@shared/types';

/** 设置表单的数据形状（设置页与首次引导向导共用） */
export interface SettingsFormData {
  nativeLang: UiLang;
  fontSize: FontSize;
  theme: ThemePref;
  engine: TranslationEngine;
  cloud: CloudTranslationConfig;
}
</script>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { NSelect, NInput, NFormItem, NAlert } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { previewLocale, previewTheme, applyFontSize } from '../composables/useSettings';

const { t } = useI18n();
// 父组件持有 reactive 表单对象，子组件直接通过 v-model 修改其字段
const props = defineProps<{ form: SettingsFormData }>();

// 按语言 key 字母序排列
const langOptions = [
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: '简体中文', value: 'zh' },
  { label: '繁體中文', value: 'zh-Hant' },
];
const fontOptions = computed(() => [
  { label: t('settings.fontSmall'), value: 'small' },
  { label: t('settings.fontMedium'), value: 'medium' },
  { label: t('settings.fontLarge'), value: 'large' },
]);
const themeOptions = computed(() => [
  { label: t('main.themeLight'), value: 'light' },
  { label: t('main.themeDark'), value: 'dark' },
  { label: t('main.themeSystem'), value: 'system' },
]);
const engineOptions = computed(() => [
  { label: t('settings.engineM2m100'), value: 'm2m100' },
  { label: t('settings.engineNllb'), value: 'nllb' },
  { label: t('settings.engineCloud'), value: 'cloud' },
]);

// 改动即时预览界面语言 / 主题 / 字体
watch(() => props.form.nativeLang, (v) => previewLocale(v));
watch(() => props.form.theme, (v) => previewTheme(v));
watch(() => props.form.fontSize, (v) => applyFontSize(v));
</script>

<template>
  <div>
    <n-form-item :label="t('settings.nativeLang')">
      <n-select v-model:value="form.nativeLang" :options="langOptions" />
    </n-form-item>

    <n-form-item :label="t('settings.fontSize')">
      <n-select v-model:value="form.fontSize" :options="fontOptions" />
    </n-form-item>

    <n-form-item :label="t('main.theme')">
      <n-select v-model:value="form.theme" :options="themeOptions" />
    </n-form-item>

    <n-form-item :label="t('settings.engine')">
      <n-select v-model:value="form.engine" :options="engineOptions" />
    </n-form-item>

    <template v-if="form.engine === 'cloud'">
      <n-alert type="warning" :show-icon="true" class="mb-3.5">{{ t('settings.cloudWarn') }}</n-alert>
      <n-form-item :label="t('settings.baseUrl')">
        <n-input v-model:value="form.cloud.baseURL" placeholder="https://api.openai.com/v1" />
      </n-form-item>
      <n-form-item :label="t('settings.apiKey')">
        <n-input v-model:value="form.cloud.apiKey" type="password" show-password-on="click" placeholder="sk-..." />
      </n-form-item>
      <n-form-item :label="t('settings.model')">
        <n-input v-model:value="form.cloud.model" placeholder="gpt-4o-mini" />
      </n-form-item>
      <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.cloudHint') }}</p>
    </template>
  </div>
</template>
