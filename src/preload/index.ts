import { contextBridge, ipcRenderer } from 'electron';
import type { MeetingApi } from '../shared/types';

const api: MeetingApi = {
  startPipeline: () => ipcRenderer.invoke('pipeline:start'),
  stopPipeline: () => ipcRenderer.invoke('pipeline:stop'),
  sendAudio: (samples) => ipcRenderer.send('pipeline:audio', samples),
  setTranslateEnabled: (enabled) => ipcRenderer.send('translation:set-enabled', enabled),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  onSegment: (cb) => ipcRenderer.on('pipeline:segment', (_e, seg) => cb(seg)),
  onPartial: (cb) => ipcRenderer.on('pipeline:partial', (_e, p) => cb(p)),
  onTranslation: (cb) => ipcRenderer.on('pipeline:translation', (_e, t) => cb(t)),
  onStatus: (cb) => ipcRenderer.on('pipeline:status', (_e, s) => cb(s)),
  onTranslationStatus: (cb) => ipcRenderer.on('translation:status', (_e, s) => cb(s)),
};

contextBridge.exposeInMainWorld('api', api);
