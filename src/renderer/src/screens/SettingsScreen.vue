<script setup lang="ts">
import { reactive } from 'vue';
import { NButton } from 'naive-ui';
import { ArrowLeft } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { settings, saveSettings, previewLocale, applyFontSize, previewTheme } from '../composables/useSettings';
import SettingsForm, { type SettingsFormData } from '../components/SettingsForm.vue';

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();

const current = settings.value!;
const form = reactive<SettingsFormData>({
  nativeLang: current.nativeLang,
  fontSize: current.fontSize,
  theme: current.theme,
  engine: current.translation.engine,
  cloud: { ...current.translation.cloud },
});

async function save(): Promise<void> {
  await saveSettings({
    ...current,
    nativeLang: form.nativeLang,
    fontSize: form.fontSize,
    theme: form.theme,
    translation: { ...current.translation, engine: form.engine, cloud: { ...form.cloud } },
  });
  emit('close');
}

function cancel(): void {
  // 放弃未保存的预览
  previewLocale(current.nativeLang);
  applyFontSize(current.fontSize);
  previewTheme(current.theme);
  emit('close');
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex items-center gap-3 border-b border-neutral-200 px-[18px] py-3 dark:border-[#3a3b44]"
    >
      <n-button quaternary circle :title="t('settings.back')" @click="cancel">
        <template #icon><ArrowLeft :size="18" /></template>
      </n-button>
      <span class="text-[15px] font-semibold">{{ t('settings.title') }}</span>
      <div class="flex-1" />
      <n-button type="primary" @click="save">{{ t('settings.save') }}</n-button>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-[560px] px-5 py-6">
        <settings-form :form="form" />
      </div>
    </div>
  </div>
</template>
