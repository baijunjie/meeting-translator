<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { NButton, NSelect, NInput, NAlert, NFormItem } from 'naive-ui';
import { ArrowLeft } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { settings, saveSettings, previewLocale, applyFontSize } from '../composables/useSettings';
import type { UiLang, FontSize } from '@shared/types';

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();

const current = settings.value!;
const nativeLang = ref<UiLang>(current.nativeLang);
const fontSize = ref<FontSize>(current.fontSize);
const engine = ref<'local' | 'cloud'>(current.translation.engine);
const baseURL = ref(current.translation.cloud.baseURL);
const apiKey = ref(current.translation.cloud.apiKey);
const model = ref(current.translation.cloud.model);

const langOptions = [
  { label: '中文', value: 'zh' },
  { label: '日本語', value: 'ja' },
  { label: 'English', value: 'en' },
  { label: '한국어', value: 'ko' },
];
const fontOptions = computed(() => [
  { label: t('settings.fontSmall'), value: 'small' },
  { label: t('settings.fontMedium'), value: 'medium' },
  { label: t('settings.fontLarge'), value: 'large' },
]);
const engineOptions = computed(() => [
  { label: t('settings.engineLocal'), value: 'local' },
  { label: t('settings.engineCloud'), value: 'cloud' },
]);

// 实时预览界面语言 / 字体
watch(nativeLang, (v) => previewLocale(v));
watch(fontSize, (v) => applyFontSize(v));

async function save(): Promise<void> {
  await saveSettings({
    ...current,
    nativeLang: nativeLang.value,
    fontSize: fontSize.value,
    translation: {
      ...current.translation,
      engine: engine.value,
      cloud: { baseURL: baseURL.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() },
    },
  });
  emit('close');
}

function cancel(): void {
  // 放弃未保存的预览
  previewLocale(current.nativeLang);
  applyFontSize(current.fontSize);
  emit('close');
}
</script>

<template>
  <div class="settings">
    <header class="topbar">
      <n-button quaternary circle :title="t('settings.back')" @click="cancel">
        <template #icon><ArrowLeft :size="18" /></template>
      </n-button>
      <span class="brand">{{ t('settings.title') }}</span>
      <div class="spacer" />
      <n-button type="primary" @click="save">{{ t('settings.save') }}</n-button>
    </header>

    <div class="body">
      <n-form-item :label="t('settings.nativeLang')">
        <n-select v-model:value="nativeLang" :options="langOptions" />
      </n-form-item>

      <n-form-item :label="t('settings.fontSize')">
        <n-select v-model:value="fontSize" :options="fontOptions" />
      </n-form-item>

      <n-form-item :label="t('settings.engine')">
        <n-select v-model:value="engine" :options="engineOptions" />
      </n-form-item>

      <template v-if="engine === 'cloud'">
        <n-alert type="warning" :show-icon="true" class="warn">{{ t('settings.cloudWarn') }}</n-alert>
        <n-form-item :label="t('settings.baseUrl')">
          <n-input v-model:value="baseURL" placeholder="https://api.openai.com/v1" />
        </n-form-item>
        <n-form-item :label="t('settings.apiKey')">
          <n-input v-model:value="apiKey" type="password" show-password-on="click" placeholder="sk-..." />
        </n-form-item>
        <n-form-item :label="t('settings.model')">
          <n-input v-model:value="model" placeholder="gpt-4o-mini" />
        </n-form-item>
        <p class="hint">{{ t('settings.cloudHint') }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid #3a3b44;
}
.brand {
  font-size: 15px;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 22px 20px;
  max-width: 560px;
  width: 100%;
}
.warn {
  margin-bottom: 14px;
}
.hint {
  font-size: 12px;
  color: #8b8d98;
  margin: 4px 0 0;
}
</style>
