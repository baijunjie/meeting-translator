// 构建期版本串：<应用 package.json 的 version>+<构建时 commit 短哈希>，如 0.1.0-beta.1+abc1234。
// 三端 Vite 配置共用，经 define 注入为 __APP_VERSION__，桥接以 appVersion 暴露给设置页展示。
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export function buildVersion(pkgDir: string): string {
  const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    version: string;
  };
  let hash = '';
  try {
    hash = execSync('git rev-parse --short HEAD', {
      cwd: pkgDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    /* 无 git 环境（如源码包构建）：只留包版本号 */
  }
  return hash ? `${version}+${hash}` : version;
}
