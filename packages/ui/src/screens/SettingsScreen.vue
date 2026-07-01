<script setup lang="ts">
import { reactive, ref } from 'vue';
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
  // 三态：未开启翻译 → 无；开启 → 对应引擎（选了模型即视为开启，主页无独立开关）。
  engine: current.translation.enabled ? current.translation.engine : 'none',
  cloud: { ...current.translation.cloud },
});

// 云端引擎需先「测试连接」通过才允许保存；由 SettingsForm 回传（非云端恒为 true）。
const saveable = ref(true);

async function save(): Promise<void> {
  // 三态映射回持久化：选「无」→ enabled=false（引擎保留原值）；选模型 → enabled=true + 该引擎。
  const enabled = form.engine !== 'none';
  const engine = form.engine === 'none' ? current.translation.engine : form.engine;
  await saveSettings({
    ...current,
    nativeLang: form.nativeLang,
    fontSize: form.fontSize,
    theme: form.theme,
    translation: { ...current.translation, enabled, engine, cloud: { ...form.cloud } },
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
      <n-button type="primary" :disabled="!saveable" @click="save">{{ t('settings.save') }}</n-button>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto w-full max-w-[560px] px-5 py-6">
        <settings-form :form="form" v-model:saveable="saveable" />
      </div>
    </div>
  </div>
</template>
