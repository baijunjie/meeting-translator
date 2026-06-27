import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

const root = process.cwd();

// 默认布局：main = src/main/index.ts，preload = src/preload/index.ts，
// renderer root = src/renderer（index.html）。v5 默认外部化依赖，
// 因此 sherpa-onnx-node / onnxruntime-node 等原生模块在主进程保持 require、不被打包。
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
        '@shared': resolve(root, 'src/shared'),
      },
    },
    plugins: [vue()],
  },
});
