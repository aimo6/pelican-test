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
import { t } from '../utils/i18n.js';
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

/** 把 HTTP 状态码翻译成可读说明 */
function describeHttpStatus(status) {
  if (status === 400) {
    return { message: t('http.400.message'), hint: t('http.400.hint') };
  }
  if (status === 401) {
    return { message: t('http.401.message'), hint: t('http.401.hint') };
  }
  if (status === 403) {
    return { message: t('http.403.message'), hint: t('http.403.hint') };
  }
  if (status === 404) {
    return { message: t('http.404.message'), hint: t('http.404.hint') };
  }
  if (status === 405) {
    return { message: t('http.405.message'), hint: t('http.405.hint') };
  }
  if (status === 408 || status === 504) {
    return {
      message: t('http.408.message', { status }),
      hint: t('http.408.hint'),
    };
  }
  if (status === 413) {
    return { message: t('http.413.message'), hint: t('http.413.hint') };
  }
  if (status === 422) {
    return { message: t('http.422.message'), hint: t('http.422.hint') };
  }
  if (status === 429) {
    return { message: t('http.429.message'), hint: t('http.429.hint') };
  }
  if (status >= 500) {
    return { message: t('http.5xx.message', { status }), hint: t('http.5xx.hint') };
  }
  return { message: t('http.other.message', { status }), hint: '' };
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
    return t('http.htmlDetail');
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
    return new ApiError(t('http.mixedContent.message'), {
      kind: 'network',
      detail,
      hint: t('http.mixedContent.hint', { target }),
    });
  }

  const reachability = await probeReachability(url);

  if (reachability === 'reachable') {
    const origin = window.location.origin;
    return new ApiError(t('http.cors.message'), {
      kind: 'network',
      detail,
      hint: t('http.cors.hint', { target, origin }),
    });
  }

  if (reachability === 'unreachable') {
    return new ApiError(t('http.unreachable.message'), {
      kind: 'network',
      detail,
      hint: t('http.unreachable.hint', { target }),
    });
  }

  return new ApiError(t('http.probeTimeout.message'), {
    kind: 'network',
    detail,
    hint: t('http.probeTimeout.hint', { target }),
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

  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i.test(raw)) {
    return new ApiError(t('http.dns.message'), {
      kind: 'network',
      detail,
      hint: t('http.dns.hint', { target }),
    });
  }
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/i.test(raw)) {
    return new ApiError(t('http.refused.message'), {
      kind: 'network',
      detail,
      hint: t('http.refused.hint', { target }),
    });
  }
  if (/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE/i.test(raw)) {
    return new ApiError(t('http.connectTimeout.message'), {
      kind: 'timeout',
      detail,
      hint: t('http.connectTimeout.hint', { target }),
    });
  }
  if (/ERR_CERT|ERR_SSL/i.test(raw)) {
    return new ApiError(t('http.cert.message'), {
      kind: 'network',
      detail,
      hint: t('http.cert.hint', { target }),
    });
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY/i.test(raw)) {
    return new ApiError(t('http.offline.message'), {
      kind: 'network',
      detail,
      hint: t('http.offline.hint'),
    });
  }
  return new ApiError(t('http.desktopUnknown.message'), {
    kind: 'network',
    detail,
    hint: t('http.desktopUnknown.hint', { target }),
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
      throw new ApiError(t('http.timeout.message', { seconds: Math.round(timeoutMs / 1000) }), {
        kind: 'timeout',
        hint: t('http.timeout.hint'),
      });
    }
    if (canceled) {
      throw new ApiError(t('http.canceled'), { kind: 'canceled' });
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
    if (canceled) throw new ApiError(t('http.canceled'), { kind: 'canceled' });
    throw new ApiError(t('http.readFailed'), {
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
    throw new ApiError(t('http.invalidJson.message'), {
      kind: 'json',
      status: response.status,
      detail: safeText.slice(0, 300),
      hint: looksLikeHtml ? t('http.invalidJson.hintHtml') : t('http.invalidJson.hintProtocol'),
    });
  }

  if (data && typeof data === 'object' && data.error && !data.choices) {
    // 少数网关会返回 HTTP 200 但 body 里带 error
    const detail = extractErrorDetail(data, '');
    throw new ApiError(t('http.bodyError'), { kind: 'http', status: response.status, detail });
  }

  return { data, text: safeText, status: response.status, url };
}

/**
 * 判断一次失败是否值得自动重试。
 *
 * 只覆盖「可能靠重试恢复」的失败：
 * - timeout：本工具侧超时 / 桌面端的连接超时
 * - HTTP 408 / 429 / 5xx：链路或上游的瞬时故障、限流
 *
 * 配置类错误（400 / 401 / 403 / 404 / 422、CORS、DNS、证书等）重试没有意义，
 * 取消（canceled）与响应格式错误同样不重试。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableError(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'timeout') return true;
  if (error.kind === 'http') {
    const status = error.status;
    return status === 408 || status === 429 || (status >= 500 && status < 600);
  }
  return false;
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
    message: t('http.unknownError'),
    hint: '',
    detail: String((error && error.message) || error || ''),
    kind: 'unknown',
  };
}
