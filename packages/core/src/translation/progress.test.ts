import { describe, it, expect } from 'vitest';
import { createTranslateProgressAggregator } from './progress';

describe('createTranslateProgressAggregator', () => {
  it('多文件并行下载按字节聚合，总进度不在文件的各自百分比间跳动', () => {
    const agg = createTranslateProgressAggregator();

    // encoder 先到 50%（100/200）
    const a = agg({ status: 'progress', file: 'encoder.onnx', loaded: 100, total: 200 });
    expect(a?.progress).toBeCloseTo(0.5);

    // decoder（更大，800）加入且只有 10%：总进度按字节应为 (100+80)/(200+800)=0.18，
    // 而不是跳回 decoder 自己的 0.1
    const b = agg({ status: 'progress', file: 'decoder.onnx', loaded: 80, total: 800 });
    expect(b?.progress).toBeCloseTo(0.18);
    expect(b?.files).toHaveLength(2);
    expect(b?.files[0]).toMatchObject({ file: 'encoder.onnx', progress: 0.5 });
    expect(b?.files[1].progress).toBeCloseTo(0.1);
  });

  it('done 事件把已知文件封顶为完成；未知文件的 done 不产生状态', () => {
    const agg = createTranslateProgressAggregator();
    agg({ status: 'progress', file: 'a.onnx', loaded: 10, total: 100 });

    const done = agg({ status: 'done', file: 'a.onnx' });
    expect(done?.progress).toBeCloseTo(1);
    expect(done?.files[0]).toMatchObject({ loaded: 100, total: 100, progress: 1 });

    // 缓存命中的文件可能只发 done、从未报过字节：忽略，不挤进列表
    expect(agg({ status: 'done', file: 'cached.json' })).toBeNull();
  });

  it('无文件名或无字节信息的事件不产生状态', () => {
    const agg = createTranslateProgressAggregator();
    expect(agg({ status: 'initiate', file: 'a.onnx' })).toBeNull();
    expect(agg({ status: 'ready' })).toBeNull();
    expect(agg({ status: 'progress', file: 'a.onnx', progress: 50 })).toBeNull();
  });

  it('loaded 超过 total 时封顶，进度不超过 100%', () => {
    const agg = createTranslateProgressAggregator();
    const r = agg({ status: 'progress', file: 'a.onnx', loaded: 150, total: 100 });
    expect(r?.progress).toBeCloseTo(1);
  });

  it('预置分母后新文件注册不再导致总进度回落（严格单调）', () => {
    const agg = createTranslateProgressAggregator(1000);

    // encoder 先到：分母用预置的 1000 而非仅 encoder 的 200
    const a = agg({ status: 'progress', file: 'encoder.onnx', loaded: 100, total: 200 });
    expect(a?.progress).toBeCloseTo(0.1);

    // decoder 注册：真实 total 之和(1000)未超过预置值，总进度只进不退
    const b = agg({ status: 'progress', file: 'decoder.onnx', loaded: 80, total: 800 });
    expect(b?.progress).toBeCloseTo(0.18);
    expect(b!.progress).toBeGreaterThanOrEqual(a!.progress);
  });

  it('真实 total 之和超过预置值时改用真实分母，进度仍封顶 100%', () => {
    const agg = createTranslateProgressAggregator(100);
    const r = agg({ status: 'progress', file: 'a.onnx', loaded: 300, total: 300 });
    expect(r?.progress).toBeCloseTo(1);
  });
});
