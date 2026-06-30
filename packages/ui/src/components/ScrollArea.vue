<script setup lang="ts">
import { ref } from 'vue';
import { useScrollFade } from '../composables/useScrollFade';

const props = withDefaults(defineProps<{ fadeSize?: string }>(), { fadeSize: '1.5rem' });

const viewport = ref<HTMLElement | null>(null);
const { maskStyle } = useScrollFade(viewport, props.fadeSize);

// 暴露滚动容器，便于父组件做滚动锚定等操作
defineExpose({ viewport });
</script>

<template>
  <div ref="viewport" class="overflow-y-auto" :style="maskStyle">
    <slot />
  </div>
</template>
