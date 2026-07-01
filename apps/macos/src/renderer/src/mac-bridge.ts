// macOS（Electron 渲染层）平台桥接：把 preload 暴露的 window.api（ElectronApi）包装成
// @rt/ui 依赖的平台无关 AppBridge。音频采集（getUserMedia + AudioContext + AudioWorklet）
// 在这里完成——@rt/ui 不再感知浏览器采集细节。
//
// startPipeline：先启动 ASR 子进程（api.startPipeline），就绪后开始采集并经 api.sendAudio 送 PCM。
// stopPipeline：先停采集（停轨 + 关闭 AudioContext），再停 ASR 子进程（api.stopPipeline）。
// 其余方法全部直通 window.api。

import type { AppBridge } from '@rt/core';
import type { ElectronApi } from '@shared/types';

export function createMacBridge(api: ElectronApi): AppBridge {
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;

  return {
    async startPipeline() {
      const r = await api.startPipeline();
      if (!r.ok) return r;

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      audioContext = new AudioContext({ sampleRate: 16000 });
      await audioContext.audioWorklet.addModule('audio-worklet.js');
      const source = audioContext.createMediaStreamSource(mediaStream);
      const capture = new AudioWorkletNode(audioContext, 'capture-processor');
      capture.port.onmessage = (e: MessageEvent<Float32Array>) => api.sendAudio(e.data);
      source.connect(capture);

      return r;
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
    setTranslateEnabled: (enabled) => api.setTranslateEnabled(enabled),
    getMicStatus: () => api.getMicStatus(),
    openMicSettings: () => api.openMicSettings(),
    getSettings: () => api.getSettings(),
    saveSettings: (settings) => api.saveSettings(settings),
    getSetupStatus: () => api.getSetupStatus(),
    downloadAsrModels: () => api.downloadAsrModels(),
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
