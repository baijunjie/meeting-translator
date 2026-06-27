<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSwitch, NProgress } from 'naive-ui';
import { Settings, Trash2, Sun, Moon, Monitor, LoaderCircle, TriangleAlert } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { settings, setTranslateEnabled, themePref, cycleTheme } from '../composables/useSettings';
import {
  lines,
  partial,
  recording,
  modelLoading,
  errorText,
  toggleRecording,
  clearTranscript,
  translationLoading,
  translationProgress,
  translationError,
} from '../composables/useTranscription';
import TranscriptList from '../components/TranscriptList.vue';

const { t } = useI18n();
defineEmits<{ 'open-settings': [] }>();

const translateOn = computed<boolean>({
  get: () => settings.value?.translation.enabled ?? false,
  set: (v) => setTranslateEnabled(v),
});

const themeIcon = computed(() =>
  themePref.value === 'light' ? Sun : themePref.value === 'dark' ? Moon : Monitor
);

// 软件未就绪：加载 ASR 或下载翻译模型时
const preparing = computed(() => modelLoading.value || translationLoading.value);
const prepPercent = computed<number | null>(() =>
  translationLoading.value ? translationProgress.value : null
);
const prepLabel = computed(() =>
  translationLoading.value ? t('status.transLoading') : t('status.loadingModel')
);
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex items-center gap-3.5 border-b border-neutral-200 px-[18px] py-3 dark:border-[#3a3b44]"
    >
      <span class="text-[15px] font-semibold">Meeting Translator</span>
      <span v-if="errorText" class="text-xs text-red-500">{{ errorText }}</span>

      <div class="flex-1" />

      <label class="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
        <span>{{ t('main.translate') }}</span>
        <TriangleAlert
          v-if="translationError"
          :size="14"
          class="text-red-500"
          :title="t('status.transFailed')"
        />
        <n-switch v-model:value="translateOn" size="small" />
      </label>

      <n-button quaternary circle :title="t('main.theme')" @click="cycleTheme">
        <template #icon><component :is="themeIcon" :size="18" /></template>
      </n-button>
      <n-button
        quaternary
        circle
        :title="t('main.clear')"
        :disabled="lines.length === 0 && !partial"
        @click="clearTranscript"
      >
        <template #icon><Trash2 :size="18" /></template>
      </n-button>
      <n-button quaternary circle :title="t('main.settings')" @click="$emit('open-settings')">
        <template #icon><Settings :size="18" /></template>
      </n-button>
      <n-button :type="recording ? 'error' : 'primary'" :disabled="preparing" @click="toggleRecording">
        {{ recording ? t('main.stop') : t('main.start') }}
      </n-button>
    </header>

    <!-- 软件未就绪：明显的加载/下载进度条，期间禁用录音 -->
    <div v-if="preparing" class="border-b border-neutral-200 px-5 py-3 dark:border-[#3a3b44]">
      <div class="mb-1.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <LoaderCircle :size="14" class="animate-spin" />
        <span>{{ prepLabel }}</span>
        <span v-if="prepPercent !== null" class="ml-auto tabular-nums">{{ prepPercent }}%</span>
      </div>
      <n-progress
        type="line"
        :percentage="prepPercent ?? 0"
        :show-indicator="false"
        :height="6"
        :processing="prepPercent === null"
      />
    </div>

    <transcript-list :lines="lines" :partial="partial" :empty-hint="t('main.emptyHint')" />
  </div>
</template>
