/**
 * 样式化下拉选择框（替代原生 <select>）。
 *
 * 原生 <select> 的弹出列表由系统渲染，无法与页面视觉统一，
 * 这里用「按钮触发器 + 自绘弹出列表」实现，键盘与 ARIA 行为对齐原生控件：
 * - Enter / Space / ↑ / ↓ 打开；↑ / ↓ 移动高亮；Enter 选中；Esc / 点击外部关闭
 * - 焦点保持在触发器上，用 aria-activedescendant 标记高亮项
 */

import { clear, el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';

/**
 * @param {{
 *   id?: string,
 *   options?: Array<{value: string, label: string}>,
 *   value?: string,
 *   onChange?: (value: string) => void,
 *   title?: string,
 * }} config
 */
export function createSelect(config = {}) {
  const {
    id = `select-${Math.random().toString(36).slice(2, 8)}`,
    options: initialOptions = [],
    value = '',
    onChange = () => {},
    title = '',
  } = config;

  let items = normalizeOptions(initialOptions);
  let current = value;
  let open = false;
  let activeIndex = -1;

  const labelNode = el('span', { class: 'dropdown__label' });
  const trigger = el(
    'button',
    {
      class: 'dropdown__trigger',
      type: 'button',
      title,
      attrs: { 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${id}-list` },
    },
    [
      labelNode,
      el('span', { class: 'dropdown__chevron', html: icon('chevronDown', { size: 15 }) }),
    ],
  );

  const panel = el('ul', {
    id: `${id}-list`,
    class: 'dropdown__panel',
    attrs: { role: 'listbox' },
    hidden: true,
  });

  const root = el('div', { class: 'dropdown' }, [trigger, panel]);

  function normalizeOptions(next) {
    return (next || [])
      .filter((item) => item && item.value !== undefined && item.value !== null)
      .map((item) => ({ value: String(item.value), label: String(item.label ?? item.value) }));
  }

  function syncLabel() {
    const item = items.find((entry) => entry.value === current);
    labelNode.textContent = item ? item.label : '';
  }

  function renderPanel() {
    clear(panel);

    if (items.length === 0) {
      panel.appendChild(el('li', { class: 'dropdown__empty', text: t('select.empty') }));
      setActiveIndex(-1);
      return;
    }

    items.forEach((item, index) => {
      const selected = item.value === current;
      panel.appendChild(
        el(
          'li',
          {
            id: `${id}-opt-${index}`,
            class: `dropdown__option${selected ? ' is-selected' : ''}`,
            attrs: { role: 'option', 'aria-selected': String(selected) },
            onClick: () => selectItem(item),
            // 只切换高亮类，不重建列表，避免 hover 时把节点换掉导致点击落空
            onMouseenter: () => setActiveIndex(index),
          },
          [
            el('span', { class: 'dropdown__option-label', text: item.label }),
            el('span', { class: 'dropdown__option-check', html: icon('check', { size: 14 }) }),
          ],
        ),
      );
    });

    // 高亮态（类名 + aria-activedescendant）统一由 setActiveIndex 维护
    setActiveIndex(activeIndex);
  }

  /** 更新高亮项（不重建 DOM） */
  function setActiveIndex(index) {
    activeIndex = index;
    const nodes = panel.querySelectorAll('.dropdown__option');
    nodes.forEach((node, i) => node.classList.toggle('is-active', i === index));
    if (index >= 0) trigger.setAttribute('aria-activedescendant', `${id}-opt-${index}`);
    else trigger.removeAttribute('aria-activedescendant');
  }

  function openPanel() {
    if (open) return;
    open = true;
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    activeIndex = items.findIndex((item) => item.value === current);
    renderPanel();
    panel.hidden = false;
    positionPanel();
    scrollActiveIntoView();
    document.addEventListener('click', onDocumentClick);
  }

  /** 面板默认左对齐；右侧空间不足时改为右对齐，避免超出窗口被裁切 */
  function positionPanel() {
    panel.style.left = '';
    panel.style.right = '';
    const rect = trigger.getBoundingClientRect();
    if (rect.left + panel.offsetWidth > window.innerWidth - 16) {
      panel.style.left = 'auto';
      panel.style.right = '0';
    }
  }

  function closePanel() {
    if (!open) return;
    open = false;
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    panel.hidden = true;
    document.removeEventListener('click', onDocumentClick);
  }

  function onDocumentClick(event) {
    if (!root.contains(event.target)) closePanel();
  }

  function scrollActiveIntoView() {
    panel.querySelector('.dropdown__option.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function selectItem(item) {
    closePanel();
    trigger.focus();
    if (item.value === current) return;
    current = item.value;
    syncLabel();
    onChange(item.value);
  }

  trigger.addEventListener('click', () => {
    if (open) closePanel();
    else openPanel();
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openPanel();
        return;
      }
      if (items.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((activeIndex + step + items.length) % items.length);
      scrollActiveIntoView();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) {
        openPanel();
        return;
      }
      if (activeIndex >= 0 && items[activeIndex]) selectItem(items[activeIndex]);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key === 'Tab' && open) closePanel();
  });

  syncLabel();

  return {
    root,
    trigger,
    /** 更新候选项（保持当前值不变，值不在列表中时标签显示为空） */
    setOptions(next) {
      items = normalizeOptions(next);
      syncLabel();
      if (open) {
        activeIndex = items.findIndex((item) => item.value === current);
        renderPanel();
      }
    },
    setValue(next) {
      const value = next || '';
      if (value === current) return;
      current = value;
      syncLabel();
      if (open) {
        activeIndex = items.findIndex((item) => item.value === current);
        renderPanel();
      }
    },
    getValue() {
      return current;
    },
    isOpen() {
      return open;
    },
    close: closePanel,
  };
}
