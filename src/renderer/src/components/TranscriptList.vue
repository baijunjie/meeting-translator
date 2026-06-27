<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { TranscriptLine } from '../composables/useTranscription';

const props = defineProps<{
  lines: TranscriptLine[];
  partial: string;
  emptyHint: string;
}>();

const scroller = ref<HTMLElement | null>(null);

// 最新的在最上面
const reversed = computed(() => [...props.lines].reverse());

// 新内容出现时滚到顶部（最新项在顶部）
watch(
  () => [props.lines.length, props.partial],
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = 0;
  }
);

const CUR_TEXT = 'text-[length:calc(var(--transcript-size)+14px)]';
const CUR_TR = 'text-[length:calc(var(--transcript-size)+7px)]';
</script>

<template>
  <div ref="scroller" class="relative flex-1 overflow-y-auto p-5">
    <p
      v-if="lines.length === 0 && !partial"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] text-neutral-400 dark:text-neutral-500"
    >
      {{ emptyHint }}
    </p>

    <!-- 正在识别：居中沉浸卡片，置顶 -->
    <div
      v-if="partial"
      class="mx-auto mb-7 max-w-[88%] rounded-2xl border border-blue-500/30 bg-blue-500/10 px-6 py-8 text-center"
    >
      <div :class="[CUR_TEXT, 'font-semibold leading-snug text-blue-700 dark:text-[#c2ccff]']">
        {{ partial }}
      </div>
    </div>

    <!-- 历史：最新在上；没有 partial 时最新一条作为当前项居中放大 -->
    <template v-for="(line, idx) in reversed" :key="line.id">
      <div
        v-if="!partial && idx === 0"
        class="mx-auto mb-7 max-w-[88%] rounded-2xl border border-blue-500/30 bg-blue-500/10 px-6 py-8 text-center"
      >
        <div :class="[CUR_TEXT, 'font-semibold leading-snug text-neutral-900 dark:text-white']">
          {{ line.text }}
        </div>
        <div
          v-if="line.translation"
          :class="[CUR_TR, 'mt-3.5 leading-snug text-blue-600 dark:text-[#9db0ff]']"
        >
          {{ line.translation }}
        </div>
      </div>

      <div v-else class="mb-3.5 flex gap-3">
        <div class="w-12 shrink-0 pt-[3px] text-[11px] text-neutral-400 dark:text-neutral-500">
          {{ line.time }}
        </div>
        <div class="flex-1">
          <div class="text-[length:var(--transcript-size)] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {{ line.text }}
          </div>
          <div
            v-if="line.translation"
            class="mt-1 border-l-2 border-blue-500 pl-2.5 text-[length:calc(var(--transcript-size)-1px)] leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {{ line.translation }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
