/**
 * 左侧「供应商列表」组件（可折叠，展开状态由侧边栏统一控制）。
 */

import { CONNECTION_STATUS, getProtocol } from '../config.js';
import { clear, el, formatTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { confirmDialog } from './confirmDialog.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 * @param {{ onToggle?: () => void }} [options]
 */
export function createSupplierList(store, options = {}) {
  const addBtn = el('button', { class: 'btn btn--primary btn--block', type: 'button' });
  addBtn.innerHTML = `${icon('plus', { size: 15 })}<span>添加供应商</span>`;
  addBtn.addEventListener('click', () => store.openSupplierModal(null));

  const list = el('ul', { class: 'item-list' });
  const scroll = el('div', { class: 'sidebar__scroll' }, list);
  const count = el('span', { class: 'sidebar__count' });

  const toggleBtn = el(
    'button',
    {
      class: 'sidebar__toggle',
      type: 'button',
      attrs: { 'aria-expanded': 'true' },
      onClick: () => options.onToggle?.(),
    },
    [
      el('span', { class: 'sidebar__title', text: '供应商' }),
      count,
      el('span', { class: 'sidebar__chevron', html: icon('chevronDown', { size: 14 }) }),
    ],
  );

  const body = el('div', { class: 'sidebar__section-body' }, [addBtn, scroll]);

  const root = el('section', { class: 'sidebar__section' }, [
    el('div', { class: 'sidebar__head' }, [toggleBtn]),
    body,
  ]);

  /** 展开 / 收起该区块 */
  function setExpanded(expanded) {
    root.classList.toggle('is-expanded', expanded);
    body.hidden = !expanded;
    toggleBtn.setAttribute('aria-expanded', String(expanded));
  }

  /** 连接状态 → 圆点样式 */
  function statusDot(connection) {
    const status = connection?.status || 'untested';
    const meta = CONNECTION_STATUS[status] || CONNECTION_STATUS.untested;
    const title = connection?.message
      ? `${meta.label}：${connection.message}`
      : meta.label;
    return el('span', {
      class: `status-dot status-dot--${meta.tone}`,
      title,
      attrs: { 'aria-label': meta.label },
    });
  }

  function statusText(supplier) {
    const connection = supplier.connection || { status: 'untested' };
    const meta = CONNECTION_STATUS[connection.status] || CONNECTION_STATUS.untested;
    const time = connection.testedAt ? ` · ${formatTime(connection.testedAt)}` : '';
    return `${meta.label}${time}`;
  }

  function buildItem(supplier, isActive) {
    const main = el('button', {
      class: 'supplier-item__main',
      type: 'button',
      onClick: () => {
        store.selectSupplier(supplier.id);
      },
    }, [
      el('span', { class: 'supplier-item__row' }, [
        statusDot(supplier.connection),
        el('span', { class: 'supplier-item__name', text: supplier.name, title: supplier.name }),
      ]),
      el('span', { class: 'supplier-item__model' }, [
        el('span', { class: 'supplier-item__protocol', text: getProtocol(supplier.protocol).short }),
        el('span', {
          class: 'supplier-item__model-name',
          text: supplier.model || '未选择模型',
          title: supplier.model || '该供应商还没有选择模型',
        }),
      ]),
      el('span', { class: 'supplier-item__status', text: statusText(supplier) }),
    ]);

    const editBtn = el('button', {
      class: 'icon-btn icon-btn--sm',
      type: 'button',
      title: '编辑供应商',
      html: icon('pencil', { size: 14 }),
      onClick: (event) => {
        event.stopPropagation();
        store.openSupplierModal(supplier.id);
      },
    });

    const deleteBtn = el('button', {
      class: 'icon-btn icon-btn--sm icon-btn--danger',
      type: 'button',
      title: '删除供应商',
      html: icon('trash', { size: 14 }),
      onClick: async (event) => {
        event.stopPropagation();
        const confirmed = await confirmDialog({
          title: '删除供应商',
          message: `确定要删除「${supplier.name}」吗？`,
          detail: '已生成的测试历史不会被删除，历史记录里会保留当时的配置快照。',
          confirmText: '删除',
          danger: true,
        });
        if (!confirmed) return;
        const { error } = await store.deleteSupplier(supplier.id);
        if (error) toastError('删除失败', error.message);
        else toastSuccess('已删除供应商', supplier.name);
      },
    });

    return el(
      'li',
      {
        class: `supplier-item${isActive ? ' is-active' : ''}`,
        attrs: { 'aria-current': isActive ? 'true' : 'false' },
      },
      [main, el('div', { class: 'supplier-item__actions' }, [editBtn, deleteBtn])],
    );
  }

  function render() {
    const { suppliers, currentSupplierId } = store.state;
    count.textContent = suppliers.length ? `${suppliers.length}` : '';

    clear(list);
    if (suppliers.length === 0) {
      list.appendChild(
        el('li', { class: 'empty empty--compact' }, [
          el('div', { class: 'empty__title', text: '还没有供应商' }),
          el('div', { class: 'empty__desc', text: '添加一个模型接口（Base URL + API Key）即可开始测试。' }),
        ]),
      );
      return;
    }

    for (const supplier of suppliers) {
      list.appendChild(buildItem(supplier, supplier.id === currentSupplierId));
    }
  }

  store.subscribe(render);

  return { root, render, setExpanded };
}
