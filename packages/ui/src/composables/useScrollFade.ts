import { ref, computed, watch, onMounted, onBeforeUnmount, type Ref } from 'vue';

// 给滚动容器的上/下边缘加渐隐遮罩：内容未到顶/底时，对应边缘用 mask-image 渐变淡出，
// 暗示「还有更多内容」。参考 shadcn-ui ScrollArea 的 fadeMask 思路，按本项目（普通
// overflow 容器）改写。遮罩随滚动位置动态切换：到顶只淡下、到底只淡上、中间两端都淡、
// 无溢出则不加。

const THRESHOLD = 2; // px 容差，吸收亚像素 scrollTop

export function useScrollFade(el: Ref<HTMLElement | null>, fadeSize = '1.5rem') {
  const atStart = ref(true);
  const atEnd = ref(true);
  const overflowing = ref(false);

  function update(): void {
    const node = el.value;
    if (!node) return;
    const max = node.scrollHeight - node.clientHeight;
    overflowing.value = max > THRESHOLD;
    atStart.value = node.scrollTop <= THRESHOLD;
    atEnd.value = node.scrollTop >= max - THRESHOLD;
  }

  let ro: ResizeObserver | null = null;
  function attach(node: HTMLElement): void {
    node.addEventListener('scroll', update, { passive: true });
    ro = new ResizeObserver(update);
    ro.observe(node); // 容器尺寸变化
    if (node.firstElementChild) ro.observe(node.firstElementChild); // 内容增减
    update();
  }
  function detach(node: HTMLElement): void {
    node.removeEventListener('scroll', update);
    ro?.disconnect();
    ro = null;
  }

  onMounted(() => {
    if (el.value) attach(el.value);
  });
  watch(el, (node, prev) => {
    if (prev) detach(prev);
    if (node && node !== prev) attach(node);
  });
  onBeforeUnmount(() => {
    if (el.value) detach(el.value);
  });

  const maskStyle = computed(() => {
    if (!overflowing.value || (atStart.value && atEnd.value)) return undefined;
    let stops: string;
    if (atStart.value) stops = `#000 calc(100% - ${fadeSize}), transparent 100%`;
    else if (atEnd.value) stops = `transparent 0, #000 ${fadeSize}`;
    else
      stops = `transparent 0, #000 ${fadeSize}, #000 calc(100% - ${fadeSize}), transparent 100%`;
    const img = `linear-gradient(to bottom, ${stops})`;
    return { maskImage: img, WebkitMaskImage: img };
  });

  return { maskStyle, atStart, atEnd, overflowing, update };
}
