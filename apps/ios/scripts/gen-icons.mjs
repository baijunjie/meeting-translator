// 生成 iOS 应用图标与启动图：纯 sharp，「渲染 SVG → PNG 再使用」，与 macOS 的 gen-icon 一致。
//
// 不用 capacitor-assets：它把源图当 logo 处理、自动加内边距+圆角，iOS 满版图标经系统圆角后
// 会露出白边。这里直接把满版母版 assets/icon.svg 渲成所需 PNG 覆盖资源目录，
// 资源目录的 Contents.json 已随工程提交、文件名不变，故无需 capacitor-assets。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..'); // apps/ios
const root = path.resolve(appDir, '..', '..');
const iconSvg = path.join(root, 'assets', 'icon.svg'); // 满版母版
const xcassets = path.join(appDir, 'ios/App/App/Assets.xcassets');
const appIcon = path.join(xcassets, 'AppIcon.appiconset', 'AppIcon-512@2x.png');
const splashDir = path.join(xcassets, 'Splash.imageset');

const DENSITY = 384; // SVG 栅格化密度，保证 1024/2732 输出清晰

// 1) 应用图标：满版 1024（圆角由系统加），去 alpha
await sharp(iconSvg, { density: DENSITY })
  .resize(1024, 1024)
  .flatten({ background: '#FFFFFF' })
  .png()
  .toFile(appIcon);

// 2) 启动图：图标圆角后居中于背景，2732×2732，亮/暗各一套（三个 scale 共用同图，与原生一致）
const SPLASH = 2732;
const LOGO = 960;
const RADIUS = Math.round(LOGO * 0.22);
const roundMask = Buffer.from(
  `<svg width="${LOGO}" height="${LOGO}"><rect width="${LOGO}" height="${LOGO}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`
);
const logo = await sharp(iconSvg, { density: DENSITY })
  .resize(LOGO, LOGO)
  .composite([{ input: roundMask, blend: 'dest-in' }]) // 圆角裁切
  .png()
  .toBuffer();

async function writeSplash(bg, suffix) {
  const img = await sharp({
    create: { width: SPLASH, height: SPLASH, channels: 4, background: bg },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
  for (const scale of ['@1x', '@2x', '@3x']) {
    await sharp(img).toFile(
      path.join(splashDir, `Default${scale}~universal~anyany${suffix}.png`)
    );
  }
}
await writeSplash({ r: 255, g: 255, b: 255, alpha: 1 }, ''); // 亮色
await writeSplash({ r: 30, g: 31, b: 36, alpha: 1 }, '-dark'); // 暗色（与 app 暗背景 #1e1f24 一致）

console.log('✓ iOS AppIcon + Splash 已生成（纯 sharp）');
