/**
 * 左侧侧边栏：供应商列表 + 测试历史。
 *
 * 两个列表常驻展示、各自独立滚动。
 */

import { el } from '../utils/dom.js';
import { createHistoryList } from './historyList.js';
import { createSupplierList } from './supplierList.js';

/**
 * @param {import('../store/state.js').store} store
 */
export function createSidebar(store) {
  const supplierList = createSupplierList(store);
  const historyList = createHistoryList(store);

  const root = el('aside', { class: 'sidebar' }, [supplierList.root, historyList.root]);

  return { root };
}
