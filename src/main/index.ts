import path from 'node:path';
import { app, BrowserWindow, ipcMain, systemPreferences, utilityProcess, type UtilityProcess } from 'electron';
import { loadSettings, saveSettings } from './settings';
import { asrModelsReady, downloadAsrModels } from './model-downloader';
import { listArchives, getArchive, saveArchive, deleteArchive } from './archives';
import asrWorkerPath from './asr-process?modulePath';
import translateWorkerPath from './translation/translate-process?modulePath';
import type {
  StartResult,
  AppSettings,
  SegmentPayload,
  SetupStatus,
  AsrToMain,
  TranslateToMain,
  ArchiveLine,
} from '../shared/types';

// 模型在仓库/应用根目录的 models/ 下（electron-vite 下 __dirname 指向 out/main）
const MODELS_DIR = path.join(app.getAppPath(), 'models');
const TRANSLATION_CACHE_DIR = path.join(MODELS_DIR, 'transformers');

let win: BrowserWindow | null = null;
// ASR 识别跑在独立的 utilityProcess 子进程，主进程只转发音频、不做推理
let asrChild: UtilityProcess | null = null;
let asrReady: Promise<void> | null = null;

// 翻译跑在独立的 utilityProcess 子进程：隔离原生崩溃与超大内存分配（如 NLLB 反量化
// 在主进程会被 Chromium 分配器 abort），翻译进程挂掉也不连累主窗口，仅丢一次翻译
let translateChild: UtilityProcess | null = null;

// 应用图标（dev 下 Dock 显示 Electron 默认图标，需手动设置）
const APP_ICON = path.join(app.getAppPath(), 'build', 'icon.png');

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Meeting Translator',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  });
  // 开发用 vite dev server，生产加载打包后的 HTML
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

/** 启动翻译子进程并按当前设置初始化 */
function startTranslateChild(): UtilityProcess {
  const child = utilityProcess.fork(translateWorkerPath);
  translateChild = child;
  child.on('message', (m: TranslateToMain) => {
    if (m.type === 'status') {
      sendToRenderer('translation:status', m.payload);
    } else if (m.type === 'result') {
      sendToRenderer('pipeline:translation', { id: m.id, text: m.text });
    }
  });
  child.on('exit', (code) => {
    translateChild = null;
    if (code !== 0) {
      // 翻译进程异常退出（如模型内存过大崩溃）：主进程存活，提示失败，下次翻译自动重启
      sendToRenderer('translation:status', { state: 'error', error: `翻译进程异常退出 (${code})` });
    }
  });
  const t = loadSettings().translation;
  child.postMessage({
    type: 'configure',
    engine: t.engine,
    cloud: t.cloud,
    cacheDir: TRANSLATION_CACHE_DIR,
  });
  return child;
}

/** 确保翻译子进程已就绪（懒启动 + 复用） */
function ensureTranslateChild(): UtilityProcess {
  return translateChild ?? startTranslateChild();
}

/** 设置变更后让翻译子进程按新配置重建（kill 后下次按需重启） */
function reconfigureTranslate(): void {
  translateChild?.kill(); // exit 回调会清空引用
  translateChild = null;
}

/** 对一条定稿段做翻译（fire-and-forget），失败不影响转写。目标恒为母语 */
function translateSegment(segment: SegmentPayload): void {
  const settings = loadSettings();
  if (!settings.translation.enabled) {
    return;
  }
  ensureTranslateChild().postMessage({
    type: 'translate',
    id: segment.id,
    text: segment.text,
    source: segment.lang,
    target: settings.nativeLang,
  });
}

/** 启动 ASR 子进程并完成初始化（含模型加载 + 预热），resolve 表示就绪 */
function startAsrChild(): Promise<void> {
  const child = utilityProcess.fork(asrWorkerPath);
  asrChild = child;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    child.on('message', (m: AsrToMain) => {
      switch (m.type) {
        case 'ready':
          settled = true;
          resolve();
          break;
        case 'segment':
          sendToRenderer('pipeline:segment', m.payload); // 原文立即上屏
          translateSegment(m.payload); // 译文异步回填
          break;
        case 'partial':
          sendToRenderer('pipeline:partial', m.payload);
          break;
        case 'error':
          sendToRenderer('pipeline:status', { state: 'error', error: m.message });
          if (!settled) {
            // 初始化阶段就出错：销毁子进程，让 exit 清空引用，下次 start 可重新 fork 恢复
            settled = true;
            reject(new Error(m.message));
            child.kill();
          }
          break;
      }
    });
    child.on('exit', (code) => {
      asrChild = null;
      asrReady = null;
      if (code !== 0) {
        sendToRenderer('pipeline:status', { state: 'error', error: `识别进程异常退出 (${code})` });
        if (!settled) {
          settled = true;
          reject(new Error(`识别进程退出 ${code}`));
        }
      }
    });
    child.postMessage({ type: 'init', modelsDir: MODELS_DIR });
  });
}

/** 确保 ASR 子进程已就绪（懒启动 + 复用） */
function ensureAsr(): Promise<void> {
  if (!asrChild) {
    asrReady = startAsrChild();
  }
  return asrReady ?? Promise.resolve();
}

ipcMain.handle('pipeline:start', async (): Promise<StartResult> => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    if (!granted) {
      return { ok: false, error: '未获得麦克风权限，请在系统设置中授权' };
    }
  }

  try {
    sendToRenderer('pipeline:status', { state: 'loading' });
    await ensureAsr();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  sendToRenderer('pipeline:status', { state: 'running' });
  return { ok: true };
});

ipcMain.handle('setup:get-status', (): SetupStatus => ({ asrReady: asrModelsReady(MODELS_DIR) }));

ipcMain.handle('setup:download-asr', async (): Promise<{ ok: boolean; error?: string }> => {
  try {
    await downloadAsrModels(MODELS_DIR, (p) => sendToRenderer('setup:progress', p));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.on('pipeline:audio', (_event, samples: Float32Array) => {
  if (!asrChild) return;
  // IPC 过来的其实是字节视图，必须还原成 Float32Array 再转发，否则子进程会把
  // 8192 字节当成 8192 个浮点（值为 0-255）→ 音频变噪声、识别全错
  const f = new Float32Array(
    samples.buffer as ArrayBuffer,
    samples.byteOffset,
    samples.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  // 主进程只转发音频给识别子进程，不做推理
  asrChild.postMessage({ type: 'audio', samples: f });
});

ipcMain.on('translation:set-enabled', (_event, enabled: boolean) => {
  const settings = loadSettings();
  settings.translation.enabled = enabled;
  saveSettings(settings);
  // 开启时提前预热翻译器，避免第一句卡顿
  if (enabled) {
    ensureTranslateChild().postMessage({ type: 'preheat' });
  }
});

ipcMain.handle('archive:list', () => listArchives());
ipcMain.handle('archive:get', (_event, id: string) => getArchive(id));
ipcMain.handle('archive:save', (_event, name: string, lines: ArchiveLine[]) =>
  saveArchive(name, lines, Date.now())
);
ipcMain.handle('archive:delete', (_event, id: string) => deleteArchive(id));

ipcMain.handle('settings:get', (): AppSettings => loadSettings());

ipcMain.handle('settings:save', (_event, next: AppSettings): AppSettings => {
  const prev = loadSettings().translation;
  const cur = next.translation;
  // 只有翻译引擎/云端配置变了才需要重建翻译器；
  // 改主题/字体/母语不应触动翻译器（否则会误触发模型重新加载）
  const engineChanged =
    prev.engine !== cur.engine ||
    prev.cloud.baseURL !== cur.cloud.baseURL ||
    prev.cloud.apiKey !== cur.cloud.apiKey ||
    prev.cloud.model !== cur.cloud.model;

  const saved = saveSettings(next);
  if (engineChanged) {
    reconfigureTranslate();
    if (saved.translation.enabled) {
      ensureTranslateChild().postMessage({ type: 'preheat' });
    }
  }
  return saved;
});

ipcMain.handle('pipeline:stop', () => {
  asrChild?.postMessage({ type: 'flush' });
  sendToRenderer('pipeline:status', { state: 'stopped' });
  return { ok: true };
});

app.whenReady().then(() => {
  // macOS：dev 下 Dock 默认显示 Electron 图标，手动替换为应用图标
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  asrChild?.kill();
  translateChild?.kill();
  app.quit();
});
