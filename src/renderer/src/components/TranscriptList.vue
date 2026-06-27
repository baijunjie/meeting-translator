<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { TranscriptLine } from '../composables/useTranscription';
import ConversationLine from './ConversationLine.vue';

const props = defineProps<{
  lines: TranscriptLine[];
  partial: string;
  recording?: boolean;
  emptyHint: string;
  listeningHint: string;
  translateOn?: boolean;
}>();

const scroller = ref<HTMLElement | null>(null);

// 最新的在最上面
const reversed = computed(() => [...props.lines].reverse());

// 最新确定句：始终置顶并停留（含翻译），直到下一句确定后才被替换并落入历史。
const latest = computed(() => reversed.value[0] ?? null);
// 历史列表：除最新确定句外的所有句子。
const historyLines = computed(() => reversed.value.slice(1));

const hasContent = computed(() => props.lines.length > 0 || !!props.partial);

// 识别区的“存在”绑定到录音会话，而非瞬时内容：
// 录音中即常驻显示，避免首句确认时 partial 先清空、segment 后到达导致 hasContent 短暂 false→true，
// 从而把识别框 unmount→remount、令入场动画重播（这是 partial/segment 分两次 IPC 到达的根因）。
const recogVisible = computed(() => !!props.recording || hasContent.value);

// 历史新增时的滚动策略：
// - 已在顶部：保持置顶，跟随最新；
// - 正在查看历史（已下滑）：静默插入，锚定当前视口位置，不把用户卷上去。
const AT_TOP_THRESHOLD = 24; // px，容忍极小的非零偏移仍视作“在顶部”
watch(
  () => props.lines.length,
  async () => {
    const el = scroller.value;
    if (!el) return;
    // 此刻 DOM 仍是旧列表（watcher 默认 pre-flush），先量旧状态
    const wasAtTop = el.scrollTop <= AT_TOP_THRESHOLD;
    const prevHeight = el.scrollHeight;
    await nextTick();
    if (wasAtTop) {
      el.scrollTop = 0;
    } else {
      // 新内容插在顶部，补偿高度差以锚定用户正在看的位置
      el.scrollTop += el.scrollHeight - prevHeight;
    }
  }
);

const CUR_TEXT = 'text-[length:calc(var(--transcript-size)+14px)]';
const CUR_TR = 'text-[length:calc(var(--transcript-size)+7px)]';

// 最小高度（含内边距，border-box）：短句保持稳固不塌陷，长句则自然撑高、不裁切、不溢出。
// 识别区 ≈ 2 行大字 + py-6。
const recogHeight = 'calc((var(--transcript-size) + 14px) * 2.75 + 3rem)';
// 确定句区：开启翻译时额外预留 1 行译文空间，避免译文异步到达时高度跳变；+ py-7。
const finalHeight = computed(() =>
  props.translateOn
    ? 'calc((var(--transcript-size) + 14px) * 2.75 + (var(--transcript-size) + 7px) * 1.45 + 0.9rem + 3.5rem)'
    : 'calc((var(--transcript-size) + 14px) * 2.75 + 3.5rem)'
);
// 预留 1 行译文的高度（与 finalHeight 中的译文项一致），译文未到达时占位、到达时原地淡入。
const trLineHeight = 'calc((var(--transcript-size) + 7px) * 1.45)';
</script>

<template>
  <div class="relative flex flex-1 flex-col overflow-hidden">
    <p
      v-if="!recogVisible"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] text-neutral-400 dark:text-neutral-500"
    >
      {{ emptyHint }}
    </p>

    <!-- 顶部固定区：实时识别 +「最新确定句（含翻译）」，不随历史滚动。两区高度固定、互不影响。
         入场动画用纯 CSS @keyframes（rise-in），绑定在元素“被创建”那一刻，因此天然只在挂载时播放一次。
         识别区挂载绑定 recogVisible（录音会话），确定句外层盒子常驻（latest 一旦有值即保持），
         二者在整段会话内都不会重建，故各自只升起一次；内部内容切换走各自独立的 <transition>（card / tr-fade）。 -->
    <div class="shrink-0">
      <!-- 识别区（橙色、虚线框，区别于蓝色确定句区）：进行中显示 partial，停顿时显示提示。内部内容直接切换、不做过渡 -->
      <div
        v-if="recogVisible"
        :style="{ minHeight: recogHeight }"
        class="rise-in mx-auto mt-5 flex max-w-[88%] items-center justify-center rounded-2xl border border-dashed border-amber-500/45 bg-amber-500/[0.07] px-6 py-6 text-center"
      >
        <div
          v-if="partial"
          :class="[CUR_TEXT, 'font-semibold leading-snug text-amber-700 dark:text-amber-300']"
        >
          {{ partial }}
        </div>
        <div
          v-else
          :class="[CUR_TEXT, 'font-medium leading-snug text-amber-700/45 dark:text-amber-300/45']"
        >
          {{ listeningHint }}
        </div>
      </div>

      <!-- 最新确定句 + 翻译（蓝色区）：外层盒子常驻不重建（只有内部内容随新句切换），停留到下一句确定后才被替换 -->
      <div
        v-if="latest"
        :style="{ minHeight: finalHeight }"
        class="rise-in mx-auto mt-5 flex max-w-[88%] flex-col items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 px-6 py-7 text-center"
      >
        <transition name="card" mode="out-in">
          <div :key="latest.id">
            <div :class="[CUR_TEXT, 'font-semibold leading-snug text-neutral-900 dark:text-white']">
              {{ latest.text }}
            </div>
            <!-- 开启翻译时始终预留译文行高度：译文异步到达时只淡入、不撑高，避免文字被顶动 -->
            <div v-if="translateOn" class="mt-3.5" :style="{ minHeight: trLineHeight }">
              <transition name="tr-fade">
                <div
                  v-if="latest.translation"
                  :class="[CUR_TR, 'leading-snug text-blue-600 dark:text-[#9db0ff]']"
                >
                  {{ latest.translation }}
                </div>
              </transition>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- 历史：最新在上，可滚动。新句从上方"落入"，其余整体下移 -->
    <div ref="scroller" class="flex-1 overflow-y-auto px-5 pb-5 pt-7">
      <transition-group name="drop" tag="div">
        <ConversationLine
          v-for="line in historyLines"
          :key="line.id"
          :time="line.time"
          :text="line.text"
          :translation="line.translation"
          dim
        />
      </transition-group>
    </div>
  </div>
</template>

<style scoped>
/* 大文字区域首次出现：升起淡入。用 @keyframes 绑定到元素创建，元素不重建则只播一次，永不重播 */
@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.rise-in {
  animation: rise-in 0.4s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 译文异步到达：在预留空间内淡入，不撑动文字 */
.tr-fade-enter-active {
  transition: opacity 0.25s ease;
}
.tr-fade-enter-from {
  opacity: 0;
}

/* 确定句卡片切换：新句从上方（识别区方向）落入，旧句向下离开（落向历史），形成自上而下的流动 */
.card-enter-active {
  transition: opacity 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.card-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.card-enter-from {
  opacity: 0;
  transform: translateY(-22px) scale(0.985);
}
.card-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

/* 历史列表：新句从上方落入，下方各句通过 FLIP 平滑下移 */
.drop-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.drop-enter-from {
  opacity: 0;
  transform: translateY(-14px);
}
.drop-move {
  transition: transform 0.3s ease;
}
.drop-leave-active {
  transition: opacity 0.18s ease;
}
.drop-leave-to {
  opacity: 0;
}
</style>
