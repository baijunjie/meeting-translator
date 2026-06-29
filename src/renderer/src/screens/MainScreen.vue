<script setup lang="ts">
import { computed, ref, h } from 'vue';
import { NButton, NSwitch, NProgress, NModal, NInput, NDropdown } from 'naive-ui';
import { Settings, Trash2, Archive, Library, Eraser, Sun, Moon, Monitor, LoaderCircle, TriangleAlert } from '@lucide/vue';
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
  translationDownloading,
  translationProgress,
  translationError,
} from '../composables/useTranscription';
import TranscriptList from '../components/TranscriptList.vue';
import { fmtDateTime } from '../utils/datetime';

const { t } = useI18n();
defineEmits<{ 'open-settings': []; 'open-archive': [] }>();

// 仅已定稿记录才算"有内容可清"：实时 partial 是瞬时的，清它没意义（归档也只存 lines）
const hasContent = computed(() => lines.length > 0);

// 清屏按钮：点击弹下拉，选择归档或删除
const clearOptions = computed(() => [
  { key: 'archive', label: t('main.archive'), icon: () => h(Archive, { size: 16 }) },
  { key: 'delete', label: t('archive.delete'), icon: () => h(Trash2, { size: 16 }) },
]);

function onClearSelect(key: string): void {
  if (key === 'delete') {
    clearTranscript();
  } else {
    void openArchiveModal();
  }
}

const archiveModalOpen = ref(false);
const archiveName = ref('');

function defaultArchiveName(): string {
  return fmtDateTime(Date.now());
}

async function openArchiveModal(): Promise<void> {
  // 生成不与现有重复的默认名
  let name = defaultArchiveName();
  try {
    const names = new Set((await window.api.listArchives()).map((a) => a.name));
    if (names.has(name)) {
      let i = 2;
      while (names.has(`${name} (${i})`)) i += 1;
      name = `${name} (${i})`;
    }
  } catch {
    /* 取不到列表就用默认名 */
  }
  archiveName.value = name;
  archiveModalOpen.value = true;
}

async function confirmArchive(): Promise<void> {
  const snapshot = lines.map((l) => ({ time: l.time, text: l.text, translation: l.translation }));
  await window.api.saveArchive(archiveName.value.trim() || defaultArchiveName(), snapshot);
  clearTranscript();
  archiveModalOpen.value = false;
}

const translateOn = computed<boolean>({
  get: () => settings.value?.translation.enabled ?? false,
  set: (v) => setTranslateEnabled(v),
});

const themeIcon = computed(() =>
  themePref.value === 'light' ? Sun : themePref.value === 'dark' ? Moon : Monitor
);

// 仅 ASR 模型加载属于"软件未就绪"：显示进度条并禁用录音。
// 翻译模型加载/下载是可选项，只在翻译开关旁提示，不挡录音。
const preparing = computed(() => modelLoading.value);

// 麦克风权限弹窗：''=不显示；'ask'=首次说明；'denied'=已拒绝去设置
const micModal = ref<'' | 'ask' | 'denied'>('');
const showMicModal = computed({
  get: () => micModal.value !== '',
  set: (v: boolean) => {
    if (!v) micModal.value = '';
  },
});

// 录音按钮：停止无需权限；开始前先查权限——未决先弹说明再触发系统授权，已拒绝则引导去设置
async function onRecordClick(): Promise<void> {
  if (recording.value) {
    toggleRecording();
    return;
  }
  let status = 'granted';
  try {
    status = await window.api.getMicStatus();
  } catch {
    /* 查询失败按已授权处理，让系统弹窗兜底 */
  }
  if (status === 'granted') {
    toggleRecording();
  } else if (status === 'denied' || status === 'restricted') {
    micModal.value = 'denied';
  } else {
    micModal.value = 'ask';
  }
}

function confirmMic(): void {
  micModal.value = '';
  toggleRecording(); // 此时才触发系统权限请求
}

function openMicSettings(): void {
  window.api.openMicSettings();
  micModal.value = '';
}
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
        <span
          v-if="translationLoading"
          class="inline-flex items-center gap-1 text-xs tabular-nums"
          :title="translationDownloading ? t('status.transDownloading') : t('status.transLoading')"
        >
          <LoaderCircle :size="13" class="animate-spin" />
          <span v-if="translationDownloading">{{ translationProgress }}%</span>
        </span>
        <TriangleAlert
          v-else-if="translationError"
          :size="14"
          class="text-red-500"
          :title="t('status.transFailed')"
        />
        <n-switch v-model:value="translateOn" size="small" />
      </label>

      <n-button quaternary circle :title="t('main.theme')" @click="cycleTheme">
        <template #icon><component :is="themeIcon" :size="18" /></template>
      </n-button>
      <!-- NDropdown 无 disabled 属性：无内容时直接渲染禁用按钮，避免空状态仍能弹出菜单 -->
      <n-dropdown v-if="hasContent" trigger="click" :options="clearOptions" @select="onClearSelect">
        <n-button quaternary circle :title="t('main.clear')">
          <template #icon><Eraser :size="18" /></template>
        </n-button>
      </n-dropdown>
      <n-button v-else quaternary circle disabled :title="t('main.clear')">
        <template #icon><Eraser :size="18" /></template>
      </n-button>
      <n-button quaternary circle :title="t('main.viewArchives')" @click="$emit('open-archive')">
        <template #icon><Library :size="18" /></template>
      </n-button>
      <n-button quaternary circle :title="t('main.settings')" @click="$emit('open-settings')">
        <template #icon><Settings :size="18" /></template>
      </n-button>
      <n-button :type="recording ? 'error' : 'primary'" :disabled="preparing" @click="onRecordClick">
        {{ recording ? t('main.stop') : t('main.start') }}
      </n-button>
    </header>

    <!-- ASR 模型加载中：显示进度条并禁用录音 -->
    <div v-if="preparing" class="border-b border-neutral-200 px-5 py-3 dark:border-[#3a3b44]">
      <div class="mb-1.5 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <LoaderCircle :size="14" class="animate-spin" />
        <span>{{ t('status.loadingModel') }}</span>
      </div>
      <n-progress type="line" :percentage="0" :show-indicator="false" :height="6" :processing="true" />
    </div>

    <transcript-list
      :lines="lines"
      :partial="partial"
      :recording="recording"
      :empty-hint="t('main.emptyHint')"
      :listening-hint="t('main.listening')"
      :translate-on="translateOn"
    />

    <!-- 归档命名弹窗 -->
    <n-modal
      v-model:show="archiveModalOpen"
      preset="card"
      :title="t('archive.modalTitle')"
      style="width: 420px; max-width: 90vw"
    >
      <div class="mb-1.5 text-xs text-neutral-500 dark:text-neutral-400">{{ t('archive.nameLabel') }}</div>
      <n-input v-model:value="archiveName" autofocus @keydown.enter="confirmArchive" />
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="archiveModalOpen = false">{{ t('archive.cancel') }}</n-button>
          <n-button type="primary" @click="confirmArchive">{{ t('archive.save') }}</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 麦克风权限说明弹窗：在触发系统授权前先告知用途 -->
    <n-modal
      v-model:show="showMicModal"
      preset="card"
      :title="micModal === 'denied' ? t('mic.deniedTitle') : t('mic.title')"
      style="width: 420px; max-width: 90vw"
    >
      <p class="text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
        {{ micModal === 'denied' ? t('mic.deniedDesc') : t('mic.desc') }}
      </p>
      <template #footer>
        <div class="flex justify-end gap-2">
          <n-button @click="micModal = ''">{{ t('mic.cancel') }}</n-button>
          <n-button v-if="micModal === 'denied'" type="primary" @click="openMicSettings">
            {{ t('mic.openSettings') }}
          </n-button>
          <n-button v-else type="primary" @click="confirmMic">{{ t('mic.allow') }}</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>
