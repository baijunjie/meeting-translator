// 生成 PWA 图标：纯 sharp，从满版母版 assets/icon.svg 渲成 public/ 下的 PNG。
// 与 iOS/macOS 的 gen-icon 一致：直接渲满版母版，不用 capacitor-assets。
//   - pwa-192 / pwa-512：标准（any）图标，满版（安装到主屏由系统加圆角）。
//   - pwa-maskable-512：可遮罩图标，安全区内缩（外圈留 ~10% 给系统遮罩）。
//   - apple-touch-icon：iOS Safari「添加到主屏」用，180×180 白底。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..'); // apps/web
const root = path.resolve(appDir, '..', '..');
const iconSvg = path.join(root, 'assets', 'icon.svg'); // 满版母版
const publicDir = path.join(appDir, 'public');

const DENSITY = 384; // SVG 栅格化密度，保证大尺寸输出清晰

// 标准图标：满版，去 alpha（PWA 安装/启动用白底兜底）。
async function writeAny(size, file) {
  await sharp(iconSvg, { density: DENSITY })
    .resize(size, size)
    .flatten({ background: '#FFFFFF' })
    .png()
    .toFile(path.join(publicDir, file));
}

// 可遮罩图标：图标内缩到安全区（占比 0.8），四周留白给系统遮罩，512 画布白底。
async function writeMaskable(size, file) {
  const inner = Math.round(size * 0.8);
  const logo = await sharp(iconSvg, { density: DENSITY }).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: '#FFFFFF' },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(publicDir, file));
}

await writeAny(192, 'pwa-192.png');
await writeAny(512, 'pwa-512.png');
await writeMaskable(512, 'pwa-maskable-512.png');
await writeAny(180, 'apple-touch-icon.png');

console.log('✓ PWA 图标已生成到 public/（纯 sharp）');
