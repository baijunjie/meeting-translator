/// <reference types="vite/client" />
import type { ElectronApi } from '@shared/types';

declare global {
  interface Window {
    api: ElectronApi;
  }
  /** 发布版本串：包版本+commit 短哈希，构建期注入（见 scripts/build-version.ts） */
  const __APP_VERSION__: string;
}

export {};
