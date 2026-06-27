import path from 'node:path';
import { app, BrowserWindow, ipcMain, systemPreferences, utilityProcess, type UtilityProcess } from 'electron';
import { createTranslator, type Translator } from './translation/translator';
import { loadSettings, saveSettings } from './settings';
import { asrModelsReady, downloadAsrModels } from './model-downloader';
import { listArchives, getArchive, saveArchive, deleteArchive } from './archives';
import asrWorkerPath from './asr-process?modulePath';
import type {
  StartResult,
  AppSettings,
  SegmentPayload,
  SetupStatus,
  AsrToMain,
  ArchiveLine,
} from '../shared/types';

// 模型在仓库/应用根目录的 models/ 下（electron-vite 下 __dirname 指向 out/main）
const MODELS_DIR = path.join(app.getAppPath(), 'models');
const TRANSLATION_CACHE_DIR = path.join(MODELS_DIR, 'transformers');

let win: BrowserWindow | null = null;
// ASR 识别跑在独立的 utilityProcess 子进程，主进程只转发音频、不做推理
let asrChild: UtilityProcess | null = null;
let asrReady: Promise<void> | null = null;

let translator: Translator | null = null;
let translatorReady: Promise<void> | null = null;

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

/** 按当前设置创建翻译器实例 */
function buildTranslator(): Translator {
  const t = loadSettings().translation;
  if (t.engine === 'cloud') {
    return createTranslator({ backend: 'cloud', cloud: t.cloud });
  }
  return createTranslator({ backend: 'm2m100', cacheDir: TRANSLATION_CACHE_DIR });
}

/** 设置变更后丢弃现有翻译器，下次按新配置重建 */
function resetTranslator(): void {
  translator = null;
  translatorReady = null;
}

/** 懒加载翻译器，本地模型首次会联网下载并把进度报给渲染层。返回就绪的实例 */
function ensureTranslator(): Promise<Translator> {
  if (!translator) {
    translator = buildTranslator();
  }
  const instance = translator; // 固定本次实例，期间即便 resetTranslator 也不受影响
  if (!translatorReady) {
    sendToRenderer('translation:status', { state: 'loading' });
    // 模型由多个文件组成，按总字节聚合进度，避免逐文件来回跳
    const fileBytes = new Map<string, { loaded: number; total: number }>();
    translatorReady = instance
      .init((p) => {
        if (p.file && typeof p.loaded === 'number' && typeof p.total === 'number' && p.total > 0) {
          fileBytes.set(p.file, { loaded: p.loaded, total: p.total });
          let loaded = 0;
          let total = 0;
          for (const f of fileBytes.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          sendToRenderer('translation:status', { state: 'loading', progress: loaded / total });
        }
      })
      .then(() => sendToRenderer('translation:status', { state: 'ready' }))
      .catch((err) => {
        translatorReady = null; // 允许下次重试
        sendToRenderer('translation:status', { state: 'error', error: (err as Error).message });
        throw err;
      });
  }
  return translatorReady.then(() => instance);
}

/** 对一条定稿段做翻译（fire-and-forget），失败不影响转写。目标恒为母语 */
function translateSegment(segment: SegmentPayload): void {
  const settings = loadSettings();
  if (!settings.translation.enabled) {
    return;
  }
  const target = settings.nativeLang;
  ensureTranslator()
    .then((t) => t.translate(segment.text, { source: segment.lang, target }))
    .then((text) => sendToRenderer('pipeline:translation', { id: segment.id, text }))
    .catch((err) => {
      console.error('翻译失败:', (err as Error).message);
      sendToRenderer('translation:status', { state: 'error', error: (err as Error).message });
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
    ensureTranslator().catch(() => {});
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
    resetTranslator();
    if (saved.translation.enabled) {
      ensureTranslator().catch(() => {});
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
  app.quit();
});
