/**
 * 轻量 DOM 工具函数。项目不引入任何前端框架，这里统一封装元素创建与常用格式化。
 */

import { icon } from './icons.js';

/** 这些 key 直接写入 DOM 属性（property），其余走 setAttribute */
const PROP_KEYS = new Set([
  'value',
  'type',
  'checked',
  'disabled',
  'readOnly',
  'placeholder',
  'selected',
  'multiple',
  'href',
  'title',
  'id',
  'name',
  'rows',
  'cols',
  'maxLength',
  'min',
  'max',
  'step',
  'accept',
  'download',
  'target',
  'rel',
  'src',
  'alt',
  'tabIndex',
  'hidden',
  'spellcheck',
  'autocomplete',
  'autofocus',
]);

/**
 * 创建元素。
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {any} [children] 字符串 / 节点 / 数组（可嵌套）
 * @returns {HTMLElement}
 */
export function el(tag, props = null, children = null) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/**
 * 批量设置元素属性。
 * - `class` / `text` / `html` / `style` / `dataset` / `attrs` 为特殊 key
 * - `onXxx` 绑定事件
 * - 其余按属性名写入
 */
export function applyProps(node, props) {
  if (!props) return node;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = String(value);
      continue;
    }
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (key === 'html') {
      // 仅用于本项目内置的静态图标字符串，不要传入外部内容
      node.innerHTML = String(value);
      continue;
    }
    if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
      continue;
    }
    if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
      continue;
    }
    if (key === 'attrs' && typeof value === 'object') {
      for (const [attr, attrValue] of Object.entries(value)) {
        if (attrValue === null || attrValue === undefined || attrValue === false) continue;
        node.setAttribute(attr, attrValue === true ? '' : String(attrValue));
      }
      continue;
    }
    if (/^on[A-Z]/.test(key) && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (key === 'checked' || key === 'disabled' || key === 'readOnly' || key === 'selected') {
      node[key] = Boolean(value);
      continue;
    }
    if (PROP_KEYS.has(key)) {
      node[key] = value;
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  return node;
}

/** 追加子节点，支持字符串、节点、数组与空值 */
export function appendChildren(node, children) {
  if (children === null || children === undefined || children === false) return node;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(node, child);
    return node;
  }
  if (children instanceof Node) {
    node.appendChild(children);
    return node;
  }
  node.appendChild(document.createTextNode(String(children)));
  return node;
}

/** querySelector 简写 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** 清空子节点 */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 相对时间格式化：刚刚 / N 分钟前 / N 小时前 / MM-DD HH:mm
 * @param {number} timestamp
 */
export function formatTime(timestamp, now = Date.now()) {
  if (!timestamp) return '—';
  const diff = now - timestamp;
  if (diff < 0) return formatFullTime(timestamp);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const date = new Date(timestamp);
  const base = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (date.getFullYear() === new Date(now).getFullYear()) return base;
  return `${date.getFullYear()}-${base}`;
}

/** 完整时间：YYYY-MM-DD HH:mm:ss */
export function formatFullTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** 耗时格式化 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** 文本截断 */
export function truncate(text, max = 60) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (source.length <= max) return source;
  return `${source.slice(0, max - 1)}…`;
}

/**
 * 复制文本到剪贴板，优先使用 Clipboard API，失败时回退到 textarea + execCommand。
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    // 继续走回退方案
  }
  try {
    const textarea = el('textarea', {
      value,
      style: { position: 'fixed', top: '-1000px', opacity: '0' },
      attrs: { 'aria-hidden': 'true' },
    });
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (error) {
    return false;
  }
}

/** 生成唯一 ID */
export function uid(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

/**
 * 给按钮加 / 去加载态（原内容暂存到 dataset，恢复时写回）。
 * @param {HTMLButtonElement|null} button
 * @param {boolean} busy
 * @param {string} [busyText]
 */
export function setButtonBusy(button, busy, busyText = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-busy');
    button.innerHTML = `${icon('loader', { size: 15, className: 'spin' })}<span>${busyText}</span>`;
    return;
  }
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
  button.disabled = false;
  button.classList.remove('is-busy');
}

/** 触发下载 */
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
