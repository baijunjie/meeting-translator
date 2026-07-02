import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ElectronApi } from '../shared/types';

// 订阅主进程事件并返回反注册函数（AppBridge on* 契约：追加语义 + 可退订）
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ElectronApi = {
  startPipeline: () => ipcRenderer.invoke('pipeline:start'),
  prewarmPipeline: () => ipcRenderer.send('pipeline:prewarm'),
  stopPipeline: () => ipcRenderer.invoke('pipeline:stop'),
  sendAudio: (samples) => ipcRenderer.send('pipeline:audio', samples),
  getMicStatus: () => ipcRenderer.invoke('mic:get-status'),
  openMicSettings: () => ipcRenderer.send('mic:open-settings'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  testCloud: (cfg) => ipcRenderer.invoke('translation:test-cloud', cfg),
  getSetupStatus: () => ipcRenderer.invoke('setup:get-status'),
  downloadAsrModels: () => ipcRenderer.invoke('setup:download-asr'),
  getTranslationSetupStatus: () => ipcRenderer.invoke('translation:setup-status'),
  downloadTranslationModel: () => ipcRenderer.invoke('translation:download'),
  onSetupProgress: (cb) => subscribe('setup:progress', cb),
  saveArchive: (name, lines) => ipcRenderer.invoke('archive:save', name, lines),
  listArchives: () => ipcRenderer.invoke('archive:list'),
  getArchive: (id) => ipcRenderer.invoke('archive:get', id),
  deleteArchive: (id) => ipcRenderer.invoke('archive:delete', id),
  onSegment: (cb) => subscribe('pipeline:segment', cb),
  onPartial: (cb) => subscribe('pipeline:partial', cb),
  onTranslation: (cb) => subscribe('pipeline:translation', cb),
  onStatus: (cb) => subscribe('pipeline:status', cb),
  onTranslationStatus: (cb) => subscribe('translation:status', cb),
};

contextBridge.exposeInMainWorld('api', api);
