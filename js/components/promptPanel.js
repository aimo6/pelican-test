/**
 * 提示词输入区域。
 *
 * 输入内容保存在组件内部，避免每次按键都触发全局重渲染；
 * 通过 state.promptRevision 响应外部恢复（点击历史记录、加载示例等）。
 * 底部操作栏分两行：上行是「供应商 → 协议 → 模型」的配置选择，
 * 下行是运行状态与「开始测试」，纵向空间尽量留给 SVG 结果面板。
 */

import { CONNECTION_STATUS, DEFAULT_PROMPT } from '../config.js';
import { clear, el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { createModelSelect } from './modelSelect.js';

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
    placeholder: '描述你希望模型生成的 SVG，例如：使用 SVG 绘制一个戴着蓝色帽子的鹈鹕在海边骑自行车的 2D 动画。',
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

  const supplierSelect = el('select', {
    class: 'select select--compact',
    title: '切换供应商',
    onChange: (event) => store.selectSupplier(event.target.value),
  });

  const modelSelect = createModelSelect(store);

  const connectionBadge = el('span', { class: 'badge badge--muted' });

  const editSupplierBtn = el('button', {
    class: 'icon-btn icon-btn--sm',
    type: 'button',
    title: '编辑当前供应商配置',
    html: icon('pencil', { size: 14 }),
    onClick: () => {
      const supplier = store.getCurrentSupplier();
      if (supplier) store.openSupplierModal(supplier.id);
    },
  });

  const supplierGroup = el('div', { class: 'prompt__supplier' }, [
    supplierSelect,
    modelSelect.root,
    connectionBadge,
    editSupplierBtn,
  ]);

  const addSupplierBtn = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    html: `${icon('plus', { size: 14 })}<span>添加供应商</span>`,
    onClick: () => store.openSupplierModal(null),
  });

  const supplierEmpty = el('div', { class: 'prompt__supplier', hidden: true }, [
    el('span', { class: 'prompt__supplier-hint', text: '尚未配置供应商' }),
    addSupplierBtn,
  ]);

  /* ------------------------------- 运行 ------------------------------- */

  const runBtn = el('button', { class: 'btn btn--primary', type: 'button' });
  runBtn.innerHTML = `${icon('play', { size: 15 })}<span>开始测试</span>`;
  runBtn.addEventListener('click', submit);

  const cancelBtn = el('button', {
    class: 'btn btn--danger',
    type: 'button',
    onClick: () => controller.cancelRun(),
  });
  cancelBtn.innerHTML = `${icon('stop', { size: 14 })}<span>取消请求</span>`;

  const statusText = el('span', { class: 'prompt__status' });

  const errorBox = el('div', { class: 'alert alert--error', hidden: true });

  const loadExampleBtn = el('button', {
    class: 'link-btn',
    type: 'button',
    text: '载入示例',
    onClick: () => {
      textarea.value = DEFAULT_PROMPT;
      updateCounter();
      textarea.focus();
    },
  });

  const clearPromptBtn = el('button', {
    class: 'link-btn',
    type: 'button',
    text: '清空',
    onClick: () => {
      textarea.value = '';
      updateCounter();
      textarea.focus();
    },
  });

  const root = el('section', { class: 'panel prompt' }, [
    el('div', { class: 'prompt__body' }, [
      textarea,
      el('div', { class: 'prompt__foot' }, [
        el('div', { class: 'prompt__foot-actions' }, [loadExampleBtn, clearPromptBtn]),
        el('span', { class: 'prompt__spacer' }),
        counter,
      ]),
    ]),
    errorBox,
    el('div', { class: 'prompt__actions' }, [
      el('div', { class: 'prompt__config-row' }, [supplierGroup, supplierEmpty]),
      el('div', { class: 'prompt__run-row' }, [
        statusText,
        el('span', { class: 'prompt__spacer' }),
        cancelBtn,
        el('span', { class: 'prompt__shortcut', text: 'Ctrl / ⌘ + Enter 提交' }),
        runBtn,
      ]),
    ]),
  ]);

  function updateCounter() {
    const length = textarea.value.length;
    counter.textContent = length ? `${length} 字符` : '';
  }

  function submit() {
    const prompt = textarea.value.trim();
    if (!prompt) {
      controller.showPromptError('请先填写提示词。');
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

  /** 渲染供应商选择器与连接状态（模型部分由 modelSelect 自行渲染） */
  function renderSupplier() {
    const { suppliers, currentSupplierId } = store.state;
    const supplier = store.getCurrentSupplier();

    // 模型 / 思考的变化不影响下拉本身，这里不参与签名，避免每敲一键就重建下拉
    const signature = [
      currentSupplierId,
      ...suppliers.map((item) => [item.id, item.name, item.connection?.status].join(':')),
    ].join('|');

    if (signature !== supplierSignature) {
      supplierSignature = signature;
      clear(supplierSelect);
      for (const item of suppliers) {
        supplierSelect.appendChild(
          el('option', {
            value: item.id,
            text: item.name,
            selected: item.id === currentSupplierId,
          }),
        );
      }
    }

    supplierGroup.hidden = !supplier;
    supplierEmpty.hidden = Boolean(supplier);
    if (!supplier) return;

    const connection = supplier.connection || { status: 'untested' };
    const connectionMeta = CONNECTION_STATUS[connection.status] || CONNECTION_STATUS.untested;
    connectionBadge.className = `badge badge--${connectionMeta.tone}`;
    connectionBadge.textContent = connectionMeta.label;
    connectionBadge.title = connection.message
      ? `${connectionMeta.label}：${connection.message}`
      : connectionMeta.label;
  }

  function render() {
    const { promptRevision, prompt, run } = store.state;

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
      ? '请先添加并选择一个供应商'
      : !hasModel
        ? '请先在配置行填写或拉取模型'
        : '';
    runBtn.classList.toggle('is-busy', running);
    runBtn.innerHTML = running
      ? `${icon('loader', { size: 15, className: 'spin' })}<span>请求中…</span>`
      : `${icon('play', { size: 15 })}<span>开始测试</span>`;
    cancelBtn.hidden = !running;

    if (run.status === 'running') {
      statusText.textContent = '正在调用模型，请稍候…';
      statusText.className = 'prompt__status is-loading';
    } else if (run.status === 'canceled') {
      statusText.textContent = '请求已取消';
      statusText.className = 'prompt__status';
    } else if (run.status === 'success') {
      statusText.textContent = run.note || '请求完成';
      statusText.className = 'prompt__status is-ok';
    } else if (run.status === 'error') {
      statusText.textContent = '';
      statusText.className = 'prompt__status';
    } else {
      statusText.textContent = '';
      statusText.className = 'prompt__status';
    }

    renderError(run.status === 'error' ? run.error : null);
  }

  store.subscribe(render);

  return { root, render, getPrompt: () => textarea.value.trim() };
}
