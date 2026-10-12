/**
 * 二次确认弹窗。
 * 用于删除供应商、清空历史等破坏性操作。
 */

import { el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';

/**
 * @param {{title: string, message: string, detail?: string, confirmText?: string, cancelText?: string, danger?: boolean}} options
 * @returns {Promise<boolean>} 用户是否确认
 */
export function confirmDialog(options) {
  const {
    title,
    message,
    detail = '',
    confirmText = t('common.confirm'),
    cancelText = t('common.cancel'),
    danger = false,
  } = options;

  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal modal--confirm' });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (dialog.open) dialog.close();
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    };

    const card = el('div', { class: 'modal__card modal__card--sm' }, [
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title', text: title }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: t('common.close'),
          html: icon('x', { size: 16 }),
          onClick: () => finish(false),
        }),
      ]),
      el('div', { class: 'modal__body' }, [
        el('p', { class: 'confirm__message', text: message }),
        detail ? el('p', { class: 'confirm__detail', text: detail }) : null,
      ]),
      el('div', { class: 'modal__foot modal__foot--end' }, [
        el('button', {
          class: 'btn',
          type: 'button',
          text: cancelText,
          onClick: () => finish(false),
        }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          type: 'button',
          text: confirmText,
          onClick: () => finish(true),
        }),
      ]),
    ]);

    dialog.appendChild(card);
    // 点击遮罩区域取消
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    // Esc 关闭视为取消
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    card.querySelector('.btn--primary, .btn--danger')?.focus();
  });
}
