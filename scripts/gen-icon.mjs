// 由 build/icon.svg 生成应用图标资源：
//   build/icon.png   1024×1024 主图（dev Dock / Linux / 通用）
//   build/icon.icns  macOS 应用图标（iconutil 打包多分辨率）
//   build/icon.iconset/ 中间产物（生成 icns 后删除）
// 用法：node scripts/gen-icon.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = join(root, 'build', 'icon.svg');
const pngMaster = join(root, 'build', 'icon.png');
const iconset = join(root, 'build', 'icon.iconset');
const icns = join(root, 'build', 'icon.icns');

const render = (size, out) => sharp(svg, { density: 512 }).resize(size, size).png().toFile(out);

await render(1024, pngMaster);
console.log('✓ build/icon.png (1024)');

// macOS iconset 需要的尺寸（含 @2x）
const specs = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
await Promise.all(specs.map(([s, name]) => render(s, join(iconset, name))));
console.log('✓ build/icon.iconset (10 sizes)');

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'inherit' });
rmSync(iconset, { recursive: true, force: true });
console.log('✓ build/icon.icns');