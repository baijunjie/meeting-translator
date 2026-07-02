<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NConfigProvider, darkTheme, lightTheme } from 'naive-ui';
import Onboarding from './screens/Onboarding.vue';
import SetupScreen from './screens/SetupScreen.vue';
import MainScreen from './screens/MainScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import ArchiveScreen from './screens/ArchiveScreen.vue';
import { loadSettings, settings, saveSettings, isDark } from './composables/useSettings';
import { modelLoading } from './composables/useTranscription';
import { bridge } from './bridge';

type Screen = 'loading' | 'onboarding' | 'setup' | 'setup-translation' | 'main' | 'settings' | 'archive';
const screen = ref<Screen>('loading');

const naiveTheme = computed(() => (isDark.value ? darkTheme : lightTheme));

// 进主界面前的路由分流：开启了本地翻译但模型未缓存时，先进翻译模型下载页（比照 ASR），否则直接进主页。
// 读全局缓存设置，避免重复 IO；getTranslationSetupStatus 缺省（如 iOS 无需自行下载）或查询异常时按已就绪处理。
async function enterMain(): Promise<void> {
  // 进主界面即后台装载 ASR 模型，首次录音免等冷启动（不触麦克风）。
  // 调用前先行禁用录音按钮，消除 loading 事件到达前的可点空窗；
  // 平台保证预热的任何路径（含跳过/失败）都以终态 status 收尾解禁。
  if (bridge().prewarmPipeline) {
    modelLoading.value = true;
    bridge().prewarmPipeline!();
  }
  const tr = settings.value?.translation;
  // 状态查询与显式下载须成对存在才路由到下载页（下载页内直接调用 downloadTranslationModel）
  const getStatus = bridge().getTranslationSetupStatus;
  if (tr?.enabled && tr.engine !== 'cloud' && getStatus && bridge().downloadTranslationModel) {
    try {
      const { ready } = await getStatus();
      if (!ready) {
        screen.value = 'setup-translation';
        return;
      }
    } catch {
      /* 查询失败：按已就绪处理进主界面（页内若真缺模型会在首句触发兜底下载） */
    }
  }
  screen.value = 'main';
}

// 取消翻译模型下载即「不开启本地翻译」：把开关回退为关闭并落盘（保持本地缓存设置同步），再回主界面。
async function onTranslationSetupSkip(): Promise<void> {
  const s = settings.value;
  if (s) {
    await saveSettings({ ...s, translation: { ...s.translation, enabled: false } });
  }
  screen.value = 'main';
}

// 引导完成 / 启动后：ASR 模型缺失则进下载页，否则按翻译模型状态分流进主页
async function afterOnboarded(): Promise<void> {
  const { asrReady } = await bridge().getSetupStatus();
  if (asrReady) {
    await enterMain();
  } else {
    screen.value = 'setup';
  }
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
      <!-- 两个下载页同为 SetupScreen，须给不同 key：setup→setup-translation 直达时强制重挂载，
           否则 Vue 复用同一实例、只换 mode prop，onMounted（网络检查 + 启动下载）不会再跑。 -->
      <setup-screen v-else-if="screen === 'setup'" key="setup-asr" @done="enterMain" @skip="screen = 'main'" />
      <setup-screen
        v-else-if="screen === 'setup-translation'"
        key="setup-translation"
        mode="translation"
        @done="screen = 'main'"
        @skip="onTranslationSetupSkip"
      />
      <main-screen
        v-else-if="screen === 'main'"
        @open-settings="screen = 'settings'"
        @open-archive="screen = 'archive'"
        @need-setup="screen = 'setup'"
      />
      <settings-screen
        v-else-if="screen === 'settings'"
        @close="screen = 'main'"
        @need-translation-setup="screen = 'setup-translation'"
      />
      <archive-screen v-else-if="screen === 'archive'" @close="screen = 'main'" />
    </div>
  </n-config-provider>
</template>
