/**
 * Electron 主进程。
 *
 * 职责：
 * - 用自定义协议 app:// 加载前端静态文件，解决 file:// 下 ES Modules 与 IndexedDB 受限的问题；
 *   standard + secure 让页面拥有正常 origin，网页版的全部前端代码无需改动即可运行。
 * - 代替渲染进程在原生侧发起 HTTP 请求（net.fetch 基于 Chromium 网络栈，
 *   不受浏览器同源策略约束，因此不存在 CORS 问题）。
 *
 * 安全约束：
 * - 渲染进程开启 contextIsolation / 关闭 nodeIntegration，只能通过 preload 暴露的两个方法访问外部能力；
 * - 仅允许 http / https 协议的目标地址；
 * - 不引入任何遥测、自动更新或崩溃上报通道。
 */
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** 项目根目录（开发时是仓库根目录，打包后是 asar 内根目录） */
const ROOT = path.join(__dirname, '..');

/** 自定义协议与主机名；页面 origin 形如 app://pelican */
const SCHEME = 'app';
const HOST = 'pelican';

/** 进行中的请求：请求 id -> AbortController */
const inflight = new Map();

// 必须在 app ready 之前注册。standard 让协议拥有正常 origin（ES Modules / IndexedDB 可用），
// secure 使其被视为安全上下文。
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** 把 app://pelican/<路径> 映射到项目目录内的文件 */
function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (url.hostname !== HOST) return new Response('Not Found', { status: 404 });

    let relative;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    const target = path.normalize(path.join(ROOT, relative));
    // 防目录穿越：解析后的路径必须仍在项目根目录内
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}

/** 创建主窗口 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#FFFDF8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(`${SCHEME}://${HOST}/index.html`);
  return win;
}

/** 原生侧 HTTP 桥：渲染进程通过 preload 调用这里发请求 */
function registerHttpBridge() {
  ipcMain.handle('http:request', async (_event, payload) => {
    const { id, url, method = 'GET', headers = {}, body, timeoutMs = 600000 } = payload || {};

    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      return { ok: false, error: { name: 'TypeError', message: '请求地址不合法' } };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: { name: 'TypeError', message: `不支持的协议：${parsed.protocol}` } };
    }

    const controller = new AbortController();
    if (id) inflight.set(id, controller);
    // 兜底超时比渲染侧稍长，防止渲染进程异常时请求悬挂
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 0) + 10000);

    try {
      const response = await net.fetch(url, { method, headers, body, signal: controller.signal });
      const text = await response.text();
      return { ok: true, status: response.status, statusText: response.statusText, text };
    } catch (error) {
      return {
        ok: false,
        error: {
          name: error && error.name ? String(error.name) : 'Error',
          message: error && error.message ? String(error.message) : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
      if (id) inflight.delete(id);
    }
  });

  ipcMain.on('http:cancel', (_event, id) => {
    const controller = inflight.get(id);
    if (controller) controller.abort();
  });
}

app.whenReady().then(() => {
  registerProtocol();
  registerHttpBridge();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
