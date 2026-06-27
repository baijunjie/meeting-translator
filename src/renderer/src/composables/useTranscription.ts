import { reactive, ref } from 'vue';

export interface TranscriptLine {
  id: number;
  time: string;
  text: string;
  translation: string;
}

export const lines = reactive<TranscriptLine[]>([]);
export const partial = ref('');
export const recording = ref(false);

// 软件未就绪：加载 ASR 模型中（录音管线就绪前）
export const modelLoading = ref(false);
// 录音/管线错误（原始文案）
export const errorText = ref('');

// 翻译模型状态（独立，顶部进度条 / 开关旁错误提示）
export const translationLoading = ref(false);
export const translationProgress = ref(0); // 0~100
export const translationError = ref(false);

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
      modelLoading.value = true;
    } else if (s.state === 'running') {
      modelLoading.value = false;
      errorText.value = '';
    } else if (s.state === 'error') {
      modelLoading.value = false;
      errorText.value = s.error ?? 'Error';
      if (recording.value) void stopRecording();
    } else if (s.state === 'stopped') {
      modelLoading.value = false;
    }
  });
  window.api.onTranslationStatus((s) => {
    if (s.state === 'loading') {
      translationLoading.value = true;
      translationError.value = false;
      if (typeof s.progress === 'number') {
        translationProgress.value = Math.round(s.progress * 100);
      }
    } else if (s.state === 'error') {
      translationLoading.value = false;
      translationError.value = true;
    } else if (s.state === 'ready') {
      translationLoading.value = false;
      translationError.value = false;
    }
  });
}
register();

export async function startRecording(): Promise<void> {
  errorText.value = '';
  const result = await window.api.startPipeline();
  if (!result.ok) {
    errorText.value = result.error ?? 'Error';
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
