<script setup lang="ts">
import { reactive } from 'vue';
import { NButton } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import { settings, saveSettings } from '../composables/useSettings';
import SettingsForm, { type SettingsFormData } from '../components/SettingsForm.vue';

const { t } = useI18n();
const emit = defineEmits<{ done: [] }>();

const current = settings.value!;
const form = reactive<SettingsFormData>({
  nativeLang: current.nativeLang,
  fontSize: current.fontSize,
  theme: current.theme,
  engine: current.translation.engine,
  cloud: { ...current.translation.cloud },
});

async function start(): Promise<void> {
  await saveSettings({
    ...current,
    onboarded: true,
    nativeLang: form.nativeLang,
    fontSize: form.fontSize,
    theme: form.theme,
    translation: { ...current.translation, engine: form.engine, cloud: { ...form.cloud } },
  });
  emit('done');
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-6">
      <div class="w-full max-w-[460px]">
        <div class="mb-6 text-center">
          <h1 class="mb-2 text-[22px] font-semibold">{{ t('onboarding.title') }}</h1>
          <p class="text-neutral-500 dark:text-neutral-400">{{ t('onboarding.configure') }}</p>
        </div>
        <settings-form :form="form" />
        <n-button type="primary" block size="large" class="mt-4" @click="start">
          {{ t('onboarding.start') }}
        </n-button>
      </div>
    </div>
  </div>
</template>
