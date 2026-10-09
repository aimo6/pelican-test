/**
 * 左侧侧边栏：供应商列表 + 测试历史 + 本地数据操作。
 * 两个列表以折叠面板的形式展示，同一时间只展开其中一个。
 */

import { el, downloadFile } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { createHistoryList } from './historyList.js';
import { createSupplierList } from './supplierList.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 */
export function createSidebar(store) {
  /** 当前展开的区块：'suppliers' | 'history' | null */
  let expanded = 'suppliers';

  const supplierList = createSupplierList(store, { onToggle: () => toggle('suppliers') });
  const historyList = createHistoryList(store, { onToggle: () => toggle('history') });

  function sync() {
    supplierList.setExpanded(expanded === 'suppliers');
    historyList.setExpanded(expanded === 'history');
  }

  function toggle(name) {
    expanded = expanded === name ? null : name;
    sync();
  }

  sync();

  const exportBtn = el('button', {
    class: 'link-btn',
    type: 'button',
    onClick: () => {
      const payload = store.buildExportPayload();
      const date = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `pelican-test-data-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
      try {
        downloadFile(name, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
        toastSuccess('已导出本地数据', '导出文件中不包含 API Key。');
      } catch (error) {
        toastError('导出失败', String(error && error.message ? error.message : error));
      }
    },
  });
  exportBtn.innerHTML = `${icon('download', { size: 13 })}<span>导出数据</span>`;

  const storageBadge = el('span', { class: 'storage-badge' });

  const foot = el('div', { class: 'sidebar__foot' }, [storageBadge, exportBtn]);

  function render() {
    const { storageMode, suppliers, history } = store.state;
    storageBadge.className = `storage-badge${storageMode === 'memory' ? ' is-warning' : ''}`;
    storageBadge.textContent = storageMode === 'memory' ? '内存模式' : '本地存储';
    storageBadge.title =
      storageMode === 'memory'
        ? 'IndexedDB 不可用，当前数据仅保存在内存中，刷新后会丢失。'
        : `数据保存在当前浏览器（IndexedDB）。当前有 ${suppliers.length} 个供应商、${history.length} 条历史记录。`;
  }

  store.subscribe(render);

  const root = el('aside', { class: 'sidebar' }, [supplierList.root, historyList.root, foot]);

  return { root, render };
}
