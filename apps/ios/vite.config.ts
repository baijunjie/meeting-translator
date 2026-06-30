import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// 以 index.html 为入口构建 WebView 产物到 dist/。
// @mt/ui 与 @mt/core 以 TS 源码消费，Vite 会把它们一起打进 bundle（浏览器目标，自动）。
// base 用相对路径：Capacitor 在原生壳里以 capacitor://localhost 加载本地文件，
// 资源引用必须相对，绝对路径 `/assets/...` 会 404。
export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
