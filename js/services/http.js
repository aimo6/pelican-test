/**
 * 统一 HTTP 请求层。
 *
 * 职责：
 * - 统一处理超时、取消、JSON 解析
 * - 把各种失败（网络 / CORS / 认证 / 限流 / 服务端错误）翻译成可读的中文提示
 * - 任何错误信息在返回前都会抹掉 API Key，避免密钥泄漏到界面或控制台
 *
 * 两种运行模式（见 utils/platform.js）：
 * - 网页版：浏览器直接 fetch，受同源策略约束，要求接口开启 CORS；
 * - 桌面版：请求交给 Electron 主进程用 net.fetch 发出，不受 CORS 约束，
 *   因此能拿到真实的 HTTP 状态码与网络错误码，无需 no-cors 探测去猜原因。
 */

import { redactSecret } from '../utils/base64.js';
import { describeUrl } from '../utils/url.js';
import { desktopBridge } from '../utils/platform.js';

/** 业务错误类型，UI 层通过 kind 做差异化展示 */
export class ApiError extends Error {
  /**
   * @param {string} message 面向用户的主要提示
   * @param {{kind?: string, status?: number|null, detail?: string, hint?: string}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    /** @type {string} network | timeout | canceled | auth | http | json | format | config */
    this.kind = options.kind || 'unknown';
    this.status = options.status ?? null;
    this.detail = options.detail || '';
    this.hint = options.hint || '';
  }
}

/** 把 HTTP 状态码翻译成中文说明 */
function describeHttpStatus(status) {
  if (status === 400) {
    return {
      message: '请求被接口拒绝（HTTP 400）。',
      hint: '常见原因：模型名称不正确、参数不被支持，或请求体格式不符合该接口要求。',
    };
  }
  if (status === 401) {
    return {
      message: '认证失败（HTTP 401）。',
      hint: '请检查 API Key 是否正确、是否已过期，以及是否需要带 Bearer 前缀。',
    };
  }
  if (status === 403) {
    return {
      message: '没有访问权限（HTTP 403）。',
      hint: 'API Key 可能无权访问该模型，或该模型未开通。',
    };
  }
  if (status === 404) {
    return {
      message: '接口路径不存在（HTTP 404）。',
      hint: '请检查 Base URL 是否完整，例如是否需要包含 /v1；本工具不会自动补 /v1。',
    };
  }
  if (status === 405) {
    return { message: '请求方法不被支持（HTTP 405）。', hint: '该地址可能不是所选协议对应的接口。' };
  }
  if (status === 408 || status === 504) {
    return {
      message: `接口响应超时（HTTP ${status}）。`,
      hint: 'HTTP 504 是链路上某一层等待上游超时后返回的，最常见的是网关 / 反向代理（如 nginx 的 proxy_read_timeout，默认 60 秒）。这不是浏览器侧超时，调大本工具的超时没有用，需要调大那一层的超时，或换用响应更快的模型。',
    };
  }
  if (status === 413) {
    return { message: '请求体过大（HTTP 413）。', hint: '请缩短提示词后重试。' };
  }
  if (status === 422) {
    return { message: '请求参数校验失败（HTTP 422）。', hint: '接口不接受当前参数，请检查模型名称与思考参数配置。' };
  }
  if (status === 429) {
    return { message: '请求过于频繁，已触发限流（HTTP 429）。', hint: '请稍后重试，或检查账号配额。' };
  }
  if (status >= 500) {
    return { message: `接口服务端错误（HTTP ${status}）。`, hint: '这通常是供应商侧的问题，可以稍后重试。' };
  }
  return { message: `请求失败（HTTP ${status}）。`, hint: '' };
}

/** 从错误响应体中尽力提取可读信息 */
function extractErrorDetail(payload, fallbackText) {
  if (payload && typeof payload === 'object') {
    const error = payload.error;
    if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
    if (typeof error === 'string' && error) return error;
    if (typeof payload.message === 'string' && payload.message) return payload.message;
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (typeof payload.msg === 'string' && payload.msg) return payload.msg;
  }
  const text = String(fallbackText || '').trim();
  if (!text) return '';
  // 返回的是 HTML（例如登录页 / 网关错误页）时只提示类型，避免把整页 HTML 塞进界面
  if (/^\s*<(!doctype|html|head|body)/i.test(text)) {
    return '接口返回的是 HTML 页面而不是 JSON，通常说明地址指向了网页而不是 API。';
  }
  return text.slice(0, 400);
}

/** no-cors 探测请求的超时时间（毫秒）：只用来确认「服务器有没有响应」 */
const REACHABILITY_PROBE_TIMEOUT_MS = 6000;

/**
 * 用一次 no-cors 探测请求判断服务器是否「有响应」。
 *
 * 背景：普通跨域请求失败时，浏览器不会把状态码交给 JS——CORS 被拦、DNS 解析失败、
 * 连接被拒全都是同一个 TypeError。但 no-cors 模式不要求跨域头，于是可以区分：
 * - 拿到 opaque 响应（status 恒为 0）→ 服务器确实回了东西，原请求失败是因为响应缺跨域头
 * - 直接抛错 → 网络层就没通（域名解析、端口、服务未启动）
 * - 探测自身超时 → 无法判断
 *
 * @param {string} url
 * @returns {Promise<'reachable'|'unreachable'|'timeout'>}
 */
async function probeReachability(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REACHABILITY_PROBE_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    return 'reachable';
  } catch (error) {
    return controller.signal.aborted ? 'timeout' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把一次「fetch 直接抛错」翻译成尽量明确的诊断结论。
 * @param {string} url 实际请求的完整地址
 * @param {unknown} error
 * @param {string} secret 用于脱敏
 * @returns {Promise<ApiError>}
 */
async function describeConnectionFailure(url, error, secret) {
  const detail = redactSecret(String(error && error.message ? error.message : error), secret);
  const target = describeUrl(url);

  // 混合内容是静态可判定的，不需要发探测请求
  if (window.location.protocol === 'https:' && /^http:\/\//i.test(url)) {
    return new ApiError('请求被浏览器拦截：HTTPS 页面不允许访问 HTTP 接口（混合内容）。', {
      kind: 'network',
      detail,
      hint: `接口地址是 ${target}。请把 Base URL 改成 https，或改用 http 打开本页面。`,
    });
  }

  const reachability = await probeReachability(url);

  if (reachability === 'reachable') {
    const origin = window.location.origin;
    return new ApiError('接口有响应，但响应被浏览器拦截（缺少跨域头）。', {
      kind: 'network',
      detail,
      hint:
        `服务器对 ${target} 是有响应的，但响应里没有 Access-Control-Allow-Origin，` +
        '浏览器因此拒绝把状态码交给页面——所以这里看不到真实的 HTTP 状态码（可能是 401/404，也可能是网关生成的 504）。' +
        `请到 DevTools → Network 查看该请求的真实状态码。若要前端直接调用，需要接口方放行来源 ${origin}，` +
        '并允许 authorization、content-type 等请求头（OPTIONS 预检）。',
    });
  }

  if (reachability === 'unreachable') {
    return new ApiError('无法连接到接口：网络层完全无响应。', {
      kind: 'network',
      detail,
      hint: `请求地址 ${target} 没有任何响应。常见原因：域名解析失败、端口未开放、服务未启动，或本机网络 / DNS 异常。可先用 curl 直接请求该地址验证。`,
    });
  }

  return new ApiError('无法连接到接口。', {
    kind: 'network',
    detail,
    hint: `探测请求也超时了，无法确定原因。请求地址 ${target}。常见原因：Base URL 写错、接口未开启 CORS 跨域、网络不可达，或服务响应极慢。`,
  });
}

/**
 * 桌面端：把 Electron 原生侧的网络失败原因翻译成可读提示。
 *
 * 桌面端请求由主进程发出，不存在 CORS 拦截，抛错即代表真实的网络层问题，
 * 且错误信息里带有 Chromium 的网络错误码，可以直接据此定位。
 *
 * @param {string} url 实际请求的完整地址
 * @param {unknown} error
 * @param {string} secret 用于脱敏
 * @returns {ApiError}
 */
function describeDesktopFailure(url, error, secret) {
  const raw = String((error && error.message) || error || '');
  const detail = redactSecret(raw, secret);
  const target = describeUrl(url);
  const at = (text) => `请求地址 ${target}。${text}`;

  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(raw)) {
    return new ApiError('无法解析接口域名。', {
      kind: 'network',
      detail,
      hint: at('请检查 Base URL 中的域名拼写，以及本机 DNS 是否正常。'),
    });
  }
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(raw)) {
    return new ApiError('无法连接到接口：连接被拒绝或中断。', {
      kind: 'network',
      detail,
      hint: at('请确认该地址可访问、端口已开放、服务已启动。'),
    });
  }
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE/i.test(raw)) {
    return new ApiError('连接接口超时。', {
      kind: 'timeout',
      detail,
      hint: at('请检查网络是否可达、目标服务是否在正常运行。'),
    });
  }
  if (/ERR_CERT|ERR_SSL/i.test(raw)) {
    return new ApiError('接口 HTTPS 证书校验失败。', {
      kind: 'network',
      detail,
      hint: at('请检查该地址的证书配置是否有效。'),
    });
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY/i.test(raw)) {
    return new ApiError('本机网络不可用。', {
      kind: 'network',
      detail,
      hint: '请检查本机网络连接（或代理设置）后重试。',
    });
  }
  return new ApiError('无法连接到接口。', {
    kind: 'network',
    detail,
    hint: at('请检查地址、网络和接口服务状态。'),
  });
}

/**
 * 桌面端请求：把参数交给 Electron 主进程发出。
 *
 * 返回一个与浏览器 Response 等价的最小结构（ok / status / statusText / text），
 * 使 requestJson 后续的错误映射与 JSON 解析逻辑可以完全复用。
 *
 * @param {string} url
 * @param {{method: string, headers: Record<string,string>, body: any, signal: AbortSignal|null, timeoutMs: number}} options
 */
async function desktopRequest(url, { method, headers, body, signal, timeoutMs }) {
  const id = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  if (signal && signal.aborted) {
    throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
  }

  // 取消在渲染侧立即生效，不等待主进程确认；同时通知主进程中止底层连接
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = () => reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
  });
  const onAbort = () => {
    desktopBridge.cancel(id);
    rejectOnAbort();
  };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const result = await Promise.race([
      desktopBridge.request({ id, url, method, headers, body, timeoutMs }),
      aborted,
    ]);

    if (!result || result.ok !== true) {
      const info = (result && result.error) || {};
      const error = new Error(info.message || '请求失败');
      error.name = info.name || 'Error';
      throw error;
    }

    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: result.statusText || '',
      text: async () => result.text,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * 发送请求并解析 JSON。
 *
 * @param {string} url
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: any,
 *   signal?: AbortSignal|null,
 *   timeoutMs?: number,
 *   secret?: string,
 * }} options
 * @returns {Promise<{data: any, text: string, status: number, url: string}>}
 */
export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = undefined,
    signal = null,
    timeoutMs = 60000,
    secret = '',
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  let canceled = false;

  const onExternalAbort = () => {
    canceled = true;
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) onExternalAbort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, timeoutMs));

  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  };

  let response;
  try {
    response = desktopBridge
      ? await desktopRequest(url, { method, headers, body, signal: controller.signal, timeoutMs })
      : await fetch(url, {
          method,
          headers,
          body,
          signal: controller.signal,
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
        });
  } catch (error) {
    cleanup();
    if (timedOut) {
      throw new ApiError(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒未收到响应）。`, {
        kind: 'timeout',
        hint: '可以点击取消后重试，或换用响应更快的模型。',
      });
    }
    if (canceled) {
      throw new ApiError('请求已取消。', { kind: 'canceled' });
    }
    // 桌面端：原生侧能给出真实的网络错误码；
    // 网页端：fetch 抛 TypeError，可能是网络不可达，也可能是响应被浏览器 CORS 策略拦截，需要探测区分
    if (desktopBridge) throw describeDesktopFailure(url, error, secret);
    throw await describeConnectionFailure(url, error, secret);
  }

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    cleanup();
    if (canceled) throw new ApiError('请求已取消。', { kind: 'canceled' });
    throw new ApiError('读取响应内容失败。', {
      kind: 'network',
      detail: redactSecret(String(error && error.message ? error.message : error), secret),
    });
  }
  cleanup();

  const safeText = redactSecret(text, secret);

  let data = null;
  let jsonError = null;
  if (safeText.trim()) {
    try {
      data = JSON.parse(safeText);
    } catch (error) {
      jsonError = error;
    }
  }

  if (!response.ok) {
    const { message, hint } = describeHttpStatus(response.status);
    const detail = extractErrorDetail(data, safeText);
    throw new ApiError(message, {
      kind: response.status === 401 || response.status === 403 ? 'auth' : 'http',
      status: response.status,
      detail,
      hint,
    });
  }

  if (jsonError) {
    const looksLikeHtml = /^\s*</.test(safeText);
    throw new ApiError('接口返回的内容不是合法 JSON。', {
      kind: 'json',
      status: response.status,
      detail: safeText.slice(0, 300),
      hint: looksLikeHtml
        ? '返回的是 HTML 页面，通常说明 Base URL 指向了网页而不是 API，或中间存在需要登录的代理。'
        : '请确认该地址与所选协议匹配（chat / responses / messages）。',
    });
  }

  if (data && typeof data === 'object' && data.error && !data.choices) {
    // 少数网关会返回 HTTP 200 但 body 里带 error
    const detail = extractErrorDetail(data, '');
    throw new ApiError('接口返回了错误信息。', { kind: 'http', status: response.status, detail });
  }

  return { data, text: safeText, status: response.status, url };
}

/**
 * 把 ApiError 整理成用于界面展示的完整文本（不含密钥）。
 * @param {unknown} error
 * @returns {{message: string, hint: string, detail: string, kind: string}}
 */
export function describeError(error) {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      hint: error.hint || '',
      detail: error.detail || '',
      kind: error.kind,
    };
  }
  return {
    message: '发生未知错误。',
    hint: '',
    detail: String((error && error.message) || error || ''),
    kind: 'unknown',
  };
}
