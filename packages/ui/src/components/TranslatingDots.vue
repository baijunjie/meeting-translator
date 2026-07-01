<script setup lang="ts">
// 翻译进行中的等待指示：三个脉冲圆点。语言中立、随字号缩放（em 单位）、继承 currentColor。
// 尊重 prefers-reduced-motion：退化为纯透明度呼吸，不做位移。
</script>

<template>
  <span class="translating-dots inline-flex items-center gap-[0.28em]" aria-hidden="true">
    <span class="dot" />
    <span class="dot" />
    <span class="dot" />
  </span>
</template>

<style scoped>
.dot {
  width: 0.4em;
  height: 0.4em;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.3;
  animation: translating-bounce 1.2s ease-in-out infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.18s;
}
.dot:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes translating-bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0) scale(0.85);
  }
  40% {
    opacity: 1;
    transform: translateY(-0.16em) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: translating-fade 1.4s ease-in-out infinite;
    transform: none;
  }
  @keyframes translating-fade {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
}
</style>
