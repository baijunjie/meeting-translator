<script setup lang="ts">
import { NButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { settings, saveSettings, previewLocale } from '../composables/useSettings';
import type { UiLang } from '@shared/types';

const { t } = useI18n();
const emit = defineEmits<{ done: [] }>();

const LANGS: { code: UiLang; name: string }[] = [
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
];

async function pick(code: UiLang): Promise<void> {
  if (!settings.value) return;
  await saveSettings({ ...settings.value, nativeLang: code, onboarded: true });
  emit('done');
}
</script>

<template>
  <div class="onboarding">
    <div class="box">
      <h1>{{ t('onboarding.title') }}</h1>
      <p>{{ t('onboarding.subtitle') }}</p>
      <div class="grid">
        <n-button
          v-for="l in LANGS"
          :key="l.code"
          size="large"
          class="lang-btn"
          @click="pick(l.code)"
          @mouseenter="previewLocale(l.code)"
        >
          {{ l.name }}
        </n-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.box {
  text-align: center;
  max-width: 420px;
  padding: 24px;
}
.box h1 {
  font-size: 22px;
  margin: 0 0 8px;
}
.box p {
  color: #8b8d98;
  margin: 0 0 24px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.lang-btn {
  height: 56px;
  font-size: 16px;
}
</style>
