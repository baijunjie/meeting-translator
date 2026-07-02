import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell, systemPreferences, utilityProcess, type UtilityProcess } from 'electron';
import {
  M2M100_SPEC,
  translateFinalizedSegment,
  CloudTranslator,
  type SegmentTranslateRequest,
} from '@rt/core';
import { loadSettings, saveSettings } from './settings';
import { asrModelsReady, downloadAsrModels } from './model-downloader';
import { listArchives, getArchive, saveArchive, deleteArchive } from './archives';
import asrWorkerPath from './asr-process?modulePath';
import translateWorkerPath from './translation/translate-process?modulePath';
import type {
  StartResult,
  AppSettings,
  CloudTranslationConfig,
  SegmentPayload,
  SetupStatus,
  AsrToMain,
  TranslateToMain,
  ArchiveLine,
  MicPermission,
} from '../shared/types';

// 模型存放目录：
// - 打包后 app.getAppPath() 指向只读的 app.asar，必须写到可写的 userData；
// - 开发时用仓库根目录的 models/，便于复用已下载的模型。
const MODELS_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'models')
  : path.join(app.getAppPath(), 'models');
const TRANSLATION_CACHE_DIR = path.join(MODELS_DIR, 'transformers');

let win: BrowserWindow | null = null;
// ASR 识别跑在独立的 utilityProcess 子进程，主进程只转发音频、不做推理
let asrChild: UtilityProcess | null = null;
let asrReady: Promise<void> | null = null;

// 渲染层的行 id：主进程单调递增，跨 ASR 子进程重启不归零。
// 子进程内部的段序号随进程生命周期从 0 计，直接透传会与既有行冲突、译文回填错行。
let nextLineId = 0;

// 翻译跑在独立的 utilityProcess 子进程：隔离原生崩溃与超大内存分配（如 NLLB 反量化
// 在主进程会被 Chromium 分配器 abort），翻译进程挂掉也不连累主窗口，仅丢一次翻译
let translateChild: UtilityProcess | null = null;

// 应用图标：仅开发时手动设置（dev 下 Dock 默认显示 Electron 图标）；
// 打包后图标由 electron-builder 写入 .app，无需也无法从 asar 取此路径。
// 图标源已唯一化到仓库根 assets/icon.png（见 scripts/gen-icon.mjs）；
// getAppPath() 在 dev 下为 apps/macos，故上溯两级到仓库根取共享 PNG。
const APP_ICON = path.join(app.getAppPath(), '..', '..', 'assets', 'icon.png');

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'Realtime Translator',
    ...(app.isPackaged ? {} : { icon: APP_ICON }),
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

// 翻译子进程的在途请求：行 id → Promise 句柄。子进程的 result/error 消息按 id 关联回
// Promise，把消息协议封装成 async 引擎调用供 core 编排使用；子进程退出时全部 reject 防悬挂。
const pendingTranslations = new Map<
  number,
  { resolve: (text: string) => void; reject: (e: Error) => void }
>();

function rejectAllTranslations(reason: string): void {
  for (const p of pendingTranslations.values()) {
    p.reject(new Error(reason));
  }
  pendingTranslations.clear();
}

/** 经消息协议调用翻译子进程，返回按 id 关联的结果 Promise */
function requestTranslate(req: SegmentTranslateRequest): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingTranslations.set(req.id, { resolve, reject });
    ensureTranslateChild().postMessage({
      type: 'translate',
      id: req.id,
      text: req.text,
      source: req.source,
      target: req.targetLang,
    });
  });
}

/** 启动翻译子进程并按当前设置初始化 */
function startTranslateChild(): UtilityProcess {
  const child = utilityProcess.fork(translateWorkerPath);
  translateChild = child;
  child.on('message', (m: TranslateToMain) => {
    if (m.type === 'status') {
      sendToRenderer('translation:status', m.payload);
    } else if (m.type === 'result') {
      pendingTranslations.get(m.id)?.resolve(m.text);
      pendingTranslations.delete(m.id);
    } else if (m.type === 'error') {
      pendingTranslations.get(m.id)?.reject(new Error(m.message));
      pendingTranslations.delete(m.id);
    }
  });
  child.on('exit', (code) => {
    translateChild = null;
    // 在途请求全部按失败结束（core 编排会据此结束对应行的等待动画）
    rejectAllTranslations(`翻译进程退出 (${code})`);
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

/** 对一条定稿段做翻译（fire-and-forget），失败不影响转写。目标恒为母语。
 *  编排（是否翻 / pending / 字形归一化 / 错误上报）统一在 @rt/core.translateFinalizedSegment，
 *  与 web/iOS 一致；这里注入的引擎是翻译子进程消息协议的 Promise 封装。 */
function translateSegment(segment: SegmentPayload): void {
  const settings = loadSettings();
  void translateFinalizedSegment({
    spec: M2M100_SPEC,
    segment,
    enabled: settings.translation.enabled,
    nativeLang: settings.nativeLang,
    translate: requestTranslate,
    emitTranslation: (p) => sendToRenderer('pipeline:translation', p),
    emitStatus: (s) => sendToRenderer('translation:status', s),
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
        case 'segment': {
          // 行 id 改写为主进程计数器的值：UI 上屏与译文回填都以它对应
          const payload: SegmentPayload = { ...m.payload, id: nextLineId++ };
          sendToRenderer('pipeline:segment', payload); // 原文立即上屏
          translateSegment(payload); // 译文异步回填
          break;
        }
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
  // 子进程跨会话复用：每次开始录音都重置计时基线，segment.start 相对本次会话起点
  asrChild?.postMessage({ type: 'reset' });
  sendToRenderer('pipeline:status', { state: 'running' });
  return { ok: true };
});

// 麦克风权限：渲染层在请求权限前先查状态，自行决定是否弹说明弹窗
ipcMain.handle('mic:get-status', (): MicPermission =>
  process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted'
);

ipcMain.on('mic:open-settings', () => {
  if (process.platform === 'darwin') {
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    );
  }
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

  // 主页已无翻译开关，开启改由保存触发：翻译刚从关变开也要预热（引擎未变时也是）。
  const enabledTurnedOn = !prev.enabled && cur.enabled;

  const saved = saveSettings(next);
  if (engineChanged) {
    reconfigureTranslate();
  }
  if (saved.translation.enabled && (engineChanged || enabledTurnedOn)) {
    ensureTranslateChild().postMessage({ type: 'preheat' });
  }
  return saved;
});

// 云端配置连通性测试：主进程用 Node fetch 打一次最小翻译请求（无浏览器 CORS 限制，与实际云翻译
// 同环境）。供设置页「测试连接」，与 Web/iOS 的 testCloud 行为一致。source≠target 避免被短路。
ipcMain.handle(
  'translation:test-cloud',
  async (_event, cfg: CloudTranslationConfig): Promise<{ ok: boolean; error?: string }> => {
    try {
      await new CloudTranslator(cfg).translate('hello', { source: 'en', target: 'ja' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle('pipeline:stop', () => {
  asrChild?.postMessage({ type: 'flush' });
  sendToRenderer('pipeline:status', { state: 'stopped' });
  return { ok: true };
});

app.whenReady().then(() => {
  // macOS dev：Dock 默认显示 Electron 图标，手动替换；打包后用 .app 内置图标
  if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  asrChild?.kill();
  translateChild?.kill();
  app.quit();
});
