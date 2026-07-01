// iOS（Capacitor）WebView 薄入口：把 @rt/ui 挂载到 #app，并注入 iOS 桥接实现。
// UI 全部来自 @rt/ui，平台差异（原生 ASR / Preferences 存储 / 云翻译）封装在 ./bridge。
import { mountApp } from '@rt/ui';
import '@rt/ui/styles';
import { createIosBridge } from './bridge';

mountApp('#app', createIosBridge());
