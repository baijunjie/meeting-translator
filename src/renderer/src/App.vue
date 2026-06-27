<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NConfigProvider, darkTheme, lightTheme } from 'naive-ui';
import Onboarding from './screens/Onboarding.vue';
import SetupScreen from './screens/SetupScreen.vue';
import MainScreen from './screens/MainScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import { loadSettings, isDark } from './composables/useSettings';

type Screen = 'loading' | 'onboarding' | 'setup' | 'main' | 'settings';
const screen = ref<Screen>('loading');

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

// 引导完成 / 启动后：ASR 模型缺失则进下载页，否则进主页
async function afterOnboarded(): Promise<void> {
  const { asrReady } = await window.api.getSetupStatus();
  screen.value = asrReady ? 'main' : 'setup';
}

onMounted(async () => {
  const s = await loadSettings();
  if (!s.onboarded) {
    screen.value = 'onboarding';
  } else {
    await afterOnboarded();
  }
});
</script>

<template>
  <n-config-provider :theme="naiveTheme">
    <div class="h-screen overflow-hidden bg-white text-neutral-900 dark:bg-[#1e1f24] dark:text-neutral-100">
      <onboarding v-if="screen === 'onboarding'" @done="afterOnboarded" />
      <setup-screen v-else-if="screen === 'setup'" @done="screen = 'main'" />
      <main-screen v-else-if="screen === 'main'" @open-settings="screen = 'settings'" />
      <settings-screen v-else-if="screen === 'settings'" @close="screen = 'main'" />
    </div>
  </n-config-provider>
</template>
