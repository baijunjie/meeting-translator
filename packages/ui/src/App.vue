<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NConfigProvider, darkTheme, lightTheme } from 'naive-ui';
import Onboarding from './screens/Onboarding.vue';
import SetupScreen from './screens/SetupScreen.vue';
import MainScreen from './screens/MainScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import ArchiveScreen from './screens/ArchiveScreen.vue';
import { loadSettings, isDark } from './composables/useSettings';
import { bridge } from './bridge';

type Screen = 'loading' | 'onboarding' | 'setup' | 'main' | 'settings' | 'archive';
const screen = ref<Screen>('loading');

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

// 引导完成 / 启动后：ASR 模型缺失则进下载页，否则进主页
async function afterOnboarded(): Promise<void> {
  const { asrReady } = await bridge().getSetupStatus();
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
    <!-- safe-area 内边距：iOS 刘海/灵动岛/Home 指示条留白；env() 在桌面端恒为 0，故 macOS 不受影响 -->
    <div
      class="h-svh overflow-hidden bg-white text-neutral-900 dark:bg-[#1e1f24] dark:text-neutral-100"
      style="padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"
    >
      <onboarding v-if="screen === 'onboarding'" @done="afterOnboarded" />
      <setup-screen v-else-if="screen === 'setup'" @done="screen = 'main'" />
      <main-screen
        v-else-if="screen === 'main'"
        @open-settings="screen = 'settings'"
        @open-archive="screen = 'archive'"
      />
      <settings-screen v-else-if="screen === 'settings'" @close="screen = 'main'" />
      <archive-screen v-else-if="screen === 'archive'" @close="screen = 'main'" />
    </div>
  </n-config-provider>
</template>
