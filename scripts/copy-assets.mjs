// 把渲染进程的静态资源（html / css）拷到编译输出目录，tsc 只处理 .ts
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src', 'renderer');
const outDir = join(root, 'dist', 'renderer');

await mkdir(outDir, { recursive: true });
for (const file of ['index.html', 'style.css']) {
  await cp(join(srcDir, file), join(outDir, file));
}
console.log('assets copied -> dist/renderer');
