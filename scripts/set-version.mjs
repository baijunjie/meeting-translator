// 统一设置工作区版本号（消除版本漂移）：
//   pnpm set-version 0.1.0-beta.2
// 写入 根 / apps/macos / apps/ios 的 package.json（packages/* 为内部包，版本固定不动）。
import { readFileSync, writeFileSync } from 'node:fs';

const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v)) {
  console.error('用法: pnpm set-version <x.y.z[-tag]>  例: pnpm set-version 0.1.0-beta.2');
  process.exit(1);
}
for (const f of ['package.json', 'apps/macos/package.json', 'apps/ios/package.json']) {
  const p = JSON.parse(readFileSync(f, 'utf8'));
  p.version = v;
  writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
  console.log(`${f} → ${v}`);
}
