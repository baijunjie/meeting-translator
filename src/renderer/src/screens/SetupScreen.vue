<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NProgress, NButton } from 'naive-ui';
import { LoaderCircle } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const emit = defineEmits<{ done: [] }>();

const loaded = ref(0);
const total = ref(0);
const failed = ref(false);

const percent = computed(() => (total.value > 0 ? Math.round((loaded.value / total.value) * 100) : 0));
const indeterminate = computed(() => total.value === 0);

window.api.onSetupProgress((p) => {
  loaded.value = p.loaded;
  total.value = p.total;
});

async function start(): Promise<void> {
  failed.value = false;
  loaded.value = 0;
  total.value = 0;
  const res = await window.api.downloadAsrModels();
  if (res.ok) {
    emit('done');
  } else {
    failed.value = true;
  }
}

onMounted(start);
</script>

<template>
  <div class="flex h-full items-center justify-center">
    <div class="w-[440px] max-w-[90%] p-6 text-center">
      <h1 class="mb-2 text-[20px] font-semibold">{{ t('setup.title') }}</h1>
      <p class="mb-6 text-sm text-neutral-500 dark:text-neutral-400">{{ t('setup.desc') }}</p>

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
      </template>

      <template v-else>
        <p class="mb-4 text-sm text-red-500">{{ t('setup.failed') }}</p>
        <n-button type="primary" @click="start">{{ t('setup.retry') }}</n-button>
      </template>
    </div>
  </div>
</template>
