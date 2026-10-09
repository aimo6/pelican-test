/**
 * 运行环境判定。
 *
 * 网页版与桌面版（Electron）共用同一套前端代码，差异集中在这里：
 * 桌面版由 preload 脚本注入 window.pelicanDesktop（在页面脚本执行前完成），
 * 请求改由主进程的 net.fetch 发出，因此不受浏览器同源策略约束。
 */

/** 桌面端桥接对象（preload 注入）；网页版为 null */
export const desktopBridge = (typeof window !== 'undefined' && window.pelicanDesktop) || null;

/** 当前是否运行在桌面端 */
export const isDesktop = desktopBridge !== null;
