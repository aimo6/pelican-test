/**
 * 提示词输入区域。
 *
 * 输入内容保存在组件内部，避免每次按键都触发全局重渲染；
 * 通过 state.promptRevision 响应外部恢复（点击历史记录、加载示例等）。
 * 底部操作栏分两行：上行是「供应商 → 协议 → 模型」的配置选择，
 * 下行是运行状态与「开始测试」，纵向空间尽量留给 SVG 结果面板。
 *
 * 语言切换：只更新静态文案与 placeholder，绝不改写 textarea 的草稿内容。
 */

import { el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import { createModelSelect } from './modelSelect.js';
import { createSelect } from './select.js';

/**
 * @param {import('../store/state.js').store} store
 * @param {ReturnType<typeof import('../controller.js').createController>} controller
 */
export function createPromptPanel(store, controller) {
  let revision = -1;
  let supplierSignature = '';

  const textarea = el('textarea', {
    class: 'textarea',
    id: 'prompt-input',
    rows: 2,
    placeholder: t('prompt.placeholder'),
    spellcheck: false,
    onInput: () => {
      updateCounter();
    },
    onKeydown: (event) => {
      // Ctrl / Cmd + Enter 快速提交
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    },
  });

  const counter = el('span', { class: 'prompt__counter' });

  /* ---------------------------- 供应商与模型 ---------------------------- */

  const supplierSelect = createSelect({
    title: t('prompt.selectProvider'),
    onChange: (value) => store.selectSupplier(value),
  });

  const modelSelect = createModelSelect(store);

  const editSupplierBtn = el('button', {
    class: 'icon-btn icon-btn--sm',
    type: 'button',
    title: t('prompt.editProvider'),
    html: icon('pencil', { size: 14 }),
    onClick: () => {
      const supplier = store.getCurrentSupplier();
      if (supplier) store.openSupplierModal(supplier.id);
    },
  });

  const supplierGroup = el('div', { class: 'prompt__supplier' }, [
    supplierSelect.root,
    modelSelect.root,
    editSupplierBtn,
  ]);

  const addSupplierBtn = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    html: `${icon('plus', { size: 14 })}<span>${t('prompt.addProvider')}</span>`,
    onClick: () => store.openSupplierModal(null),
  });

  const supplierEmptyHint = el('span', { class: 'prompt__supplier-hint', text: t('prompt.noProvider') });
  const supplierEmpty = el('div', { class: 'prompt__supplier', hidden: true }, [
    supplierEmptyHint,
    addSupplierBtn,
  ]);

  /* ------------------------------- 运行 ------------------------------- */

  const runBtn = el('button', { class: 'btn btn--primary', type: 'button' });
  runBtn.addEventListener('click', submit);

  const cancelBtn = el('button', {
    class: 'btn btn--danger',
    type: 'button',
    onClick: () => controller.cancelRun(),
  });

  const statusText = el('span', { class: 'prompt__status' });

  const errorBox = el('div', { class: 'alert alert--error', hidden: true });

  const loadExampleBtn = el('button', {
    class: 'link-btn',
    type: 'button',
    text: t('prompt.loadExample'),
    onClick: () => {
      textarea.value = t('prompt.example');
      updateCounter();
      textarea.focus();
    },
  });

  const clearPromptBtn = el('button', {
    class: 'link-btn',
    type: 'button',
    text: t('prompt.clear'),
    onClick: () => {
      textarea.value = '';
      updateCounter();
      textarea.focus();
    },
  });

  const shortcutHint = el('span', { class: 'prompt__shortcut', text: t('prompt.shortcut') });

  const root = el('section', { class: 'panel prompt' }, [
    el('div', { class: 'prompt__body' }, [
      textarea,
      el('div', { class: 'prompt__foot' }, [
        counter,
        el('span', { class: 'prompt__spacer' }),
        el('div', { class: 'prompt__foot-actions' }, [loadExampleBtn, clearPromptBtn]),
      ]),
    ]),
    errorBox,
    el('div', { class: 'prompt__actions' }, [
      el('div', { class: 'prompt__config-row' }, [supplierGroup, supplierEmpty]),
      el('div', { class: 'prompt__run-row' }, [
        statusText,
        el('span', { class: 'prompt__spacer' }),
        cancelBtn,
        shortcutHint,
        runBtn,
      ]),
    ]),
  ]);

  function updateCounter() {
    const length = textarea.value.length;
    counter.textContent = length ? t('prompt.counter', { n: length }) : '';
  }

  /** 语言变化时更新静态文案（不触碰 textarea 内容） */
  let renderedLocale = null;
  function applyLocaleIfNeeded() {
    if (store.state.locale === renderedLocale) return;
    renderedLocale = store.state.locale;
    textarea.placeholder = t('prompt.placeholder');
    supplierSelect.trigger.title = t('prompt.selectProvider');
    editSupplierBtn.title = t('prompt.editProvider');
    addSupplierBtn.innerHTML = `${icon('plus', { size: 14 })}<span>${t('prompt.addProvider')}</span>`;
    supplierEmptyHint.textContent = t('prompt.noProvider');
    cancelBtn.innerHTML = `${icon('stop', { size: 14 })}<span>${t('prompt.cancel')}</span>`;
    shortcutHint.textContent = t('prompt.shortcut');
    loadExampleBtn.textContent = t('prompt.loadExample');
    clearPromptBtn.textContent = t('prompt.clear');
    updateCounter();
  }

  function submit() {
    const prompt = textarea.value.trim();
    if (!prompt) {
      controller.showPromptError(t('prompt.required'));
      textarea.focus();
      return;
    }
    controller.runTest(prompt);
  }

  function renderError(error) {
    if (!error) {
      errorBox.hidden = true;
      errorBox.textContent = '';
      return;
    }
    errorBox.hidden = false;
    errorBox.textContent = '';
    errorBox.appendChild(el('div', { class: 'alert__icon', html: icon('alert', { size: 16 }) }));
    errorBox.appendChild(
      el('div', { class: 'alert__body' }, [
        el('div', { class: 'alert__message', text: error.message }),
        error.hint ? el('div', { class: 'alert__hint', text: error.hint }) : null,
        error.detail ? el('pre', { class: 'alert__detail', text: error.detail }) : null,
      ]),
    );
  }

  /** 渲染供应商选择器（模型与思考部分由 modelSelect 自行渲染） */
  function renderSupplier() {
    const { suppliers, currentSupplierId } = store.state;
    const supplier = store.getCurrentSupplier();

    // 模型 / 思考的变化不影响下拉本身，这里不参与签名，避免每敲一键就重建下拉
    const signature = [
      currentSupplierId,
      ...suppliers.map((item) => [item.id, item.name].join(':')),
    ].join('|');

    if (signature !== supplierSignature) {
      supplierSignature = signature;
      supplierSelect.setOptions(suppliers.map((item) => ({ value: item.id, label: item.name })));
      supplierSelect.setValue(currentSupplierId || '');
    }

    supplierGroup.hidden = !supplier;
    supplierEmpty.hidden = Boolean(supplier);
  }

  function render() {
    const { promptRevision, prompt, run } = store.state;

    applyLocaleIfNeeded();

    if (promptRevision !== revision) {
      revision = promptRevision;
      if (textarea.value !== prompt) textarea.value = prompt || '';
      updateCounter();
    }

    renderSupplier();

    const running = run.status === 'running';
    const supplier = store.getCurrentSupplier();
    const hasSupplier = Boolean(supplier);
    const hasModel = Boolean(supplier && supplier.model);
    runBtn.disabled = running || !hasSupplier || !hasModel;
    runBtn.title = !hasSupplier
      ? t('prompt.runNoProvider')
      : !hasModel
        ? t('prompt.runNoModel')
        : '';
    runBtn.classList.toggle('is-busy', running);
    runBtn.innerHTML = running
      ? `${icon('loader', { size: 15, className: 'spin' })}<span>${t('prompt.running')}</span>`
      : `${icon('play', { size: 15 })}<span>${t('prompt.run')}</span>`;
    cancelBtn.hidden = !running;

    if (run.status === 'running') {
      // 自动重试期间 run.note 会带上「第 n/N 次尝试」的进度，优先展示
      statusText.textContent = run.note || t('prompt.statusRunning');
      statusText.className = 'prompt__status is-loading';
    } else if (run.status === 'canceled') {
      statusText.textContent = t('prompt.statusCanceled');
      statusText.className = 'prompt__status';
    } else if (run.status === 'success') {
      statusText.textContent = run.note || t('prompt.statusDone');
      statusText.className = 'prompt__status is-ok';
    } else {
      statusText.textContent = '';
      statusText.className = 'prompt__status';
    }

    renderError(run.status === 'error' ? run.error : null);
  }

  store.subscribe(render);

  return { root, render, getPrompt: () => textarea.value.trim() };
}
