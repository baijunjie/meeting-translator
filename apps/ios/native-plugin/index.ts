// 注册原生插件并导出强类型句柄。
// registerPlugin 在原生壳内绑定到对应 Swift 插件；在纯浏览器（vite dev / 预览）下，
// 调用会因为无原生实现而 reject——这是预期行为，真机/模拟器里才有原生能力。
//  - MeetingAsr        → ./ios/MeetingAsrPlugin.swift（sherpa-onnx 端上 ASR）
//  - MeetingTranslate  → ./ios/MeetingTranslate.swift（Apple Translation 端上翻译，iOS 18+）
import { registerPlugin } from '@capacitor/core';
import type { MeetingAsrPlugin, MeetingTranslatePlugin } from './definitions';

export const MeetingAsr = registerPlugin<MeetingAsrPlugin>('MeetingAsr');

export const MeetingTranslate =
  registerPlugin<MeetingTranslatePlugin>('MeetingTranslate');

export type {
  MeetingAsrPlugin,
  MeetingAsrEventMap,
  MeetingTranslatePlugin,
  TranslateResult,
  TranslateAvailability,
} from './definitions';
