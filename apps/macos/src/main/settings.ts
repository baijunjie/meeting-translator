// 应用设置的本地持久化：存到 electron userData/settings.json。
// 纯逻辑（默认值生成 / 字段补齐 / 旧版本兼容）已下沉到 @mt/core，这里只做 macOS 的同步读写。
// 注意：API Key 目前明文保存，后续可改用 electron safeStorage 加密。
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { makeDefaults, withDefaults } from '@mt/core';
import type { AppSettings } from '../shared/types';

/** 按系统偏好语言生成默认设置（电子环境下读取系统语言） */
function defaults(): AppSettings {
  // 优先用系统偏好语言（getLocale 返回的是 Chromium/应用语言，开发环境常为 en-US）。
  return makeDefaults([
    ...(app.getPreferredSystemLanguages?.() ?? []),
    app.getSystemLocale?.() ?? '',
    app.getLocale(),
  ]);
}

let cached: AppSettings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  if (cached) {
    return cached;
  }
  try {
    cached = withDefaults(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), defaults());
  } catch {
    cached = defaults();
  }
  return cached;
}

export function saveSettings(next: AppSettings): AppSettings {
  cached = withDefaults(next, defaults());
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(cached, null, 2));
  } catch (err) {
    console.error('保存设置失败:', (err as Error).message);
  }
  return cached;
}
