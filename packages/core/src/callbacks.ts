// 轻量回调集线器：AppBridge on* 契约（追加注册 + 返回反注册函数）的通用实现，
// 供无原生事件设施的宿主（Web / iOS 的 JS 桥接）使用；Electron preload 直接用
// ipcRenderer 的 on/removeListener 实现同一契约，不经此处。
export interface CallbackHub<T> {
  /** 依注册顺序同步分发给全部订阅者 */
  emit(value: T): void;
  /** 追加注册；返回仅移除本次注册的反注册函数 */
  on(cb: (value: T) => void): () => void;
}

export function createCallbackHub<T>(): CallbackHub<T> {
  const subs = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const cb of subs) cb(value);
    },
    on(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}
