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
</script>

<template>
  <div ref="scroller" class="transcript">
    <p v-if="lines.length === 0 && !partial" class="empty">{{ emptyHint }}</p>

    <!-- 正在识别：最大，置顶 -->
    <div v-if="partial" class="row current partial">
      <div class="time" />
      <div class="body"><div class="text">{{ partial }}</div></div>
    </div>

    <!-- 历史：最新在上；没有 partial 时，最新一条作为当前项放大 -->
    <div
      v-for="(line, idx) in reversed"
      :key="line.id"
      class="row"
      :class="{ current: !partial && idx === 0 }"
    >
      <div class="time">{{ line.time }}</div>
      <div class="body">
        <div class="text">{{ line.text }}</div>
        <div v-if="line.translation" class="translation">{{ line.translation }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  position: relative;
}
.empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #8b8d98;
  font-size: 13px;
}
.row {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.time {
  flex-shrink: 0;
  width: 48px;
  font-size: 11px;
  color: #8b8d98;
  padding-top: 3px;
}
.body {
  flex: 1;
}
.text {
  font-size: var(--transcript-size);
  line-height: 1.6;
}
.translation {
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid #4f7cff;
  font-size: calc(var(--transcript-size) - 1px);
  line-height: 1.5;
  color: #8b8d98;
}

/* 当前正在识别 / 最新一条：居中沉浸式卡片，与历史明显区分 */
.row.current {
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  margin: 6px 0 28px;
  padding: 32px 24px;
  border-radius: 16px;
  background: rgba(79, 124, 255, 0.1);
  border: 1px solid rgba(79, 124, 255, 0.28);
}
.current .time {
  display: none;
}
.current .body {
  width: 100%;
  max-width: 88%;
}
.current .text {
  font-size: calc(var(--transcript-size) + 14px);
  font-weight: 600;
  line-height: 1.5;
  color: #ffffff;
}
.current .translation {
  margin-top: 14px;
  padding-left: 0;
  border-left: none;
  font-size: calc(var(--transcript-size) + 7px);
  line-height: 1.5;
  color: #9db0ff;
}

/* partial（未定稿）：当前卡片内文字稍偏蓝灰 */
.current.partial .text {
  color: #c2ccff;
}

/* 历史：略微压暗，进一步衬托当前项 */
.row:not(.current) .text {
  color: #c9ccd6;
}
</style>
