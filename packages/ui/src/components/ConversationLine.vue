<script setup lang="ts">
// 一行对话：时间 + 原文 + 可选译文。主页历史与归档详情共用。
// dim=true 用于主页历史（弱化，让当前句更突出）。
defineProps<{ time: string; text: string; translation?: string; dim?: boolean }>();
</script>

<template>
  <div class="mb-3.5 flex gap-3">
    <div
      class="w-16 shrink-0 whitespace-nowrap pt-[3px] text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500"
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
        v-if="translation"
        class="mt-1 border-l-2 border-blue-500 pl-2.5 text-[length:calc(var(--transcript-size)-1px)] leading-relaxed text-neutral-500 dark:text-neutral-400"
      >
        {{ translation }}
      </div>
    </div>
  </div>
</template>
