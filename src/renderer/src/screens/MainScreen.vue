<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NSwitch } from 'naive-ui';
import { Settings, Circle, Trash2 } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { settings, setTranslateEnabled } from '../composables/useSettings';
import {
  lines,
  partial,
  recording,
  statusKey,
  statusText,
  toggleRecording,
  clearTranscript,
} from '../composables/useTranscription';
import TranscriptList from '../components/TranscriptList.vue';

const { t } = useI18n();
defineEmits<{ 'open-settings': [] }>();

const statusDisplay = computed(() => statusText.value || t(statusKey.value));

const translateOn = computed<boolean>({
  get: () => settings.value?.translation.enabled ?? false,
  set: (v) => setTranslateEnabled(v),
});
</script>

<template>
  <div class="main">
    <header class="topbar">
      <span class="brand">Meeting Translator</span>
      <span class="status" :class="{ recording }">
        <Circle v-if="recording" :size="9" fill="currentColor" :stroke-width="0" />
        {{ statusDisplay }}
      </span>
      <div class="spacer" />
      <div class="translate">
        <span>{{ t('main.translate') }}</span>
        <n-switch v-model:value="translateOn" size="small" />
      </div>
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
      <n-button :type="recording ? 'error' : 'primary'" @click="toggleRecording">
        {{ recording ? t('main.stop') : t('main.start') }}
      </n-button>
    </header>

    <transcript-list :lines="lines" :partial="partial" :empty-hint="t('main.emptyHint')" />
  </div>
</template>

<style scoped>
.main {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid #3a3b44;
}
.brand {
  font-size: 15px;
  font-weight: 600;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #8b8d98;
}
.status.recording {
  color: #e5484d;
}
.spacer {
  flex: 1;
}
.translate {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #8b8d98;
}
</style>
