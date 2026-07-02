// settings 纯逻辑的单元测试：默认值的母语推断、字段补齐与旧版本 JSON 兼容。
import { describe, expect, it } from 'vitest';
import { makeDefaults, withDefaults } from './settings';

describe('makeDefaults 母语推断', () => {
  it('繁体地区/脚本（TW/HK/MO/Hant）推断为 zh-Hant', () => {
    expect(makeDefaults(['zh-TW']).nativeLang).toBe('zh-Hant');
    expect(makeDefaults(['zh-HK']).nativeLang).toBe('zh-Hant');
    expect(makeDefaults(['zh-MO']).nativeLang).toBe('zh-Hant');
    expect(makeDefaults(['zh-Hant-TW']).nativeLang).toBe('zh-Hant');
  });

  it('其余中文推断为简体 zh', () => {
    expect(makeDefaults(['zh-CN']).nativeLang).toBe('zh');
    expect(makeDefaults(['zh']).nativeLang).toBe('zh');
  });

  it('ja / ko / en 按前缀命中', () => {
    expect(makeDefaults(['ja-JP']).nativeLang).toBe('ja');
    expect(makeDefaults(['ko-KR']).nativeLang).toBe('ko');
    expect(makeDefaults(['en-US']).nativeLang).toBe('en');
  });

  it('首个可识别语言优先', () => {
    expect(makeDefaults(['fr-FR', 'ja-JP', 'zh-CN']).nativeLang).toBe('ja');
  });

  it('未知语言或空列表回退英语', () => {
    expect(makeDefaults(['fr-FR']).nativeLang).toBe('en');
    expect(makeDefaults([]).nativeLang).toBe('en');
  });

  it('默认关闭翻译、引擎为本地 m2m100、云端三项留空', () => {
    const d = makeDefaults([]);
    expect(d.onboarded).toBe(false);
    expect(d.fontSize).toBe('medium');
    expect(d.theme).toBe('system');
    expect(d.translation.enabled).toBe(false);
    expect(d.translation.engine).toBe('m2m100');
    expect(d.translation.cloud).toEqual({ baseURL: '', apiKey: '', model: '' });
  });
});

describe('withDefaults 字段补齐与校验', () => {
  const d = makeDefaults(['en-US']);

  it('空对象/null 全部落默认', () => {
    expect(withDefaults(null, d)).toEqual(d);
    expect(withDefaults({}, d)).toEqual(d);
  });

  it('非法 nativeLang / fontSize / theme 回退默认', () => {
    const s = withDefaults(
      { nativeLang: 'fr', fontSize: 'huge', theme: 'blue' },
      d,
    );
    expect(s.nativeLang).toBe(d.nativeLang);
    expect(s.fontSize).toBe('medium');
    expect(s.theme).toBe('system');
  });

  it('合法字段原样保留', () => {
    const s = withDefaults(
      {
        onboarded: true,
        nativeLang: 'zh-Hant',
        fontSize: 'large',
        theme: 'dark',
        translation: {
          enabled: true,
          engine: 'cloud',
          cloud: { baseURL: 'https://api.example.com/v1', apiKey: 'k', model: 'm' },
        },
      },
      d,
    );
    expect(s.onboarded).toBe(true);
    expect(s.nativeLang).toBe('zh-Hant');
    expect(s.fontSize).toBe('large');
    expect(s.theme).toBe('dark');
    expect(s.translation).toEqual({
      enabled: true,
      engine: 'cloud',
      cloud: { baseURL: 'https://api.example.com/v1', apiKey: 'k', model: 'm' },
    });
  });

  it('cloud 字段缺省补齐为空串', () => {
    const s = withDefaults({ translation: { engine: 'cloud' } }, d);
    expect(s.translation.cloud).toEqual({ baseURL: '', apiKey: '', model: '' });
  });

  it('已移除的本地引擎值（local / nllb）迁移到 m2m100', () => {
    expect(withDefaults({ translation: { engine: 'local' } }, d).translation.engine).toBe('m2m100');
    expect(withDefaults({ translation: { engine: 'nllb' } }, d).translation.engine).toBe('m2m100');
    expect(withDefaults({ translation: { engine: 'cloud' } }, d).translation.engine).toBe('cloud');
  });

  describe('旧版 translation.targetLang 迁移', () => {
    it('targetLang 为语言码：当母语初值，且视为开启翻译', () => {
      const s = withDefaults({ translation: { targetLang: 'ja' } }, d);
      expect(s.nativeLang).toBe('ja');
      expect(s.translation.enabled).toBe(true);
    });

    it("targetLang 为 'off'：翻译关闭，母语落默认", () => {
      const s = withDefaults({ translation: { targetLang: 'off' } }, d);
      expect(s.nativeLang).toBe(d.nativeLang);
      expect(s.translation.enabled).toBe(false);
    });

    it('显式 enabled 优先于 targetLang 推断', () => {
      const s = withDefaults(
        { translation: { enabled: false, targetLang: 'ja' } },
        d,
      );
      expect(s.translation.enabled).toBe(false);
    });

    it('新字段 nativeLang 优先于旧 targetLang', () => {
      const s = withDefaults(
        { nativeLang: 'ko', translation: { targetLang: 'ja' } },
        d,
      );
      expect(s.nativeLang).toBe('ko');
    });
  });
});
