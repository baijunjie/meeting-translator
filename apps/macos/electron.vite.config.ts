import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 以配置文件自身所在目录为根，确保无论从哪个 cwd（如 monorepo 根 `pnpm --filter`）
// 调用，别名都解析到 apps/macos/src/...。
const root = fileURLToPath(new URL('.', import.meta.url));

// 默认布局：main = src/main/index.ts，preload = src/preload/index.ts，
// renderer root = src/renderer（index.html）。v5 默认外部化依赖，
// 因此 sherpa-onnx-node / onnxruntime-node 等原生模块在主进程保持 require、不被打包。
// 例外：@mt/core 以 TS 源码消费，必须打进 main/preload 产物（不能外部化），
// 否则 out 里会留下 require("@mt/core") 在运行时找不到而崩溃。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@mt/core'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@mt/core'] })],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
        '@shared': resolve(root, 'src/shared'),
      },
    },
    plugins: [vue(), tailwindcss()],
  },
});
