// 生成 PWA 图标：纯 sharp，从满版母版 assets/icon.svg 渲成 public/ 下的 PNG。
// 与 iOS/macOS 的 gen-icon 一致：直接渲满版母版，不用 capacitor-assets。
//   - favicon.png：浏览器标签页用。母版是满版方形，iOS/macOS 由系统加圆角，Web 标签页
//     不会，故在此用圆角遮罩裁成圆角方块、保留透明角（露出标签底色即圆角观感）。
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

// 标签页 favicon：满版母版 + 圆角遮罩（dest-in），保留透明角。与 macOS gen-icon 的圆角
// 裁切同一手法；rx≈20% 与桌面/移动端 app 图标观感一致。
async function writeFavicon(size, file) {
  const r = Math.round(size * 0.2);
  const icon = await sharp(iconSvg, { density: DENSITY }).resize(size, size).png().toBuffer();
  await sharp(icon)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`
        ),
        blend: 'dest-in', // 圆角裁切
      },
    ])
    .png()
    .toFile(path.join(publicDir, file));
}

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

await writeFavicon(96, 'favicon.png');
await writeAny(192, 'pwa-192.png');
await writeAny(512, 'pwa-512.png');
await writeMaskable(512, 'pwa-maskable-512.png');
await writeAny(180, 'apple-touch-icon.png');

console.log('✓ PWA 图标已生成到 public/（纯 sharp）');
