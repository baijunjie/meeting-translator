// macOS（Electron 渲染层）平台桥接：把 preload 暴露的 window.api（ElectronApi）包装成
// @rt/ui 依赖的平台无关 AppBridge。音频采集（getUserMedia + AudioContext + AudioWorklet）
// 在这里完成——@rt/ui 不再感知浏览器采集细节。
//
// startPipeline：先启动 ASR 子进程（api.startPipeline），就绪后开始采集并经 api.sendAudio 送 PCM。
// stopPipeline：先停采集（停轨 + 关闭 AudioContext），再停 ASR 子进程（api.stopPipeline）。
// 其余方法全部直通 window.api。

import type { AppBridge, StartResult } from '@rt/core';
import type { ElectronApi } from '@shared/types';

export function createMacBridge(api: ElectronApi): AppBridge {
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  // 重入守卫：正在进行的启动 promise，供并发/重复调用复用，避免双路采集与旧流引用被覆盖泄漏
  let starting: Promise<StartResult> | null = null;

  // 启动采集链路：ASR 子进程就绪后再取麦克风并接上 AudioWorklet。任一步失败则释放已获取的
  // stream/context 并回滚主进程已 start 的 pipeline，返回 { ok: false }（StartResult 契约），
  // 避免 unhandled rejection、麦克风指示灯常亮与主进程状态残留。
  async function beginCapture(): Promise<StartResult> {
    const r = await api.startPipeline();
    if (!r.ok) return r;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.audioWorklet.addModule('audio-worklet.js');
      const source = audioContext.createMediaStreamSource(mediaStream);
      const capture = new AudioWorkletNode(audioContext, 'capture-processor');
      capture.port.onmessage = (e: MessageEvent<Float32Array>) => api.sendAudio(e.data);
      source.connect(capture);
      return r;
    } catch (err) {
      mediaStream?.getTracks().forEach((tr) => tr.stop());
      mediaStream = null;
      await audioContext?.close();
      audioContext = null;
      await api.stopPipeline();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    async startPipeline() {
      if (starting) return starting;
      if (mediaStream) return { ok: true }; // 已在采集中，重复调用直接返回
      starting = beginCapture();
      try {
        return await starting;
      } finally {
        starting = null;
      }
    },

    async stopPipeline() {
      if (mediaStream) {
        mediaStream.getTracks().forEach((tr) => tr.stop());
        mediaStream = null;
      }
      if (audioContext) {
        await audioContext.close();
        audioContext = null;
      }
      return api.stopPipeline();
    },

    // ===== 以下全部直通 window.api =====
    prewarmPipeline: () => api.prewarmPipeline(),
    getMicStatus: () => api.getMicStatus(),
    openMicSettings: () => api.openMicSettings(),
    getSettings: () => api.getSettings(),
    saveSettings: (settings) => api.saveSettings(settings),
    testCloud: (cfg) => api.testCloud(cfg),
    getSetupStatus: () => api.getSetupStatus(),
    downloadAsrModels: () => api.downloadAsrModels(),
    getTranslationSetupStatus: () => api.getTranslationSetupStatus(),
    downloadTranslationModel: () => api.downloadTranslationModel(),
    saveArchive: (name, lines) => api.saveArchive(name, lines),
    listArchives: () => api.listArchives(),
    getArchive: (id) => api.getArchive(id),
    deleteArchive: (id) => api.deleteArchive(id),
    onSetupProgress: (cb) => api.onSetupProgress(cb),
    onSegment: (cb) => api.onSegment(cb),
    onPartial: (cb) => api.onPartial(cb),
    onTranslation: (cb) => api.onTranslation(cb),
    onStatus: (cb) => api.onStatus(cb),
    onTranslationStatus: (cb) => api.onTranslationStatus(cb),
  };
}
