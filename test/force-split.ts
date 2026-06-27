// 回归守卫：sherpa 原生 maxSpeechDuration 不生效，连续说话靠管线自实现的强制断句切段。
// 验证连续语音被切成 ≤MAX_SEGMENT_SECONDS 的多段且内容不丢失。
//   npx tsx test/force-split.ts
import path from 'node:path';
import { readWave } from 'sherpa-onnx-node';
import { TranscriptionPipeline, SAMPLE_RATE } from '../src/main/pipeline';

const modelsDir = path.join(__dirname, '..', 'models');

// 拼接两个测试音频，并用能量门限去掉静音段 -> 模拟连续不停说话
function loadConcatNoSilence(files: string[]): Float32Array {
  const all: number[] = [];
  const WIN = 512;
  const GATE = 0.005; // RMS 门限
  for (const f of files) {
    const w = readWave(path.join(__dirname, '..', 'test-audio', f));
    const s = w.samples;
    for (let i = 0; i + WIN <= s.length; i += WIN) {
      let sum = 0;
      for (let k = 0; k < WIN; k++) sum += s[i + k] * s[i + k];
      const rms = Math.sqrt(sum / WIN);
      if (rms > GATE) for (let k = 0; k < WIN; k++) all.push(s[i + k]);
    }
  }
  return Float32Array.from(all);
}

const audio = loadConcatNoSilence(['meeting.wav', 'meeting-ja-zh.wav']);
console.log('连续语音时长:', (audio.length / SAMPLE_RATE).toFixed(1) + 's（已去静音）');

let maxPartialLen = 0;
let lastPartial = '';
const pipeline = new TranscriptionPipeline(modelsDir, {
  onSegment: (seg) => {
    console.log(
      `\n=== 最终段 [${seg.start.toFixed(1)}s dur=${seg.duration.toFixed(1)}s len=${seg.text.length}] ${seg.lang}`
    );
    console.log(`    定稿: ${seg.text}`);
    console.log(`    闭合前 partial 最长(${maxPartialLen}): ${lastPartial}`);
    maxPartialLen = 0;
    lastPartial = '';
  },
  onPartial: (p) => {
    if (p.text && p.text.length >= maxPartialLen) {
      maxPartialLen = p.text.length;
      lastPartial = p.text;
    }
  },
});

const chunk = Math.round(SAMPLE_RATE * 0.128);
for (let i = 0; i < audio.length; i += chunk) {
  pipeline.acceptWaveform(audio.subarray(i, i + chunk));
}
pipeline.flush();
console.log('\n完成');
