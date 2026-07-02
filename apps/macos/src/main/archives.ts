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
  const file = archivesFile();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // 文件不存在（首次运行等）：直接从空列表开始，不做备份
    cached = [];
    return cached;
  }
  try {
    const parsed = JSON.parse(raw);
    cached = Array.isArray(parsed) ? (parsed as ArchiveRecord[]) : [];
  } catch (err) {
    // 解析失败：把损坏文件改名保留（archives.json.corrupt-<时间戳>），避免下次保存无声
    // 覆盖导致归档永久丢失；随后从空列表开始。
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch (renameErr) {
      console.error('备份损坏归档文件失败:', (renameErr as Error).message);
    }
    console.error('归档文件解析失败:', (err as Error).message);
    cached = [];
  }
  return cached;
}

// 落盘串行化：多次写按入队顺序执行，避免并发写交错；单次失败不影响后续写入。
let writeChain: Promise<void> = Promise.resolve();

// 异步落盘（fire-and-forget）：内存缓存已即时生效，调用方同步返回即可；
// 同步写全量 JSON 会阻塞主进程事件循环（录音中主进程还在逐帧转发音频）。
// 先写 .tmp 再原子 rename，进程中途退出不会留下半截 JSON 损坏归档。
function persist(): void {
  const snapshot = JSON.stringify(cached ?? [], null, 2);
  writeChain = writeChain
    .then(async () => {
      const file = archivesFile();
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, file);
    })
    .catch((err) => {
      console.error('保存归档失败:', (err as Error).message);
    });
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
