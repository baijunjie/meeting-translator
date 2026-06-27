// 注意：本文件与 i18n.js 都是经典脚本，共享全局作用域。
// i18n.js 提供：LANG_NAMES / I18N / t() / applyI18n() / setLocale() / currentLocale

// --- 元素引用 ---
const statusEl = document.getElementById('status') as HTMLElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const translateToggle = document.getElementById('translate-toggle') as HTMLInputElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const transcriptEl = document.getElementById('transcript') as HTMLElement;
const emptyHintEl = document.getElementById('empty-hint') as HTMLElement;

const langChoicesEl = document.getElementById('lang-choices') as HTMLElement;

const settingsBackEl = document.getElementById('settings-back') as HTMLButtonElement;
const settingsSaveEl = document.getElementById('settings-save') as HTMLButtonElement;
const nativeLangEl = document.getElementById('native-lang') as HTMLSelectElement;
const fontSizeEl = document.getElementById('font-size') as HTMLSelectElement;
const engineSelectEl = document.getElementById('engine-select') as HTMLSelectElement;
const cloudFieldsEl = document.getElementById('cloud-fields') as HTMLElement;
const cloudBaseUrlEl = document.getElementById('cloud-baseurl') as HTMLInputElement;
const cloudApiKeyEl = document.getElementById('cloud-apikey') as HTMLInputElement;
const cloudModelEl = document.getElementById('cloud-model') as HTMLInputElement;

const FONT_PX: Record<FontSize, string> = { small: '13px', medium: '15px', large: '18px' };
const LANGS: UiLang[] = ['zh', 'ja', 'en', 'ko'];

let recording = false;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;

let partialEl: HTMLDivElement | null = null;
const segmentBodies = new Map<number, HTMLElement>();
// 当前状态栏用的 i18n key（切换语言时据此重渲染）；含动态内容时置空
let statusKey = 'status.ready';

// --- 屏幕导航 ---
function showScreen(id: 'onboarding' | 'main-screen' | 'settings-screen'): void {
  for (const el of document.querySelectorAll<HTMLElement>('.screen')) {
    el.classList.toggle('hidden', el.id !== id);
  }
}

// --- 语言 / 字体 ---
function applyLocale(lang: UiLang): void {
  setLocale(lang); // i18n.js：更新所有 data-i18n 元素
  refreshDynamicText();
}

function refreshDynamicText(): void {
  toggleBtn.textContent = t(recording ? 'main.stop' : 'main.start');
  if (statusKey) {
    statusEl.textContent = t(statusKey);
  }
}

function setStatus(key: string): void {
  statusKey = key;
  statusEl.textContent = t(key);
  statusEl.classList.toggle('recording', key === 'status.recording');
}

/** 状态栏显示带动态内容的文本（切换语言时不再覆盖） */
function setStatusRaw(text: string): void {
  statusKey = '';
  statusEl.textContent = text;
  statusEl.classList.remove('recording');
}

function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty('--transcript-size', FONT_PX[size]);
}

// --- 转写 / 译文渲染 ---
function scrollToBottom(): void {
  const panel = transcriptEl.parentElement;
  if (panel) {
    panel.scrollTop = panel.scrollHeight;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function removePartial(): void {
  if (partialEl) {
    partialEl.remove();
    partialEl = null;
  }
}

function updatePartial({ text }: PartialPayload): void {
  if (!text) {
    removePartial();
    return;
  }
  emptyHintEl.style.display = 'none';
  if (!partialEl) {
    partialEl = document.createElement('div');
    partialEl.className = 'segment partial';
    const textEl = document.createElement('div');
    textEl.className = 'segment-text';
    partialEl.appendChild(textEl);
    transcriptEl.appendChild(partialEl);
  }
  (partialEl.querySelector('.segment-text') as HTMLElement).textContent = text;
  scrollToBottom();
}

function appendSegment(segment: SegmentPayload): void {
  emptyHintEl.style.display = 'none';
  removePartial();

  const row = document.createElement('div');
  row.className = 'segment';

  const time = document.createElement('div');
  time.className = 'segment-time';
  time.textContent = formatTime(segment.start);

  const body = document.createElement('div');
  body.className = 'segment-body';

  const text = document.createElement('div');
  text.className = 'segment-text';
  text.textContent = segment.text;

  body.appendChild(text);
  row.append(time, body);
  transcriptEl.appendChild(row);
  segmentBodies.set(segment.id, body);
  scrollToBottom();
}

function applyTranslation({ id, text }: TranslationPayload): void {
  const body = segmentBodies.get(id);
  if (!body || !text) {
    return;
  }
  let tr = body.querySelector('.segment-translation') as HTMLElement | null;
  if (!tr) {
    tr = document.createElement('div');
    tr.className = 'segment-translation';
    body.appendChild(tr);
  }
  tr.textContent = text;
  scrollToBottom();
}

// --- 录音 ---
async function startRecording(): Promise<void> {
  toggleBtn.disabled = true;
  setStatus('status.loadingModel');

  const result = await window.api.startPipeline();
  if (!result.ok) {
    setStatusRaw(result.error ?? t('status.errorPrefix'));
    toggleBtn.disabled = false;
    return;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  audioContext = new AudioContext({ sampleRate: 16000 });
  await audioContext.audioWorklet.addModule('audio-worklet.js');
  const source = audioContext.createMediaStreamSource(mediaStream);
  const capture = new AudioWorkletNode(audioContext, 'capture-processor');
  capture.port.onmessage = (e: MessageEvent<Float32Array>) => window.api.sendAudio(e.data);
  source.connect(capture);

  recording = true;
  toggleBtn.disabled = false;
  toggleBtn.textContent = t('main.stop');
  toggleBtn.classList.add('recording');
  setStatus('status.recording');
}

async function stopRecording(): Promise<void> {
  recording = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach((tr) => tr.stop());
    mediaStream = null;
  }
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
  await window.api.stopPipeline();
  removePartial();

  toggleBtn.textContent = t('main.start');
  toggleBtn.classList.remove('recording');
  setStatus('status.stopped');
}

// --- 设置页 ---
function syncCloudFieldsVisibility(): void {
  cloudFieldsEl.style.display = engineSelectEl.value === 'cloud' ? 'block' : 'none';
}

function fillSettingsForm(s: AppSettings): void {
  nativeLangEl.value = s.nativeLang;
  fontSizeEl.value = s.fontSize;
  engineSelectEl.value = s.translation.engine;
  cloudBaseUrlEl.value = s.translation.cloud.baseURL;
  cloudApiKeyEl.value = s.translation.cloud.apiKey;
  cloudModelEl.value = s.translation.cloud.model;
  syncCloudFieldsVisibility();
}

async function openSettings(): Promise<void> {
  fillSettingsForm(await window.api.getSettings());
  showScreen('settings-screen');
}

/** 放弃未保存的实时预览，恢复成已保存的语言/字体 */
async function cancelSettings(): Promise<void> {
  const s = await window.api.getSettings();
  applyLocale(s.nativeLang);
  applyFontSize(s.fontSize);
  showScreen('main-screen');
}

async function saveSettingsPage(): Promise<void> {
  const s = await window.api.getSettings(); // 保留 onboarded / translation.enabled
  s.nativeLang = nativeLangEl.value as UiLang;
  s.fontSize = fontSizeEl.value as FontSize;
  s.translation.engine = engineSelectEl.value === 'cloud' ? 'cloud' : 'local';
  s.translation.cloud = {
    baseURL: cloudBaseUrlEl.value.trim(),
    apiKey: cloudApiKeyEl.value.trim(),
    model: cloudModelEl.value.trim(),
  };
  await window.api.saveSettings(s);
  applyLocale(s.nativeLang);
  applyFontSize(s.fontSize);
  showScreen('main-screen');
}

// --- 首次引导 ---
function buildLangChoices(onPick: (lang: UiLang) => void): void {
  langChoicesEl.innerHTML = '';
  for (const lang of LANGS) {
    const btn = document.createElement('button');
    btn.className = 'lang-choice';
    btn.textContent = LANG_NAMES[lang];
    btn.addEventListener('click', () => onPick(lang));
    langChoicesEl.appendChild(btn);
  }
}

async function completeOnboarding(lang: UiLang): Promise<void> {
  const s = await window.api.getSettings();
  s.nativeLang = lang;
  s.onboarded = true;
  await window.api.saveSettings(s);
  applyLocale(lang);
  showScreen('main-screen');
}

// --- 事件绑定 ---
toggleBtn.addEventListener('click', () => (recording ? stopRecording() : startRecording()));
translateToggle.addEventListener('change', () =>
  window.api.setTranslateEnabled(translateToggle.checked)
);
settingsBtn.addEventListener('click', openSettings);
settingsBackEl.addEventListener('click', cancelSettings);
settingsSaveEl.addEventListener('click', saveSettingsPage);
engineSelectEl.addEventListener('change', syncCloudFieldsVisibility);
// 设置页里改母语/字体即时预览
nativeLangEl.addEventListener('change', () => applyLocale(nativeLangEl.value as UiLang));
fontSizeEl.addEventListener('change', () => applyFontSize(fontSizeEl.value as FontSize));

window.api.onSegment(appendSegment);
window.api.onPartial(updatePartial);
window.api.onTranslation(applyTranslation);
window.api.onStatus((s) => {
  if (s.state === 'loading') {
    setStatus('status.loadingModel');
  } else if (s.state === 'error') {
    setStatusRaw(t('status.errorPrefix') + s.error);
    if (recording) {
      stopRecording();
    }
  }
});
window.api.onTranslationStatus((s) => {
  if (s.state === 'loading') {
    const pct = typeof s.progress === 'number' ? ` ${Math.round(s.progress * 100)}%` : '';
    setStatusRaw(t('status.transLoading') + pct);
  } else if (s.state === 'error') {
    setStatusRaw(t('status.transFailed'));
  } else if (s.state === 'ready' && recording) {
    setStatus('status.recording');
  }
});

// --- 启动 ---
(async function init(): Promise<void> {
  // 母语下拉项（自称名，不随界面语言变）
  for (const lang of LANGS) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = LANG_NAMES[lang];
    nativeLangEl.appendChild(opt);
  }

  const s = await window.api.getSettings();
  applyLocale(s.nativeLang);
  applyFontSize(s.fontSize);
  translateToggle.checked = s.translation.enabled;

  if (!s.onboarded) {
    buildLangChoices(completeOnboarding);
    applyLocale(s.nativeLang); // 引导页也用猜测的语言呈现
    showScreen('onboarding');
  } else {
    showScreen('main-screen');
  }
})();
