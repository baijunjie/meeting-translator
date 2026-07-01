import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// 以 index.html 为入口构建浏览器 PWA 产物到 dist/。
// @rt/ui 与 @rt/core 以 TS 源码消费，Vite 会把它们一起打进 bundle。
//
// base：默认 '/'，部署到 GitHub Pages（子路径）时用 BASE_PATH 注入，例如
//   BASE_PATH=/realtime-translator/ pnpm --filter @rt/web build
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // 自动注册并在新版本就绪后静默更新 Service Worker。
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Realtime Translator',
        short_name: 'Realtime',
        description: 'Local, real-time speech transcription and translation in your browser',
        // 浅色应用底色；主题色用品牌粉（与 macOS/iOS 一致）。
        background_color: '#ffffff',
        theme_color: '#FF5C7E',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 预缓存应用外壳；大模型（ASR/翻译）不在此预缓存，Phase 2 用 runtime 缓存单独处理。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // transformers.js / onnx 模型很大，提高单文件上限只为外壳里偶发的较大 chunk 兜底，
        // 仍不会把 HF 远程模型纳入预缓存（它们不是构建产物）。
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
      devOptions: {
        // 开发期不启用 SW，避免缓存干扰热更新（getUserMedia 在 localhost 下本就允许）。
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
