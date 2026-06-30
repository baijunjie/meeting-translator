// 对话归档的纯逻辑：摘要生成、id 生成、列表排序。
// 不依赖任何平台 API——持久化（fs 等）留在各端实现。
import type { ArchiveRecord, ArchiveSummary } from './types';

/** 由完整记录生成列表摘要（不含对话内容） */
export function toSummary(r: ArchiveRecord): ArchiveSummary {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    lastLine: r.lines.length > 0 ? r.lines[r.lines.length - 1].text : '',
  };
}

/** 生成归档记录 id（基于创建时间 + 随机串） */
export function makeArchiveId(createdAt: number): string {
  return `a${createdAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 列表按时间倒序（最新在前）并转为摘要 */
export function listSummaries(records: ArchiveRecord[]): ArchiveSummary[] {
  return [...records].sort((a, b) => b.createdAt - a.createdAt).map(toSummary);
}
