import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronApi } from '../shared/types';

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
  onSetupProgress: (cb) => ipcRenderer.on('setup:progress', (_e, p) => cb(p)),
  saveArchive: (name, lines) => ipcRenderer.invoke('archive:save', name, lines),
  listArchives: () => ipcRenderer.invoke('archive:list'),
  getArchive: (id) => ipcRenderer.invoke('archive:get', id),
  deleteArchive: (id) => ipcRenderer.invoke('archive:delete', id),
  onSegment: (cb) => ipcRenderer.on('pipeline:segment', (_e, seg) => cb(seg)),
  onPartial: (cb) => ipcRenderer.on('pipeline:partial', (_e, p) => cb(p)),
  onTranslation: (cb) => ipcRenderer.on('pipeline:translation', (_e, t) => cb(t)),
  onStatus: (cb) => ipcRenderer.on('pipeline:status', (_e, s) => cb(s)),
  onTranslationStatus: (cb) => ipcRenderer.on('translation:status', (_e, s) => cb(s)),
};

contextBridge.exposeInMainWorld('api', api);
