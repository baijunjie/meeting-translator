<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NProgress, NButton } from 'naive-ui';
import { LoaderCircle } from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import { bridge } from '../bridge';
import {
  translationDownloading,
  translationProgress,
  translationFiles,
} from '../composables/useTranscription';

const { t } = useI18n();
// 同一套布局服务两类模型下载：asr（语音识别模型）与 translation（本地翻译模型）。
// 仅文案、下载调用与进度源随 mode 切换，蜂窝确认/skip 三态逻辑共用。
const props = withDefaults(defineProps<{ mode?: 'asr' | 'translation' }>(), { mode: 'asr' });
const emit = defineEmits<{ done: []; skip: [] }>();

const loaded = ref(0);
const total = ref(0);
const failed = ref(false);
// 蜂窝网络确认视图：为 true 时先征询用户，不自动下载
const confirming = ref(false);

const titleKey = computed(() => (props.mode === 'translation' ? 'setup.trTitle' : 'setup.title'));
const descKey = computed(() => (props.mode === 'translation' ? 'setup.trDesc' : 'setup.desc'));
const cellularDescKey = computed(() =>
  props.mode === 'translation' ? 'setup.trCellularDesc' : 'setup.cellularDesc',
);

// 进度源随 mode 切换：
//  - asr：onSetupProgress 上报的聚合字节（loaded/total）。
//  - translation：useTranscription 的全局翻译进度 ref（translationProgress 为 0~100 整数，
//    经缓存直接载入内存等无进度阶段值恒为 0，此时按 indeterminate 展示转圈）。
const percent = computed(() =>
  props.mode === 'translation'
    ? translationProgress.value
    : total.value > 0
      ? Math.round((loaded.value / total.value) * 100)
      : 0,
);
const indeterminate = computed(() =>
  props.mode === 'translation'
    ? !translationDownloading.value || translationProgress.value === 0
    : total.value === 0,
);

// 逐文件进度（仅 translation 模式）：模型由多个文件组成，总进度条下方逐文件展示独立进度。
// 只列 total ≥ 1MB 的文件——小 json/config 秒完，列出只是闪烁噪音（它们仍计入总进度）。
// 列表为空时模板不渲染该区块，布局与仅有总进度条时完全一致。
const MIN_FILE_BYTES = 1024 * 1024;
const fileList = computed(() =>
  props.mode === 'translation'
    ? translationFiles.value
        .filter((f) => f.total >= MIN_FILE_BYTES)
        .map((f) => ({
          file: f.file,
          name: f.file.split('/').pop() ?? f.file,
          percent: Math.round(f.progress * 100),
        }))
    : [],
);

bridge().onSetupProgress((p) => {
  loaded.value = p.loaded;
  total.value = p.total;
});

async function start(): Promise<void> {
  confirming.value = false;
  failed.value = false;
  loaded.value = 0;
  total.value = 0;
  // translation 模式复用 downloadTranslationModel（本页仅在该可选方法存在时被路由到，故断言非空），
  // 并清零上次可能残留的进度；下载/装载进度经 onTranslationStatus → 全局 ref 上报。
  let res: { ok: boolean; error?: string };
  if (props.mode === 'translation') {
    translationProgress.value = 0;
    translationFiles.value = [];
    res = await bridge().downloadTranslationModel!();
  } else {
    res = await bridge().downloadAsrModels();
  }
  if (res.ok) {
    emit('done');
  } else {
    failed.value = true;
  }
}

// 蜂窝网络下先弹确认再决定是否下载；WiFi / 无法判断类型时维持现状直接下载。
onMounted(async () => {
  let net = 'unknown';
  try {
    net = (await bridge().getNetworkType?.()) ?? 'unknown';
  } catch {
    /* 方法不存在或查询失败：按 unknown 处理，不打扰用户 */
  }
  if (net === 'cellular') {
    confirming.value = true;
  } else {
    await start();
  }
});
</script>

<template>
  <div class="flex h-full items-center justify-center">
    <div v-if="confirming" class="w-[440px] max-w-[90%] p-6 text-center">
      <h1 class="mb-2 text-[20px] font-semibold">{{ t('setup.cellularTitle') }}</h1>
      <p class="mb-6 text-sm text-neutral-500 dark:text-neutral-400">{{ t(cellularDescKey) }}</p>
      <div class="flex justify-center gap-2">
        <n-button @click="emit('skip')">{{ t('setup.cellularCancel') }}</n-button>
        <n-button type="primary" @click="start">{{ t('setup.cellularConfirm') }}</n-button>
      </div>
    </div>

    <div v-else class="w-[440px] max-w-[90%] p-6 text-center">
      <h1 class="mb-2 text-[20px] font-semibold">{{ t(titleKey) }}</h1>
      <p class="mb-6 text-sm text-neutral-500 dark:text-neutral-400">{{ t(descKey) }}</p>

      <template v-if="!failed">
        <div
          class="mb-2 flex items-center justify-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"
        >
          <LoaderCircle :size="14" class="animate-spin" />
          <span>{{ t('setup.downloading') }}</span>
          <span v-if="!indeterminate" class="tabular-nums">{{ percent }}%</span>
        </div>
        <n-progress
          type="line"
          :percentage="indeterminate ? 0 : percent"
          :show-indicator="false"
          :height="8"
          :processing="indeterminate"
        />

        <div v-if="fileList.length" class="mt-3 space-y-1 text-left">
          <div
            v-for="f in fileList"
            :key="f.file"
            class="flex items-center gap-2 text-[11px] text-neutral-400 dark:text-neutral-500"
          >
            <span class="w-36 shrink-0 truncate font-mono">{{ f.name }}</span>
            <n-progress
              class="flex-1"
              type="line"
              :percentage="f.percent"
              :show-indicator="false"
              :height="4"
            />
            <span class="w-9 shrink-0 text-right tabular-nums">{{ f.percent }}%</span>
          </div>
        </div>
      </template>

      <template v-else>
        <p class="mb-4 text-sm text-red-500">{{ t('setup.failed') }}</p>
        <!-- 失败可放弃：跳过回主界面（ASR 缺模型时点录音会重回本页；翻译则回退开关） -->
        <div class="flex justify-center gap-2">
          <n-button @click="emit('skip')">{{ t('setup.cellularCancel') }}</n-button>
          <n-button type="primary" @click="start">{{ t('setup.retry') }}</n-button>
        </div>
      </template>
    </div>
  </div>
</template>
