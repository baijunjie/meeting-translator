// 浏览器 PWA 薄入口：把 @rt/ui 挂载到 #app，并注入 Web 桥接实现。
// UI 全部来自 @rt/ui，平台差异（IndexedDB 存储 / 云 + 本地翻译 / Web ASR）封装在 ./bridge。
import { mountApp } from '@rt/ui';
import '@rt/ui/styles';
import { createWebBridge } from './bridge';

mountApp('#app', createWebBridge());
