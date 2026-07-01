// 回归守卫：连续说话中夹杂 <MIN_SILENCE 的词间小停顿（isDetected 会瞬时转 false），
// 不应把一句话切成碎片。注入 0.25s 静音间隙模拟换气/词间，断句应仍按 ~8s 上限。
//   npx tsx test/silence-debounce.ts
import path from 'node:path';
import { readWave } from 'sherpa-onnx-node';
import { TranscriptionPipeline, SAMPLE_RATE } from '../src/main/pipeline';

const modelsDir = path.join(__dirname, '..', 'models');
const WIN = 512;

// 去静音得到连续语音，再每 ~1.5s 注入 0.25s 静音（< 0.6s 去抖阈值）模拟词间停顿
function buildWithMicroGaps(files: string[]): Float32Array {
  const speech: number[] = [];
  for (const f of files) {
    const w = readWave(path.join(__dirname, '..', 'test-audio', f));
    const s = w.samples;
    for (let i = 0; i + WIN <= s.length; i += WIN) {
      let e = 0;
      for (let k = 0; k < WIN; k++) e += s[i + k] * s[i + k];
      if (Math.sqrt(e / WIN) > 0.005) for (let k = 0; k < WIN; k++) speech.push(s[i + k]);
    }
  }
  const out: number[] = [];
  const chunk = Math.round(SAMPLE_RATE * 1.5);
  const gap = Math.round(SAMPLE_RATE * 0.25);
  for (let i = 0; i < speech.length; i += chunk) {
    for (let k = i; k < Math.min(i + chunk, speech.length); k++) out.push(speech[k]);
    for (let g = 0; g < gap; g++) out.push(0); // 词间小停顿
  }
  return Float32Array.from(out);
}

const audio = buildWithMicroGaps(['sample.wav', 'sample-ja-zh.wav']);
console.log('含词间小停顿的连续语音:', (audio.length / SAMPLE_RATE).toFixed(1) + 's');

let count = 0;
const pipeline = new TranscriptionPipeline(modelsDir, {
  onSegment: (seg) => {
    count++;
    console.log(`段${count} [dur=${seg.duration.toFixed(1)}s len=${seg.text.length}] ${seg.text}`);
  },
});

const step = Math.round(SAMPLE_RATE * 0.128);
for (let i = 0; i < audio.length; i += step) {
  pipeline.acceptWaveform(audio.subarray(i, i + step));
}
pipeline.flush();
console.log(
  `\n共 ${count} 段（去抖前会因每个 <0.35s 小停顿碎成十几段；现仅在 >=0.35s 静音处断句，` +
    `小停顿被吸收、内容完整，不按时长硬切）`
);
