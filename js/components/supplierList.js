/**
 * 左侧「供应商列表」组件：紧凑卡片常驻展示，列表独立滚动。
 *
 * 每张卡片展示名称、接口协议与 Base URL，悬停时显示编辑 / 删除入口；
 * 当前选中的供应商使用浅绿色背景 + 左侧强调条突出显示。
 */

import { getProtocol } from '../config.js';
import { clear, el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 */
export function createSupplierList(store) {
  const addBtn = el('button', {
    class: 'btn btn--primary btn--sm',
    type: 'button',
    title: t('supplier.addTitle'),
  });
  addBtn.innerHTML = `${icon('plus', { size: 14 })}<span>${t('supplier.add')}</span>`;
  addBtn.addEventListener('click', () => store.openSupplierModal(null));

  const list = el('ul', { class: 'item-list' });
  const scroll = el('div', { class: 'sidebar__scroll' }, list);
  const count = el('span', { class: 'sidebar__count' });

  const sectionTitle = el('span', { class: 'sidebar__section-title', text: t('supplier.section') });
  const head = el('div', { class: 'sidebar__section-head' }, [
    el('div', { class: 'sidebar__section-label' }, [sectionTitle, count]),
    addBtn,
  ]);

  const root = el(
    'section',
    { class: 'sidebar__section sidebar__section--suppliers', attrs: { 'aria-label': t('supplier.section') } },
    [head, scroll],
  );

  function buildItem(supplier, isActive) {
    const protocol = getProtocol(supplier.protocol);

    const main = el('button', {
      class: 'supplier-card__main',
      type: 'button',
      onClick: () => {
        store.selectSupplier(supplier.id);
      },
    }, [
      el('span', { class: 'supplier-card__name', text: supplier.name, title: supplier.name }),
      el('span', { class: 'supplier-card__meta' }, [
        el('span', {
          class: 'chip',
          text: protocol.short,
          title: t('common.protocolTitle', { label: t(protocol.labelKey) }),
        }),
        el('span', { class: 'supplier-card__baseurl', text: supplier.baseUrl, title: supplier.baseUrl }),
      ]),
    ]);

    const editBtn = el('button', {
      class: 'icon-btn icon-btn--sm',
      type: 'button',
      title: t('supplier.editTitle'),
      html: icon('pencil', { size: 14 }),
      onClick: (event) => {
        event.stopPropagation();
        store.openSupplierModal(supplier.id);
      },
    });

    const deleteBtn = el('button', {
      class: 'icon-btn icon-btn--sm icon-btn--danger',
      type: 'button',
      title: t('supplier.deleteTitle'),
      html: icon('trash', { size: 14 }),
      onClick: async (event) => {
        event.stopPropagation();
        const confirmed = await confirmDialog({
          title: t('supplier.confirmDeleteTitle'),
          message: t('supplier.confirmDeleteMessage', { name: supplier.name }),
          detail: t('supplier.confirmDeleteDetail'),
          confirmText: t('supplier.confirmDeleteConfirm'),
          danger: true,
        });
        if (!confirmed) return;
        const { error } = await store.deleteSupplier(supplier.id);
        if (error) toastError(t('supplier.deleteFailed'), error.message);
        else toastSuccess(t('supplier.deleted'), supplier.name);
      },
    });

    return el(
      'li',
      {
        class: `supplier-card${isActive ? ' is-active' : ''}`,
        attrs: { 'aria-current': isActive ? 'true' : 'false' },
      },
      [main, el('div', { class: 'supplier-card__actions' }, [editBtn, deleteBtn])],
    );
  }

  /** 语言变化时更新头部静态文案（列表每次渲染都会重建，天然使用新语言） */
  let renderedLocale = null;
  function applyLocaleIfNeeded() {
    if (store.state.locale === renderedLocale) return;
    renderedLocale = store.state.locale;
    sectionTitle.textContent = t('supplier.section');
    root.setAttribute('aria-label', t('supplier.section'));
    addBtn.title = t('supplier.addTitle');
    addBtn.innerHTML = `${icon('plus', { size: 14 })}<span>${t('supplier.add')}</span>`;
  }

  function render() {
    const { suppliers, currentSupplierId } = store.state;
    applyLocaleIfNeeded();
    count.textContent = suppliers.length ? `${suppliers.length}` : '';

    clear(list);
    if (suppliers.length === 0) {
      list.appendChild(
        el('li', { class: 'empty empty--compact' }, [
          el('div', { class: 'empty__title', text: t('supplier.emptyTitle') }),
          el('div', { class: 'empty__desc', text: t('supplier.emptyDesc') }),
        ]),
      );
      return;
    }

    for (const supplier of suppliers) {
      list.appendChild(buildItem(supplier, supplier.id === currentSupplierId));
    }
  }

  store.subscribe(render);

  return { root, render };
}
