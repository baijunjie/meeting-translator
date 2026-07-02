// 构建期注入的全局常量（vite.config.ts 的 define）
/** 发布版本串：包版本+commit 短哈希（见 scripts/build-version.ts） */
declare const __APP_VERSION__: string;
