import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor 配置：web 产物在 dist/（由 `vite build` 生成），
// 由 `npx cap add ios` + `cap sync ios` 拷贝进原生 iOS 工程。
const config: CapacitorConfig = {
  appId: 'io.github.baijunjie.meetingtranslator',
  appName: 'Meeting Translator',
  webDir: 'dist',
};

export default config;
