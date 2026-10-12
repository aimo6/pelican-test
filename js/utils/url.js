/**
 * Base URL 规范化与端点拼接工具。
 *
 * 处理目标：
 * - 去掉末尾斜杠，避免出现 `//chat/completions`
 * - 如果用户直接把完整 endpoint 粘进 Base URL，先剥离再拼接，避免重复 /v1 或 /models
 * - 不擅自替用户补 `/v1`（不同网关前缀不同，猜测会掩盖真实错误）
 *
 * 跨域相关的提示只在网页版给出：桌面端由主进程发请求，不存在同源策略限制。
 */

import { t } from './i18n.js';
import { isDesktop } from './platform.js';

/** 已知的端点后缀，拼接前需要从 Base URL 中剥离 */
const ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/completions',
  '/responses',
  '/messages',
  '/models',
  '/embeddings',
];

/**
 * 规范化 Base URL。
 * @param {string} raw
 * @returns {string}
 */
export function normalizeBaseUrl(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return '';

  // 去掉查询串与 hash，避免污染拼接结果
  value = value.replace(/[?#].*$/, '');
  // 去掉末尾斜杠
  value = value.replace(/\/+$/, '');

  // 反复剥离，处理 `.../v1/chat/completions/` 这类输入
  let changed = true;
  while (changed) {
    changed = false;
    const lower = value.toLowerCase();
    for (const suffix of ENDPOINT_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        value = value.slice(0, value.length - suffix.length).replace(/\/+$/, '');
        changed = true;
        break;
      }
    }
  }
  return value;
}

/**
 * 校验 Base URL 是否可用。
 * @param {string} raw
 * @returns {{ok: boolean, url: string, normalized: string, error: string|null, warning: string|null}}
 */
export function validateBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, url: '', normalized: '', error: t('url.required'), warning: null };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    return {
      ok: false,
      url: '',
      normalized: '',
      error: t('url.invalid'),
      warning: null,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      url: parsed.href,
      normalized: '',
      error: t('url.unsupportedProtocol', { protocol: parsed.protocol }),
      warning: null,
    };
  }

  const normalized = normalizeBaseUrl(trimmed);
  let warning = null;
  if (parsed.protocol === 'http:' && !isDesktop && window.location.protocol === 'https:') {
    warning = t('url.mixedContentWarning');
  } else if (!isDesktop && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    warning = t('url.localhostWarning');
  }

  return { ok: true, url: parsed.href, normalized, error: null, warning };
}

/**
 * 拼接端点地址。
 * @param {string} baseUrl 已保存或表单中的 Base URL
 * @param {string} path 以 `/` 开头的端点路径
 * @returns {string} 完整 URL；Base URL 非法时返回空字符串
 */
export function buildEndpoint(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return '';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * 从完整 URL 中提取用于展示的「主机 + 路径」，隐藏可能的敏感查询参数。
 * @param {string} url
 */
export function describeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch (error) {
    return String(url ?? '');
  }
}
