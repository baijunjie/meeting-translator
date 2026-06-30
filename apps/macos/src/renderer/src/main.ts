// macOS 渲染进程薄入口：用 createMacBridge 把 window.api 包装成平台无关的 AppBridge
// （音频采集在桥接内完成），再注入给 @mt/ui。真正的 UI 全部来自 @mt/ui。
import { mountApp } from '@mt/ui';
import '@mt/ui/styles';
import { createMacBridge } from './mac-bridge';

mountApp('#app', createMacBridge(window.api));
