<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NConfigProvider, darkTheme } from 'naive-ui';
import Onboarding from './screens/Onboarding.vue';
import MainScreen from './screens/MainScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import { loadSettings } from './composables/useSettings';

type Screen = 'loading' | 'onboarding' | 'main' | 'settings';
const screen = ref<Screen>('loading');

onMounted(async () => {
  const s = await loadSettings();
  screen.value = s.onboarded ? 'main' : 'onboarding';
});
</script>

<template>
  <n-config-provider :theme="darkTheme" class="root">
    <onboarding v-if="screen === 'onboarding'" @done="screen = 'main'" />
    <main-screen v-else-if="screen === 'main'" @open-settings="screen = 'settings'" />
    <settings-screen v-else-if="screen === 'settings'" @close="screen = 'main'" />
  </n-config-provider>
</template>

<style scoped>
.root {
  height: 100%;
}
</style>
