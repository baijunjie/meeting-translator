// electron-vite 的 ?modulePath：导入子进程入口的构建后路径（供 utilityProcess.fork 使用）
declare module '*?modulePath' {
  const path: string;
  export default path;
}
