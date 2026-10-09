/**
 * 轻量 Toast 提示。
 */

import { el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';

const ICON_BY_TYPE = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

let root = null;

/** 初始化挂载点 */
export function initToast(container) {
  root = container;
}

/**
 * 显示一条提示。
 * @param {string} message
 * @param {{type?: 'success'|'error'|'warning'|'info', detail?: string, duration?: number}} [options]
 */
export function toast(message, options = {}) {
  if (!root) return;
  const { type = 'info', detail = '', duration = 3600 } = options;

  const node = el('div', { class: `toast toast--${type}`, attrs: { role: 'status' } }, [
    el('span', { class: 'toast__icon', html: icon(ICON_BY_TYPE[type] || 'info', { size: 16 }) }),
    el('div', { class: 'toast__body' }, [
      el('div', { class: 'toast__message', text: message }),
      detail ? el('div', { class: 'toast__detail', text: detail }) : null,
    ]),
    el('button', {
      class: 'toast__close',
      type: 'button',
      title: '关闭',
      html: icon('x', { size: 14 }),
      onClick: () => remove(),
    }),
  ]);

  let timer = null;
  const remove = () => {
    if (timer) clearTimeout(timer);
    if (node.parentNode) node.parentNode.removeChild(node);
  };

  root.appendChild(node);
  if (duration > 0) timer = setTimeout(remove, duration);
  return remove;
}

export const toastSuccess = (message, detail) => toast(message, { type: 'success', detail });
export const toastError = (message, detail) => toast(message, { type: 'error', detail, duration: 6000 });
export const toastWarning = (message, detail) => toast(message, { type: 'warning', detail, duration: 5000 });
export const toastInfo = (message, detail) => toast(message, { type: 'info', detail });
