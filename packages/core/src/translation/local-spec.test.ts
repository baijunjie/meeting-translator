// planTranslation / normalizeZh 的单元测试：三端共用的「要不要翻、怎么翻」判定矩阵。
import { describe, expect, it } from 'vitest';
import { M2M100_SPEC, normalizeZh, planTranslation } from './local-spec';

describe('normalizeZh 简繁转换', () => {
  it('简体 → 繁體', () => {
    expect(normalizeZh('发现问题', 'traditional')).toBe('發現問題');
  });

  it('繁體 → 简体', () => {
    expect(normalizeZh('發現問題', 'simplified')).toBe('发现问题');
  });
});

describe('planTranslation 判定矩阵（M2M100）', () => {
  const plan = (source: string, native: string, text: string) =>
    planTranslation(M2M100_SPEC, source, native, text);

  it('同语言同字形：skip（zh→zh / en→en / ja→ja / ko→ko）', () => {
    expect(plan('zh', 'zh', '你好')).toEqual({ kind: 'skip' });
    expect(plan('en', 'en', 'hello')).toEqual({ kind: 'skip' });
    expect(plan('ja', 'ja', 'こんにちは')).toEqual({ kind: 'skip' });
    expect(plan('ko', 'ko', '안녕하세요')).toEqual({ kind: 'skip' });
  });

  it('同语言仅字形不同：script，直接产出目标字形、不经模型', () => {
    const p = plan('zh', 'zh-Hant', '发现问题');
    expect(p).toEqual({ kind: 'script', text: '發現問題' });
  });

  it('源已是目标字形：等价于 skip', () => {
    expect(plan('zh', 'zh-Hant', '謝謝')).toEqual({ kind: 'skip' });
    expect(plan('zh', 'zh', '谢谢')).toEqual({ kind: 'skip' });
  });

  it('不同语言：translate，携带模型码与母语键', () => {
    const p = plan('ja', 'zh', 'こんにちは');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe('zh');
      expect(p.targetLang).toBe('zh');
      // 简体母语的字形归一化
      expect(p.toScript?.('發現')).toBe('发现');
    }
  });

  it('繁体母语：translate 的 toScript 产出繁体', () => {
    const p = plan('en', 'zh-Hant', 'hello');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe('zh');
      expect(p.targetLang).toBe('zh-Hant');
      expect(p.toScript?.('发现')).toBe('發現');
    }
  });

  it('无字形后处理的母语（ja/en/ko）：translate 不带 toScript', () => {
    const p = plan('zh', 'ja', '你好');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe('ja');
      expect(p.toScript).toBeUndefined();
    }
  });

  it('yue 与 zh 是不同语言：即便共用模型码 zh 也必须 translate、不得 skip', () => {
    const p = plan('yue', 'zh', '早晨');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe('zh');
    }
    expect(plan('yue', 'zh-Hant', '早晨').kind).toBe('translate');
  });

  it('yue → 非中文母语：普通 translate', () => {
    const p = plan('yue', 'en', '早晨');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe('en');
    }
  });

  it('未知源语言：按不同语言处理（translate）', () => {
    expect(plan('fr', 'zh', 'bonjour').kind).toBe('translate');
  });

  it('spec 未收录的目标语言：targetCode 回退 fallbackLang', () => {
    const p = plan('ja', 'xx', 'こんにちは');
    expect(p.kind).toBe('translate');
    if (p.kind === 'translate') {
      expect(p.targetCode).toBe(M2M100_SPEC.fallbackLang);
    }
  });
});
