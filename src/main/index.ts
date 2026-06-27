import path from 'node:path';
import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron';
import { TranscriptionPipeline } from './pipeline';
import { createTranslator, type Translator } from './translation/translator';
import { loadSettings, saveSettings } from './settings';
import type { StartResult, AppSettings, SegmentPayload } from '../shared/types';

// 模型在仓库/应用根目录的 models/ 下（electron-vite 下 __dirname 指向 out/main）
const MODELS_DIR = path.join(app.getAppPath(), 'models');
const TRANSLATION_CACHE_DIR = path.join(MODELS_DIR, 'transformers');

let win: BrowserWindow | null = null;
let pipeline: TranscriptionPipeline | null = null;

let translator: Translator | null = null;
let translatorReady: Promise<void> | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Meeting Translator',
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
    translatorReady = instance
      .init((p) => {
        if (typeof p.progress === 'number') {
          sendToRenderer('translation:status', { state: 'loading', progress: p.progress / 100 });
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

ipcMain.handle('pipeline:start', async (): Promise<StartResult> => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    if (!granted) {
      return { ok: false, error: '未获得麦克风权限，请在系统设置中授权' };
    }
  }

  if (!pipeline) {
    try {
      sendToRenderer('pipeline:status', { state: 'loading' });
      pipeline = new TranscriptionPipeline(MODELS_DIR, {
        onSegment: (segment) => {
          sendToRenderer('pipeline:segment', segment); // 原文立即上屏
          translateSegment(segment); // 译文异步回填
        },
        onPartial: (partial) => sendToRenderer('pipeline:partial', partial),
      });
    } catch (err) {
      pipeline = null;
      return { ok: false, error: (err as Error).message };
    }
  }
  sendToRenderer('pipeline:status', { state: 'running' });
  return { ok: true };
});

ipcMain.on('pipeline:audio', (_event, samples: Float32Array) => {
  if (!pipeline) {
    return;
  }
  try {
    // IPC 传过来的是类型化数组视图，还原成 Float32Array
    pipeline.acceptWaveform(
      new Float32Array(
        samples.buffer as ArrayBuffer,
        samples.byteOffset,
        samples.byteLength / Float32Array.BYTES_PER_ELEMENT
      )
    );
  } catch (err) {
    // 处理失败时丢弃管线，避免每个音频块都重复抛错
    pipeline = null;
    sendToRenderer('pipeline:status', { state: 'error', error: (err as Error).message });
  }
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

ipcMain.handle('settings:get', (): AppSettings => loadSettings());

ipcMain.handle('settings:save', (_event, next: AppSettings): AppSettings => {
  const saved = saveSettings(next);
  resetTranslator(); // 引擎/密钥可能变了，重建
  if (saved.translation.enabled) {
    ensureTranslator().catch(() => {});
  }
  return saved;
});

ipcMain.handle('pipeline:stop', () => {
  if (pipeline) {
    pipeline.flush();
  }
  sendToRenderer('pipeline:status', { state: 'stopped' });
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
