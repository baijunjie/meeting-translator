import { reactive, ref } from 'vue';
import { i18n } from '../i18n';

const t = i18n.global.t;

export interface TranscriptLine {
  id: number;
  time: string;
  text: string;
  translation: string;
}

export const lines = reactive<TranscriptLine[]>([]);
export const partial = ref('');
export const recording = ref(false);

// 状态栏：keyed 状态随界面语言切换，dynamic 文本（进度/错误）直接显示
export const statusKey = ref('status.ready');
export const statusText = ref('');

function setStatusKey(key: string): void {
  statusKey.value = key;
  statusText.value = '';
}
function setStatusText(text: string): void {
  statusText.value = text;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;

// IPC 监听只注册一次（preload 的 on* 无法反注册，避免重复累积）
let registered = false;
function register(): void {
  if (registered) return;
  registered = true;

  window.api.onSegment((seg) => {
    lines.push({ id: seg.id, time: fmtTime(seg.start), text: seg.text, translation: '' });
    partial.value = '';
  });
  window.api.onPartial((p) => {
    partial.value = p.text;
  });
  window.api.onTranslation((tr) => {
    const line = lines.find((l) => l.id === tr.id);
    if (line) line.translation = tr.text;
  });
  window.api.onStatus((s) => {
    if (s.state === 'loading') {
      setStatusKey('status.loadingModel');
    } else if (s.state === 'error') {
      setStatusText(t('status.errorPrefix') + s.error);
      if (recording.value) void stopRecording();
    }
  });
  window.api.onTranslationStatus((s) => {
    if (s.state === 'loading') {
      const pct = typeof s.progress === 'number' ? ` ${Math.round(s.progress * 100)}%` : '';
      setStatusText(t('status.transLoading') + pct);
    } else if (s.state === 'error') {
      setStatusText(t('status.transFailed'));
    } else if (s.state === 'ready' && recording.value) {
      setStatusKey('status.recording');
    }
  });
}
register();

export async function startRecording(): Promise<void> {
  setStatusKey('status.loadingModel');
  const result = await window.api.startPipeline();
  if (!result.ok) {
    setStatusText(result.error ?? t('status.errorPrefix'));
    return;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  audioContext = new AudioContext({ sampleRate: 16000 });
  await audioContext.audioWorklet.addModule('audio-worklet.js');
  const source = audioContext.createMediaStreamSource(mediaStream);
  const capture = new AudioWorkletNode(audioContext, 'capture-processor');
  capture.port.onmessage = (e: MessageEvent<Float32Array>) => window.api.sendAudio(e.data);
  source.connect(capture);

  recording.value = true;
  setStatusKey('status.recording');
}

export async function stopRecording(): Promise<void> {
  recording.value = false;
  if (mediaStream) {
    mediaStream.getTracks().forEach((tr) => tr.stop());
    mediaStream = null;
  }
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }
  await window.api.stopPipeline();
  partial.value = '';
  setStatusKey('status.stopped');
}

export function toggleRecording(): void {
  if (recording.value) {
    void stopRecording();
  } else {
    void startRecording();
  }
}

/** 清空转写历史 */
export function clearTranscript(): void {
  lines.splice(0, lines.length);
  partial.value = '';
}
