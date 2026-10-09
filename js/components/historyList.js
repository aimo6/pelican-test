/**
 * 左侧「测试历史」组件（可折叠，展开状态由侧边栏统一控制）。
 *
 * 历史记录是配置与结果的快照：即使供应商后来被编辑或删除，这里展示的仍然是当时的信息。
 * 点击历史只从本地恢复数据，不会重新调用模型。
 */

import { HISTORY_LIMIT } from '../config.js';
import { clear, el, formatDuration, formatFullTime, formatTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { confirmDialog } from './confirmDialog.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 * @param {{ onToggle?: () => void }} [options]
 */
export function createHistoryList(store, options = {}) {
  const list = el('ul', { class: 'item-list' });
  const scroll = el('div', { class: 'sidebar__scroll' }, list);
  const count = el('span', { class: 'sidebar__count' });

  const clearBtn = el('button', {
    class: 'link-btn link-btn--danger',
    type: 'button',
    text: '清空',
    onClick: async () => {
      const total = store.state.history.length;
      if (total === 0) return;
      const confirmed = await confirmDialog({
        title: '清空测试历史',
        message: `确定要清空全部 ${total} 条测试历史吗？`,
        detail: '只清除历史记录，已保存的供应商配置不受影响。该操作无法撤销。',
        confirmText: '清空',
        danger: true,
      });
      if (!confirmed) return;
      const { error } = await store.clearHistory();
      if (error) toastError('清空失败', error.message);
      else toastSuccess('已清空测试历史');
    },
  });

  const toggleBtn = el(
    'button',
    {
      class: 'sidebar__toggle',
      type: 'button',
      attrs: { 'aria-expanded': 'false' },
      onClick: () => options.onToggle?.(),
    },
    [
      el('span', { class: 'sidebar__title', text: '测试历史' }),
      count,
      el('span', { class: 'sidebar__chevron', html: icon('chevronDown', { size: 14 }) }),
    ],
  );

  const body = el('div', { class: 'sidebar__section-body' }, [scroll]);

  const root = el('section', { class: 'sidebar__section' }, [
    el('div', { class: 'sidebar__head' }, [
      toggleBtn,
      el('div', { class: 'sidebar__head-right' }, [clearBtn]),
    ]),
    body,
  ]);

  /** 展开 / 收起该区块 */
  function setExpanded(expanded) {
    root.classList.toggle('is-expanded', expanded);
    body.hidden = !expanded;
    toggleBtn.setAttribute('aria-expanded', String(expanded));
  }

  function buildItem(record, isActive) {
    const statusTone = record.status === 'success' ? 'ok' : 'error';
    const statusLabel = record.status === 'success' ? '成功' : '失败';
    const svgTone = record.svgSanitized ? 'ok' : 'muted';
    const svgLabel = record.svgSanitized ? '含 SVG' : '无 SVG';

    const main = el('button', {
      class: 'history-item__main',
      type: 'button',
      title: record.prompt,
      onClick: () => {
        store.openHistory(record.id);
      },
    }, [
      el('span', { class: 'history-item__title', text: record.title || '未命名测试' }),
      el('span', {
        class: 'history-item__meta',
        text: `${record.supplierName || '未记录'} · ${record.model || '未记录'}`,
      }),
      el('span', { class: 'history-item__foot' }, [
        el('span', { class: `badge badge--${statusTone}`, text: statusLabel }),
        el('span', { class: `badge badge--${svgTone}`, text: svgLabel }),
        el('span', {
          class: 'history-item__time',
          text: formatTime(record.createdAt),
          title: formatFullTime(record.createdAt),
        }),
        record.durationMs ? el('span', { class: 'history-item__time', text: formatDuration(record.durationMs) }) : null,
      ]),
    ]);

    const deleteBtn = el('button', {
      class: 'icon-btn icon-btn--sm icon-btn--danger',
      type: 'button',
      title: '删除这条历史',
      html: icon('trash', { size: 14 }),
      onClick: async (event) => {
        event.stopPropagation();
        const { error } = await store.deleteHistory(record.id);
        if (error) toastError('删除失败', error.message);
      },
    });

    return el(
      'li',
      {
        class: `history-item${isActive ? ' is-active' : ''}`,
        attrs: { 'aria-current': isActive ? 'true' : 'false' },
      },
      [main, el('div', { class: 'history-item__actions' }, [deleteBtn])],
    );
  }

  function render() {
    const { history, activeHistoryId } = store.state;
    count.textContent = history.length ? `${history.length}/${HISTORY_LIMIT}` : '';
    clearBtn.disabled = history.length === 0;

    clear(list);
    if (history.length === 0) {
      list.appendChild(
        el('li', { class: 'empty empty--compact' }, [
          el('div', { class: 'empty__title', text: '暂无测试历史' }),
          el('div', { class: 'empty__desc', text: `最近 ${HISTORY_LIMIT} 次测试会自动保存在这里。` }),
        ]),
      );
      return;
    }

    for (const record of history) {
      list.appendChild(buildItem(record, record.id === activeHistoryId));
    }
  }

  store.subscribe(render);

  return { root, render, setExpanded };
}
