<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { TranscriptLine } from '../composables/useTranscription';
import { useScrollFade } from '../composables/useScrollFade';
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
const { maskStyle } = useScrollFade(scroller);

// 最新的在最上面
const reversed = computed(() => [...props.lines].reverse());

// 最新确定句：始终置顶并停留（含翻译），直到下一句确定后才被替换并落入历史。
const latest = computed(() => reversed.value[0] ?? null);
// 历史列表：除最新确定句外的所有句子。
const historyLines = computed(() => reversed.value.slice(1));

const hasContent = computed(() => props.lines.length > 0 || !!props.partial);

// 识别区只在录音时显示：录音中才存在"实时识别/聆听"，停止后应隐藏（不再显示「聆听中…」）。
// 绑定到 recording（整段会话恒为 true）还顺带避免了首句确认时 partial 先清空、segment 后到达
// 造成的 unmount→remount 入场动画重播（partial/segment 分两次 IPC 到达的根因）。
const recogVisible = computed(() => !!props.recording);

// 历史新增时的滚动策略：
// - 已在顶部：保持置顶跟随最新，并播放“落入”动画；
// - 正在查看历史（已下滑）：静默插入（关掉动画）+ 锚定当前视口位置，让正在看的条目纹丝不动。
const AT_TOP_THRESHOLD = 24; // px，容忍极小的非零偏移仍视作“在顶部”
const atTop = ref(true);
function onScroll(): void {
  const el = scroller.value;
  if (el) atTop.value = el.scrollTop <= AT_TOP_THRESHOLD;
}

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
      // 新内容插在顶部，补偿高度差以锚定用户正在看的位置。
      // 配合关闭 transition（见模板 :name），无 FLIP 形变，视口绝对静止。
      el.scrollTop += el.scrollHeight - prevHeight;
    }
  }
);

const CUR_TEXT = 'text-[length:calc(var(--transcript-size)+14px)]';
const CUR_TR = 'text-[length:calc(var(--transcript-size)+7px)]';

// 紧凑模式（手机 <640px）：方框内边距与预留行数收紧，少占竖向空间（桌面不变）
const isCompact = ref(false);
let mq: MediaQueryList | null = null;
const onMq = (e: MediaQueryListEvent | MediaQueryList): void => {
  isCompact.value = e.matches;
};
onMounted(() => {
  mq = window.matchMedia('(max-width: 639px)');
  onMq(mq);
  mq.addEventListener('change', onMq);
});
onBeforeUnmount(() => mq?.removeEventListener('change', onMq));

// 最小高度（含内边距，border-box）：短句不塌陷，长句自然撑高。
// padding 常量须与方框的 py 类一致：手机 py-4=2rem；桌面 识别 py-6=3rem、确定句 py-7=3.5rem。
const reservedLines = computed(() => (isCompact.value ? 2.4 : 2.75));
const recogPad = computed(() => (isCompact.value ? '2rem' : '3rem'));
const finalPad = computed(() => (isCompact.value ? '2rem' : '3.5rem'));
const trGap = computed(() => (isCompact.value ? '0.5rem' : '0.9rem')); // 对应 mt-2 / mt-3.5
const recogHeight = computed(
  () => `calc((var(--transcript-size) + 14px) * ${reservedLines.value} + ${recogPad.value})`
);
// 确定句区：开启翻译时额外预留 1 行译文空间，避免译文异步到达时高度跳变。
const finalHeight = computed(() =>
  props.translateOn
    ? `calc((var(--transcript-size) + 14px) * ${reservedLines.value} + (var(--transcript-size) + 7px) * 1.45 + ${trGap.value} + ${finalPad.value})`
    : `calc((var(--transcript-size) + 14px) * ${reservedLines.value} + ${finalPad.value})`
);
// 预留 1 行译文的高度（译文未到达时占位、到达时原地淡入）。
const trLineHeight = 'calc((var(--transcript-size) + 7px) * 1.45)';
</script>

<template>
  <div class="relative flex flex-1 flex-col overflow-hidden">
    <!-- inset-x-0 撑满整宽再居中；若用 left-1/2 不给宽度会被限到半宽而提前折行 -->
    <p
      v-if="!recording && !hasContent"
      class="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-[13px] text-neutral-400 dark:text-neutral-500"
    >
      {{ emptyHint }}
    </p>

    <!-- 顶部固定区：实时识别 +「最新确定句（含翻译）」，不随历史滚动。两区高度固定、互不影响。
         入场/退场统一用 <transition name="rise">：升起淡入、下沉淡出。
         识别区绑定 recogVisible（录音会话）、确定句外层盒子绑定 latest，二者整段会话内都不会重建，
         故各自只在出现时升起一次、消失时沉出一次；内部内容切换走各自独立的 <transition>（card / tr-fade）。 -->
    <div class="shrink-0">
      <!-- 识别区（橙色、虚线框，区别于蓝色确定句区）：进行中显示 partial，停顿时显示提示。内部内容直接切换、不做过渡 -->
      <transition name="rise">
        <div
          v-if="recogVisible"
          :style="{ minHeight: recogHeight }"
          class="mx-auto mt-5 flex max-w-[88%] items-center justify-center rounded-2xl border border-dashed border-amber-500/45 bg-amber-500/[0.07] px-6 py-6 text-center max-sm:mt-3 max-sm:max-w-[94%] max-sm:px-4 max-sm:py-4"
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
      </transition>

      <!-- 最新确定句 + 翻译（蓝色区）：外层盒子常驻不重建（只有内部内容随新句切换），停留到下一句确定后才被替换 -->
      <transition name="rise">
        <div
          v-if="latest"
          :style="{ minHeight: finalHeight }"
          class="mx-auto mt-5 flex max-w-[88%] flex-col items-center justify-center rounded-2xl border border-blue-500/30 bg-blue-500/10 px-6 py-7 text-center max-sm:mt-3 max-sm:max-w-[94%] max-sm:px-4 max-sm:py-4"
        >
          <transition name="card" mode="out-in">
            <div :key="latest.id">
              <div :class="[CUR_TEXT, 'font-semibold leading-snug text-neutral-900 dark:text-white']">
                {{ latest.text }}
              </div>
              <!-- 开启翻译时始终预留译文行高度：译文异步到达时只淡入、不撑高，避免文字被顶动 -->
              <div v-if="translateOn" class="mt-3.5 max-sm:mt-2" :style="{ minHeight: trLineHeight }">
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
      </transition>
    </div>

    <!-- 历史：最新在上，可滚动。在顶部时新句"落入"并整体下移；查看历史时关闭动画，静默插入保持视口静止。
         [overflow-anchor:none] 关闭浏览器原生滚动锚定，避免它与下方手动补偿叠加导致“多滚一条”的偏移。 -->
    <div
      ref="scroller"
      class="flex-1 overflow-y-auto px-5 pb-5 pt-7 max-sm:pb-28 [overflow-anchor:none]"
      :style="maskStyle"
      @scroll="onScroll"
    >
      <transition-group :name="atTop ? 'drop' : 'silent'" tag="div" class="relative">
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
/* 两个大文字框统一的入场/退场：升起淡入、下沉淡出。
   外层盒子整段会话不重建，故入场只在出现时播一次、退场只在消失时播一次。 */
.rise-enter-active {
  transition: opacity 0.4s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.4s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.rise-enter-from {
  opacity: 0;
  transform: translateY(18px) scale(0.96);
}
.rise-leave-active {
  transition: opacity 0.28s ease, transform 0.28s ease;
}
.rise-leave-to {
  opacity: 0;
  transform: translateY(-14px) scale(0.97);
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

/* 历史列表：
   - 顶部跟随时（drop）：新句从上方落入，下方各句通过 FLIP 平滑下移；
   - 查看历史时（silent）：不做入场/位移，保持视口静止（见模板说明）；
   - 两种模式下离场（清屏）都淡出，保证退场也有动画。 */
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
.drop-leave-active,
.silent-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.drop-leave-to,
.silent-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
