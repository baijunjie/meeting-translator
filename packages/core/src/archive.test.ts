// 归档纯逻辑的单元测试：摘要生成、列表排序、id 生成。
import { describe, expect, it } from 'vitest';
import { listSummaries, makeArchiveId, toSummary } from './archive';
import type { ArchiveRecord } from './types';

function record(id: string, createdAt: number, texts: string[]): ArchiveRecord {
  return {
    id,
    name: `记录${id}`,
    createdAt,
    lines: texts.map((text, i) => ({ time: `00:00:0${i}`, text, translation: '' })),
  };
}

describe('toSummary', () => {
  it('lastLine 取最后一条原文', () => {
    const s = toSummary(record('a', 1, ['第一句', '第二句']));
    expect(s).toEqual({ id: 'a', name: '记录a', createdAt: 1, lastLine: '第二句' });
  });

  it('空对话的 lastLine 为空串', () => {
    expect(toSummary(record('a', 1, [])).lastLine).toBe('');
  });
});

describe('listSummaries', () => {
  it('按创建时间倒序（最新在前），并转为摘要', () => {
    const out = listSummaries([
      record('old', 100, ['旧']),
      record('new', 300, ['新']),
      record('mid', 200, ['中']),
    ]);
    expect(out.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
    expect(out[0].lastLine).toBe('新');
  });

  it('不改变入参数组的顺序', () => {
    const records = [record('a', 1, []), record('b', 2, [])];
    listSummaries(records);
    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('makeArchiveId', () => {
  it('以 a 开头并包含创建时间的 36 进制', () => {
    const createdAt = 1719800000000;
    const id = makeArchiveId(createdAt);
    expect(id.startsWith(`a${createdAt.toString(36)}`)).toBe(true);
  });

  it('同一时刻多次生成不重复', () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeArchiveId(42)));
    expect(ids.size).toBe(100);
  });
});
