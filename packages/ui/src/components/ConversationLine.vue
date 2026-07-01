<script setup lang="ts">
// 一行对话：时间 + 原文 + 可选译文。主页历史与归档详情共用。
// dim=true 用于主页历史（弱化，让当前句更突出）。
// translating=true 表示译文尚未到达、仍在翻译中：在译文区显示等待动画（归档详情不传，恒 false）。
import TranslatingDots from './TranslatingDots.vue';
defineProps<{
  time: string;
  text: string;
  translation?: string;
  dim?: boolean;
  translating?: boolean;
}>();
</script>

<template>
  <div class="mb-3.5 flex gap-3">
    <div
      class="w-12 shrink-0 whitespace-nowrap pt-[3px] text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500"
    >
      {{ time }}
    </div>
    <div class="min-w-0 flex-1">
      <div
        :class="[
          'text-[length:var(--transcript-size)] leading-relaxed',
          dim ? 'text-neutral-600 dark:text-neutral-300' : 'text-neutral-700 dark:text-neutral-200',
        ]"
      >
        {{ text }}
      </div>
      <div
        v-if="translation || translating"
        class="mt-1 border-l-2 border-blue-500 pl-2.5 text-[length:calc(var(--transcript-size)-1px)] leading-relaxed text-neutral-500 dark:text-neutral-400"
      >
        <template v-if="translation">{{ translation }}</template>
        <TranslatingDots v-else class="text-blue-500/70" />
      </div>
    </div>
  </div>
</template>
