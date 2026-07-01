// 浏览器平台探测。集中放这里，避免各处散落 UA 判断。

/**
 * 是否 iOS / iPadOS 设备。
 *
 * iOS 上**所有**浏览器（Safari / Chrome / Firefox…）都强制用 WebKit 内核，共享同一套
 * 极严的单标签页内存上限；本地翻译模型（M2M100）与 ASR 两个大模型共存会超限，系统直接
 * 杀掉页面进程、Safari 自动重载页面（表现为「翻译一开就整页刷新、像崩溃」）。而 4-bit
 * 量化在 onnxruntime-web 里也跑不起来（关图优化时解码静默卡死，开图优化时建 session 直接
 * OOM）。因此这些设备不提供本地翻译、只走云端（见 bridge.ts 的引擎强制与设置项隐藏）。
 * 按“设备”而非“浏览器”判定：iOS 上换哪个浏览器内核都一样。
 */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  // iPadOS 13+ 默认「请求桌面网站」，UA 伪装成 Mac Safari；靠触点数区分真 Mac（无触摸屏）。
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
