/**
 * 供应商新增 / 编辑弹窗。
 *
 * 只维护「接入信息」：名称（可选）、Base URL、API Key。
 * 模型与协议在选择供应商之后、由提示词面板底部的模型选择区单独维护，
 * 因此这里不再涉及协议、模型与思考参数。
 */

import { decodeApiKey, encodeApiKey, maskApiKey } from '../utils/base64.js';
import { clear, el, setButtonBusy } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { normalizeBaseUrl, validateBaseUrl } from '../utils/url.js';
import { toastError, toastSuccess, toastWarning } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 */
export function createSupplierModal(store) {
  const dialog = el('dialog', { class: 'modal modal--supplier' });
  /** 当前编辑的供应商 ID（null 表示新增） */
  let editingId = null;
  /** 已保存的 API Key（Base64） */
  let storedApiKeyB64 = '';
  /** 是否标记为清除已保存的 Key */
  let clearApiKey = false;

  /* --------------------------- 基础字段 --------------------------- */

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'supplier-name',
    placeholder: '例如：我的 Qwen API',
    maxLength: 60,
  });

  const baseUrlInput = el('input', {
    class: 'input',
    type: 'text',
    id: 'supplier-baseurl',
    placeholder: 'https://api.example.com/v1',
    spellcheck: false,
    autocomplete: 'off',
  });
  const baseUrlError = el('p', { class: 'field__error', hidden: true });
  const baseUrlHint = el('p', { class: 'field__hint' });

  const apiKeyInput = el('input', {
    class: 'input',
    type: 'password',
    id: 'supplier-apikey',
    placeholder: 'sk-…',
    autocomplete: 'new-password',
    spellcheck: false,
  });
  const apiKeyToggle = el('button', {
    class: 'btn btn--icon',
    type: 'button',
    title: '显示 / 隐藏',
    html: icon('eye', { size: 16 }),
    onClick: () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      apiKeyToggle.innerHTML = icon(isPassword ? 'eyeOff' : 'eye', { size: 16 });
    },
  });
  const apiKeyActions = el('div', { class: 'field__actions' });
  const apiKeyHint = el('p', { class: 'field__hint' });

  /* --------------------------- 底部按钮 --------------------------- */

  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit' });
  saveBtn.innerHTML = `${icon('save', { size: 15 })}<span>保存供应商</span>`;

  const titleNode = el('h2', { class: 'modal__title', text: '添加供应商' });

  const form = el(
    'form',
    {
      class: 'modal__card',
      onSubmit: (event) => {
        event.preventDefault();
        handleSave();
      },
    },
    [
      el('div', { class: 'modal__head' }, [
        titleNode,
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
          el('label', { for: 'supplier-name', text: '供应商名称' }),
          nameInput,
          el('p', { class: 'field__hint', text: '可留空：留空时会自动使用 Base URL 的域名作为名称。' }),
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'supplier-baseurl' }, ['Base URL', el('span', { class: 'req', text: '*' })]),
          baseUrlInput,
          baseUrlError,
          baseUrlHint,
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'supplier-apikey', text: 'API Key' }),
          el('div', { class: 'input-group' }, [apiKeyInput, apiKeyToggle]),
          apiKeyActions,
          apiKeyHint,
        ]),
        el('p', {
          class: 'field__hint',
          text: '保存后即可在提示词面板底部选择协议与模型。',
        }),
      ]),
      el('div', { class: 'modal__foot modal__foot--end' }, [
        el('div', { class: 'modal__foot-actions' }, [saveBtn]),
      ]),
    ],
  );

  dialog.appendChild(form);
  document.body.appendChild(dialog);

  /* --------------------------- 交互逻辑 --------------------------- */

  baseUrlInput.addEventListener('blur', () => {
    const raw = baseUrlInput.value.trim();
    if (!raw) return;
    const validation = validateBaseUrl(raw);
    if (validation.ok && validation.normalized !== raw) {
      baseUrlInput.value = validation.normalized;
    }
    renderBaseUrlHint();
  });
  baseUrlInput.addEventListener('input', () => {
    baseUrlError.hidden = true;
    renderBaseUrlHint();
  });

  /** 更新 Base URL 提示（规范化说明 / 风险提示） */
  function renderBaseUrlHint() {
    const raw = baseUrlInput.value.trim();
    if (!raw) {
      baseUrlHint.textContent = '会自动去掉末尾斜杠，并剥离重复的 /chat/completions、/responses、/messages、/models 后缀。';
      baseUrlHint.className = 'field__hint';
      return;
    }
    const validation = validateBaseUrl(raw);
    const normalized = normalizeBaseUrl(raw);
    const parts = [];
    if (normalized && normalized !== raw) parts.push(`将使用：${normalized}`);
    if (validation.warning) parts.push(validation.warning);
    baseUrlHint.textContent = parts.join('　');
    baseUrlHint.className = validation.warning ? 'field__hint field__hint--warning' : 'field__hint';
  }

  /** 渲染 API Key 相关的辅助操作与说明 */
  function renderApiKeyUI() {
    clear(apiKeyActions);

    if (editingId && storedApiKeyB64) {
      const storedPlain = decodeApiKey(storedApiKeyB64);
      apiKeyActions.appendChild(
        el('button', {
          class: 'link-btn',
          type: 'button',
          text: '显示已保存的 Key',
          onClick: () => {
            apiKeyInput.value = decodeApiKey(storedApiKeyB64);
            apiKeyInput.type = 'password';
            apiKeyToggle.innerHTML = icon('eye', { size: 16 });
            apiKeyInput.focus();
          },
        }),
      );
      apiKeyActions.appendChild(
        el('button', {
          class: 'link-btn',
          type: 'button',
          text: clearApiKey ? '取消清除' : '清除已保存的 Key',
          onClick: () => {
            clearApiKey = !clearApiKey;
            if (clearApiKey) apiKeyInput.value = '';
            renderApiKeyUI();
          },
        }),
      );
      apiKeyHint.textContent = clearApiKey
        ? '保存后将清除已保存的 API Key。'
        : `已保存：${maskApiKey(storedPlain)}（留空表示不修改）。Base64 只是编码格式，不是加密，不能防止他人读取。`;
      return;
    }

    if (editingId) {
      apiKeyHint.textContent = '当前供应商未保存 API Key。Base64 只是编码格式，不是加密，不能防止他人读取。';
    } else {
      apiKeyHint.textContent = 'Key 会以 Base64 编码后保存在浏览器本地。Base64 只是编码格式，不是加密，不能防止他人读取。';
    }
  }

  /** 取得用于保存的 Base64 Key */
  function resolveKeyForSave() {
    if (clearApiKey) return '';
    const typed = apiKeyInput.value.trim();
    if (typed) return encodeApiKey(typed);
    return storedApiKeyB64 || '';
  }

  async function handleSave() {
    const name = nameInput.value.trim();
    const raw = baseUrlInput.value.trim();

    baseUrlError.hidden = true;

    const validation = validateBaseUrl(raw);
    if (!validation.ok) {
      baseUrlError.textContent = validation.error;
      baseUrlError.hidden = false;
      return;
    }

    setButtonBusy(saveBtn, true, '保存中…');
    const { supplier, error } = await store.saveSupplier({
      id: editingId,
      name,
      baseUrl: validation.normalized || raw,
      apiKeyB64: resolveKeyForSave(),
    });
    setButtonBusy(saveBtn, false);

    if (error) {
      toastError('保存失败', error.message);
      return;
    }

    toastSuccess(editingId ? '供应商已更新' : '供应商已添加', supplier.name);
    if (validation.warning) toastWarning('Base URL 提示', validation.warning);
    close();
  }

  /** 用供应商数据回填表单 */
  function fillForm(supplier) {
    editingId = supplier?.id || null;
    storedApiKeyB64 = supplier?.apiKeyB64 || '';
    clearApiKey = false;

    titleNode.textContent = supplier ? '编辑供应商' : '添加供应商';
    nameInput.value = supplier?.name || '';
    baseUrlInput.value = supplier?.baseUrl || '';
    apiKeyInput.value = '';
    apiKeyInput.type = 'password';
    apiKeyToggle.innerHTML = icon('eye', { size: 16 });

    baseUrlError.hidden = true;

    renderBaseUrlHint();
    renderApiKeyUI();
  }

  function open(supplierId = null) {
    const supplier = supplierId ? store.getSupplier(supplierId) : null;
    fillForm(supplier);
    if (!dialog.open) dialog.showModal();
    setTimeout(() => nameInput.focus(), 30);
  }

  function close() {
    if (dialog.open) dialog.close();
    // 同步回状态，避免下一次 notify 又把弹窗打开
    if (store.state.modal.open) store.closeSupplierModal();
  }

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  // 订阅状态：外部通过 openSupplierModal / closeSupplierModal 控制
  store.subscribe((state) => {
    if (state.modal.open) {
      if (!dialog.open) open(state.modal.supplierId);
    } else if (dialog.open) {
      dialog.close();
    }
  });

  return {
    open,
    close,
    dialog,
    /** 供外部直接调用（例如空状态按钮） */
    openForCreate: () => store.openSupplierModal(null),
  };
}
