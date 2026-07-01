// 对话归档的本地持久化：存到 electron userData/archives.json。
// 纯逻辑（摘要 / id 生成 / 排序）已下沉到 @rt/core，这里只做 macOS 的 fs 读写。
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { listSummaries, makeArchiveId } from '@rt/core';
import type { ArchiveLine, ArchiveRecord, ArchiveSummary } from '../shared/types';

let cached: ArchiveRecord[] | null = null;

function archivesFile(): string {
  return path.join(app.getPath('userData'), 'archives.json');
}

function load(): ArchiveRecord[] {
  if (cached) {
    return cached;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(archivesFile(), 'utf8'));
    cached = Array.isArray(raw) ? (raw as ArchiveRecord[]) : [];
  } catch {
    cached = [];
  }
  return cached;
}

function persist(): void {
  try {
    fs.writeFileSync(archivesFile(), JSON.stringify(cached ?? [], null, 2));
  } catch (err) {
    console.error('保存归档失败:', (err as Error).message);
  }
}

/** 列表按时间倒序（最新在前） */
export function listArchives(): ArchiveSummary[] {
  return listSummaries(load());
}

/** 取完整记录（含对话内容），用于详情查看 */
export function getArchive(id: string): ArchiveRecord | null {
  return load().find((r) => r.id === id) ?? null;
}

export function saveArchive(name: string, lines: ArchiveLine[], createdAt: number): ArchiveSummary[] {
  const list = load();
  list.push({
    id: makeArchiveId(createdAt),
    name: name.trim() || new Date(createdAt).toISOString(),
    createdAt,
    lines,
  });
  persist();
  return listArchives();
}

export function deleteArchive(id: string): ArchiveSummary[] {
  cached = load().filter((r) => r.id !== id);
  persist();
  return listArchives();
}
