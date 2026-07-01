// 注册原生插件并导出强类型句柄。
// registerPlugin 在原生壳内绑定到对应 Swift 插件；在纯浏览器（vite dev / 预览）下，
// 调用会因为无原生实现而 reject——这是预期行为，真机/模拟器里才有原生能力。
//  - RealtimeAsr        → ./ios/RealtimeAsrPlugin.swift（sherpa-onnx 端上 ASR）
//  - RealtimeTranslate  → ./ios/RealtimeTranslate.swift（Apple Translation 端上翻译，iOS 18+）
import { registerPlugin } from '@capacitor/core';
import type { RealtimeAsrPlugin, RealtimeTranslatePlugin } from './definitions';

export const RealtimeAsr = registerPlugin<RealtimeAsrPlugin>('RealtimeAsr');

export const RealtimeTranslate =
  registerPlugin<RealtimeTranslatePlugin>('RealtimeTranslate');

export type {
  RealtimeAsrPlugin,
  RealtimeAsrEventMap,
  RealtimeTranslatePlugin,
  TranslateResult,
  TranslateAvailability,
} from './definitions';
