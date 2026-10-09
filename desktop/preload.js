/**
 * 预加载脚本：向渲染进程暴露最小化的桌面能力。
 *
 * 只暴露两个方法——发起请求与取消请求，不暴露任何 Node 或 Electron 内部对象。
 * 渲染进程通过 window.pelicanDesktop 是否存在来判断当前运行在桌面端还是网页端。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pelicanDesktop', {
  /**
   * 在原生侧发起一次 HTTP 请求。
   * @param {{id: string, url: string, method?: string, headers?: Record<string,string>, body?: string, timeoutMs?: number}} payload
   * @returns {Promise<{ok: true, status: number, statusText: string, text: string} | {ok: false, error: {name: string, message: string}}>}
   */
  request: (payload) => ipcRenderer.invoke('http:request', payload),
  /** 取消一个进行中的请求 */
  cancel: (id) => ipcRenderer.send('http:cancel', id),
});
