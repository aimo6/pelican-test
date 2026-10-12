/**
 * 可搜索下拉框（模型名称使用）。
 *
 * 特点：
 * - 输入即过滤，同时允许完全手动输入任意模型 ID
 * - 支持键盘上下键、回车选中、Esc 关闭
 * - 选项列表由外部通过 setOptions 更新（例如「获取模型列表」成功后）
 */

import { clear, el } from '../utils/dom.js';
import { t } from '../utils/i18n.js';

const MAX_VISIBLE = 200;

/**
 * @param {{id?: string, value?: string, placeholder?: string, options?: string[], onChange?: (value: string) => void}} options
 */
export function createCombobox(options = {}) {
  const {
    id = `combo-${Math.random().toString(36).slice(2, 8)}`,
    value = '',
    placeholder = '',
    options: initialOptions = [],
    onChange = () => {},
  } = options;

  let items = [...initialOptions];
  let activeIndex = -1;
  let visibleItems = [];
  let open = false;
  let closeTimer = null;
  /** 本次展开是否忽略输入框内容（拉取模型列表后需要看到全部候选项，而不是被已填的模型名过滤） */
  let ignoreFilter = false;

  const input = el('input', {
    id,
    class: 'input combo__input',
    type: 'text',
    value,
    placeholder,
    autocomplete: 'off',
    spellcheck: false,
    attrs: {
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': `${id}-list`,
    },
  });

  const list = el('ul', {
    id: `${id}-list`,
    class: 'combo__panel',
    attrs: { role: 'listbox' },
    hidden: true,
  });

  const root = el('div', { class: 'combo' }, [input, list]);

  function filterItems() {
    if (ignoreFilter) return items.slice(0, MAX_VISIBLE);
    const keyword = input.value.trim().toLowerCase();
    if (!keyword) return items.slice(0, MAX_VISIBLE);
    return items.filter((item) => item.toLowerCase().includes(keyword)).slice(0, MAX_VISIBLE);
  }

  function renderList() {
    visibleItems = filterItems();
    clear(list);

    if (visibleItems.length === 0) {
      list.appendChild(
        el('li', {
          class: 'combo__empty',
          text: items.length === 0 ? t('combobox.empty') : t('combobox.noMatch'),
        }),
      );
      activeIndex = -1;
      return;
    }

    visibleItems.forEach((item, index) => {
      const isActive = index === activeIndex;
      list.appendChild(
        el(
          'li',
          {
            class: `combo__option${isActive ? ' is-active' : ''}`,
            attrs: { role: 'option', 'aria-selected': String(isActive) },
            onClick: () => selectItem(item),
            // 只切换高亮类，不重建列表，避免 hover 时把节点换掉导致点击落空
            onMouseenter: () => setActiveIndex(index),
          },
          item,
        ),
      );
    });
  }

  /** 更新高亮项（不重建 DOM） */
  function setActiveIndex(index) {
    activeIndex = index;
    const nodes = list.querySelectorAll('.combo__option');
    nodes.forEach((node, i) => {
      const isActive = i === index;
      node.classList.toggle('is-active', isActive);
      node.setAttribute('aria-selected', String(isActive));
    });
  }

  /**
   * 展开候选列表。
   * @param {{unfiltered?: boolean}} [options] unfiltered 为 true 时忽略输入框内容，展示全部候选项
   */
  function openList({ unfiltered = false } = {}) {
    // 取消可能存在的延迟关闭，避免「刚打开又被收起」
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    ignoreFilter = unfiltered;
    if (open) {
      // 已展开：只按新的过滤状态刷新列表
      renderList();
      return;
    }
    open = true;
    input.setAttribute('aria-expanded', 'true');
    list.hidden = false;
    activeIndex = -1;
    renderList();
    root.classList.add('is-open');
  }

  function closeList() {
    if (!open) return;
    open = false;
    input.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    root.classList.remove('is-open');
  }

  function selectItem(item) {
    input.value = item;
    closeList();
    onChange(item);
  }

  input.addEventListener('input', () => {
    onChange(input.value);
    activeIndex = -1;
    openList();
  });

  input.addEventListener('focus', () => openList());
  input.addEventListener('click', () => openList());

  input.addEventListener('blur', () => {
    // 延迟关闭，保证选项的点击事件能先触发
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      closeList();
    }, 150);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList();
      if (visibleItems.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((activeIndex + step + visibleItems.length) % visibleItems.length);
      list.querySelector('.combo__option.is-active')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && visibleItems[activeIndex]) {
        event.preventDefault();
        selectItem(visibleItems[activeIndex]);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation();
        closeList();
      }
    }
  });

  return {
    root,
    input,
    /** 更新候选项 */
    setOptions(nextOptions) {
      items = [...new Set((nextOptions || []).filter((item) => typeof item === 'string' && item.trim()))];
      if (open) renderList();
    },
    getOptions() {
      return [...items];
    },
    setValue(next) {
      input.value = next || '';
    },
    getValue() {
      return input.value.trim();
    },
    /** 展开候选列表（有候选项时） */
    open: openList,
    /** 展开候选列表并忽略输入框内容，展示全部候选项（用于「拉取模型列表」后） */
    openUnfiltered: () => openList({ unfiltered: true }),
    isOpen() {
      return open;
    },
    setDisabled(disabled) {
      input.disabled = Boolean(disabled);
      if (disabled) closeList();
    },
    close: closeList,
  };
}
