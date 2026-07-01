import { nextTick, reactive, ref } from 'vue';
import { fmtClock } from '../utils/datetime';
import { bridge } from '../bridge';

export interface TranscriptLine {
  id: number;
  time: string;
  text: string;
  translation: string;
  /** 译文进行中：已派发翻译、结果未到，UI 在译文区显示等待动画。同语言/未开启翻译时恒 false */
  translating: boolean;
}

export const lines = reactive<TranscriptLine[]>([]);
export const partial = ref('');
export const recording = ref(false);

// 软件未就绪：加载 ASR 模型中（录音管线就绪前）
export const modelLoading = ref(false);
// 录音/管线错误（原始文案）
export const errorText = ref('');

// 翻译模型状态（独立，显示在翻译开关旁，不影响录音）
export const translationLoading = ref(false);
export const translationDownloading = ref(false); // true=首次下载(有进度)，false=载入内存
export const translationProgress = ref(0); // 0~100
export const translationError = ref(false);

// 录音开始时的本地时刻（epoch ms），用于把片段的相对偏移换算成本地时钟时间
let recordStartEpoch = 0;

// 把片段相对录音起点的偏移（秒）换算成本地时钟时间 HH:MM:SS
function fmtTime(offsetSeconds: number): string {
  return fmtClock(recordStartEpoch + offsetSeconds * 1000);
}

// IPC 监听只注册一次（preload 的 on* 无法反注册，避免重复累积）。
// 由 mountApp 在 setBridge 之后调用 registerTranscriptionListeners()，
// 不再在模块导入时注册——此时 bridge 尚未注入。
let registered = false;
export function registerTranscriptionListeners(): void {
  if (registered) return;
  registered = true;

  bridge().onSegment((seg) => {
    lines.push({
      id: seg.id,
      time: fmtTime(seg.start),
      text: seg.text,
      translation: '',
      translating: false,
    });
    // 识别区里有实时识别文字时才做交接：把它定格成这条定稿文本、下一 tick 再清空，
    // 使向下淡出的正是落入确定句区的同一句（而非早期实时猜测）。识别区本就为空（无中间结果）则不动，停留「聆听中」。
    if (partial.value !== '') {
      partial.value = seg.text;
      void nextTick(() => {
        if (partial.value === seg.text) partial.value = '';
      });
    }
  });
  bridge().onPartial((p) => {
    partial.value = p.text;
  });
  bridge().onTranslation((tr) => {
    const line = lines.find((l) => l.id === tr.id);
    if (!line) return;
    if (tr.pending) {
      // 翻译已开始、结果未到：显示等待动画
      line.translating = true;
    } else {
      // 最终结果（空串表示无需翻译，仅结束等待、不展示）
      line.translation = tr.text;
      line.translating = false;
    }
  });
  bridge().onStatus((s) => {
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
  bridge().onTranslationStatus((s) => {
    if (s.state === 'loading') {
      translationLoading.value = true;
      translationError.value = false;
      // 有进度=正在下载文件；无进度=从缓存载入内存
      if (typeof s.progress === 'number') {
        translationDownloading.value = true;
        translationProgress.value = Math.round(s.progress * 100);
      }
    } else if (s.state === 'error') {
      translationLoading.value = false;
      translationDownloading.value = false;
      translationError.value = true;
      // 翻译失败（含子进程崩溃）：结束所有仍在等待的译文动画，避免永久转圈
      for (const l of lines) l.translating = false;
    } else if (s.state === 'ready') {
      translationLoading.value = false;
      translationDownloading.value = false;
    }
  });
}

export async function startRecording(): Promise<void> {
  errorText.value = '';
  recordStartEpoch = Date.now();
  // 桥接内部负责音频采集（macOS 渲染层用 AudioWorklet，iOS 原生采麦），UI 不感知平台细节。
  const result = await bridge().startPipeline();
  if (!result.ok) {
    errorText.value = result.error ?? 'Error';
    return;
  }
  recording.value = true;
}

export async function stopRecording(): Promise<void> {
  recording.value = false;
  await bridge().stopPipeline();
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
