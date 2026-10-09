/**
 * 思考参数配置弹窗（从模型选择区的「思考」按钮打开）。
 *
 * - 参数预设按当前协议过滤（chat / responses / messages 各有一套）
 * - 只有显式开启且配置完整时，参数才会附加到请求体
 * - 配置随供应商保存（supplier.thinking），点「完成」时写回
 */

import {
  THINKING_LEVELS,
  VALUE_TYPES,
  createDefaultThinking,
  getThinkingPresets,
} from '../config.js';
import { clear, el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { toastError } from './toast.js';

/** 各协议的说明文案 */
const PROTOCOL_HINTS = {
  chat: '参数会附加到 /chat/completions 请求体。不同接口对思考参数的支持不一致，本工具只按配置原样发送，不保证模型一定遵循。',
  responses: '参数会附加到 /responses 请求体。Responses 接口的思考参数通常是 reasoning.effort（low / medium / high）。',
  messages:
    '参数会附加到 /messages 请求体。Messages 接口的思考预算需小于 max_tokens（本工具固定 8192）；只要配置了 thinking.* 参数，本工具会自动补充 thinking.type=enabled。',
};

/**
 * @param {import('../store/state.js').store} store
 */
export function createThinkingModal(store) {
  const dialog = el('dialog', { class: 'modal modal--thinking' });

  /** 当前编辑的供应商 ID */
  let supplierId = null;
  /** 当前供应商的协议（决定预设范围） */
  let protocol = 'chat';

  /* --------------------------- 表单控件 --------------------------- */

  const levelSelect = el(
    'select',
    { class: 'select', id: 'thinking-level', onChange: () => syncUI() },
    THINKING_LEVELS.map((item) => el('option', { value: item.value, text: item.label })),
  );

  const enabledInput = el('input', {
    type: 'checkbox',
    id: 'thinking-enabled',
    onChange: () => syncUI(),
  });

  const presetSelect = el('select', { class: 'select', id: 'thinking-preset' });

  const paramInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'thinking-param',
    placeholder: '例如：reasoning.effort',
    spellcheck: false,
  });

  const typeSelect = el(
    'select',
    { class: 'select', id: 'thinking-type', onChange: () => syncUI() },
    VALUE_TYPES.map((item) => el('option', { value: item.value, text: item.label })),
  );

  /** @type {Record<string, HTMLInputElement>} */
  const valueInputs = {};
  const valueGrid = el('div', { class: 'value-grid' });
  for (const level of THINKING_LEVELS.filter((item) => item.value !== 'auto')) {
    const input = el('input', {
      class: 'input',
      type: 'text',
      placeholder: '留空表示不发送',
      spellcheck: false,
      onInput: () => {
        // 手动改取值后自动切换到「自定义」预设，避免与预设描述不一致
        if (presetSelect.value !== 'custom') presetSelect.value = 'custom';
        syncUI();
      },
    });
    valueInputs[level.value] = input;
    valueGrid.appendChild(
      el('label', { class: 'value-grid__item' }, [
        el('span', { class: 'value-grid__label', text: level.label.replace('（不发送思考参数）', '') }),
        input,
      ]),
    );
  }

  const protocolHint = el('p', { class: 'field__hint' });
  const note = el('p', { class: 'field__hint field__hint--status' });

  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit' });
  saveBtn.innerHTML = `${icon('check', { size: 15 })}<span>完成</span>`;

  const cancelBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '取消',
    onClick: () => close(),
  });

  const form = el(
    'form',
    {
      class: 'modal__card modal__card--sm',
      onSubmit: (event) => {
        event.preventDefault();
        handleSave();
      },
    },
    [
      el('div', { class: 'modal__head' }, [
        el('h2', { class: 'modal__title', text: '思考参数' }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          title: '关闭',
          html: icon('x', { size: 16 }),
          onClick: () => close(),
        }),
      ]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'thinking-level', text: '思考等级' }),
          levelSelect,
          el('p', {
            class: 'field__hint',
            text: '「自动」表示不干预；其余等级按下面的参数配置发送。',
          }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { class: 'checkbox' }, [
            enabledInput,
            el('span', { text: '向接口发送思考参数（默认关闭，兼容性最好）' }),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'thinking-preset', text: '参数预设' }),
          presetSelect,
        ]),
        el('div', { class: 'field-row field-row--two' }, [
          el('div', { class: 'field' }, [
            el('label', { for: 'thinking-param', text: '参数名' }),
            paramInput,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'thinking-type', text: '取值类型' }),
            typeSelect,
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '各等级对应的取值' }),
          valueGrid,
        ]),
        protocolHint,
        note,
      ]),
      el('div', { class: 'modal__foot modal__foot--end' }, [
        el('div', { class: 'modal__foot-actions' }, [cancelBtn, saveBtn]),
      ]),
    ],
  );

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  /* --------------------------- 交互逻辑 --------------------------- */

  presetSelect.addEventListener('change', () => {
    const preset = getPresets().find((item) => item.id === presetSelect.value);
    if (!preset) return;
    applyPreset(preset);
    enabledInput.checked = preset.id !== 'none';
    syncUI();
  });

  paramInput.addEventListener('input', () => {
    const preset = getPresets().find((item) => item.id === presetSelect.value);
    if (preset && preset.paramName !== paramInput.value.trim()) {
      presetSelect.value = 'custom';
    }
    syncUI();
  });

  /** 当前协议可用的预设 */
  function getPresets() {
    return getThinkingPresets(protocol);
  }

  /** 渲染预设下拉（selectedId 不在当前协议范围内时回退到第一个） */
  function renderPresets(selectedId) {
    const presets = getPresets();
    clear(presetSelect);
    for (const preset of presets) {
      presetSelect.appendChild(el('option', { value: preset.id, text: preset.label }));
    }
    presetSelect.value = presets.some((item) => item.id === selectedId) ? selectedId : presets[0].id;
  }

  /** 用预设覆盖参数名、取值类型与各等级取值 */
  function applyPreset(preset) {
    paramInput.value = preset.paramName;
    typeSelect.value = preset.valueType;
    for (const [level, input] of Object.entries(valueInputs)) {
      input.value = preset.values[level] ?? '';
    }
  }

  /** 同步可编辑状态与说明 */
  function syncUI() {
    const level = levelSelect.value;
    const enabled = enabledInput.checked;

    presetSelect.disabled = !enabled;
    paramInput.disabled = !enabled;
    typeSelect.disabled = !enabled;
    for (const input of Object.values(valueInputs)) input.disabled = !enabled;

    if (level === 'auto') {
      note.textContent = enabled
        ? '当前为「自动」：参数已配置但不会发送，选择具体等级后才会附加到请求中。'
        : '当前为「自动」：请求中不会包含任何思考参数。';
      note.className = 'field__hint field__hint--status';
      return;
    }
    if (!enabled) {
      note.textContent = `当前等级「${level}」只记录在本地，请求中不会包含思考参数。`;
      note.className = 'field__hint field__hint--status';
      return;
    }
    const paramName = paramInput.value.trim();
    if (!paramName) {
      note.textContent = '请填写参数名，否则请求中不会包含思考参数。';
      note.className = 'field__hint field__hint--warning';
      return;
    }
    const value = valueInputs[level]?.value?.trim() ?? '';
    if (!value) {
      note.textContent = `等级「${level}」没有配置取值，请求中不会包含该参数。`;
      note.className = 'field__hint field__hint--warning';
      return;
    }
    const autoType = protocol === 'messages' && paramName.startsWith('thinking') ? '，并自动补充 thinking.type=enabled' : '';
    note.textContent = `本次请求将附加参数：${paramName} = ${value}（${typeSelect.value}）${autoType}`;
    note.className = 'field__hint field__hint--status';
  }

  /** 收集表单中的思考配置 */
  function collectThinking() {
    const values = {};
    for (const [level, input] of Object.entries(valueInputs)) {
      values[level] = input.value.trim();
    }
    return {
      level: levelSelect.value,
      enabled: enabledInput.checked,
      presetId: presetSelect.value,
      paramName: paramInput.value.trim(),
      valueType: typeSelect.value,
      values,
    };
  }

  async function handleSave() {
    if (!supplierId) {
      close();
      return;
    }
    const { error } = await store.setSupplierThinking(supplierId, collectThinking());
    if (error) {
      toastError('思考参数保存失败', error.message);
      return;
    }
    close();
  }

  function open(id) {
    const supplier = store.getSupplier(id);
    if (!supplier) return;

    supplierId = id;
    protocol = supplier.protocol || 'chat';

    const thinking = supplier.thinking || createDefaultThinking();
    const presets = getPresets();
    const presetId = presets.some((item) => item.id === thinking.presetId) ? thinking.presetId : presets[0].id;

    renderPresets(presetId);
    levelSelect.value = thinking.level || 'auto';
    enabledInput.checked = Boolean(thinking.enabled);

    if (presetId === thinking.presetId) {
      // 预设仍适用于当前协议：原样回填
      paramInput.value = thinking.paramName || '';
      typeSelect.value = thinking.valueType || 'string';
      for (const [level, input] of Object.entries(valueInputs)) {
        input.value = (thinking.values && thinking.values[level]) || '';
      }
    } else {
      // 切换协议后预设不再适用：按新协议的默认预设重置
      applyPreset(presets[0]);
    }

    protocolHint.textContent = PROTOCOL_HINTS[protocol] || '';
    syncUI();

    if (!dialog.open) dialog.showModal();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  return { open, close, dialog };
}
