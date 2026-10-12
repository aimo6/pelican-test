/**
 * 供应商新增 / 编辑弹窗。
 *
 * 只维护「接入信息」：名称（可选）、Base URL、API Key。
 * 模型与协议在选择供应商之后、由提示词面板底部的模型选择区单独维护，
 * 因此这里不再涉及协议、模型与思考参数。
 *
 * 语言切换：静态文案统一由 applyLocaleTexts() 更新，绝不调用 fillForm、
 * 不触碰输入框的 value，避免把用户未保存的输入清掉。
 */

import { decodeApiKey, encodeApiKey, maskApiKey } from '../utils/base64.js';
import { clear, el, setButtonBusy } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
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
    placeholder: t('modal.namePlaceholder'),
    maxLength: 60,
  });
  const nameLabel = el('label', { for: 'supplier-name', text: t('modal.nameLabel') });

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
    title: t('modal.apiKeyToggle'),
    html: icon('eye', { size: 16 }),
    onClick: () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      apiKeyToggle.innerHTML = icon(isPassword ? 'eyeOff' : 'eye', { size: 16 });
    },
  });
  const apiKeyActions = el('div', { class: 'field__actions' });
  const apiKeyHint = el('p', { class: 'field__hint' });
  const apiKeyLabel = el('label', { for: 'supplier-apikey', text: t('modal.apiKeyLabel') });

  /* --------------------------- 底部按钮 --------------------------- */

  const saveBtn = el('button', { class: 'btn btn--primary', type: 'submit' });
  const closeBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    title: t('common.close'),
    html: icon('x', { size: 16 }),
    onClick: () => close(),
  });

  const titleNode = el('h2', { class: 'modal__title', text: t('modal.addTitle') });

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
      el('div', { class: 'modal__head' }, [titleNode, closeBtn]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'field' }, [nameLabel, nameInput]),
        el('div', { class: 'field' }, [
          el('label', { for: 'supplier-baseurl' }, ['Base URL', el('span', { class: 'req', text: '*' })]),
          baseUrlInput,
          baseUrlError,
          baseUrlHint,
        ]),
        el('div', { class: 'field' }, [
          apiKeyLabel,
          el('div', { class: 'input-group' }, [apiKeyInput, apiKeyToggle]),
          apiKeyActions,
          apiKeyHint,
        ]),
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

  /** 更新 Base URL 提示（规范化结果 / 风险提示） */
  function renderBaseUrlHint() {
    const raw = baseUrlInput.value.trim();
    const validation = raw ? validateBaseUrl(raw) : null;
    const normalized = raw ? normalizeBaseUrl(raw) : '';
    const parts = [];
    if (raw && normalized && normalized !== raw) parts.push(t('modal.baseUrlWillUse', { url: normalized }));
    if (validation && validation.warning) parts.push(validation.warning);
    baseUrlHint.textContent = parts.join('　');
    baseUrlHint.className = validation && validation.warning ? 'field__hint field__hint--warning' : 'field__hint';
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
          text: t('modal.showStoredKey'),
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
          text: clearApiKey ? t('modal.cancelClearKey') : t('modal.clearStoredKey'),
          onClick: () => {
            clearApiKey = !clearApiKey;
            if (clearApiKey) apiKeyInput.value = '';
            renderApiKeyUI();
          },
        }),
      );
      apiKeyHint.textContent = clearApiKey
        ? t('modal.apiKeyClearPending')
        : t('modal.apiKeySaved', { mask: maskApiKey(storedPlain) });
      return;
    }

    apiKeyHint.textContent = t('modal.apiKeyHint');
  }

  /** 更新弹窗内的静态文案（不触碰任何输入框内容） */
  function applyLocaleTexts() {
    titleNode.textContent = editingId ? t('modal.editTitle') : t('modal.addTitle');
    closeBtn.title = t('common.close');
    nameLabel.textContent = t('modal.nameLabel');
    nameInput.placeholder = t('modal.namePlaceholder');
    apiKeyLabel.textContent = t('modal.apiKeyLabel');
    apiKeyToggle.title = t('modal.apiKeyToggle');
    saveBtn.innerHTML = `${icon('save', { size: 15 })}<span>${t('modal.save')}</span>`;
    renderApiKeyUI();
    renderBaseUrlHint();
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

    setButtonBusy(saveBtn, true, t('common.processingSave'));
    const { supplier, error } = await store.saveSupplier({
      id: editingId,
      name,
      baseUrl: validation.normalized || raw,
      apiKeyB64: resolveKeyForSave(),
    });
    setButtonBusy(saveBtn, false);

    if (error) {
      toastError(t('modal.saveFailed'), error.message);
      return;
    }

    toastSuccess(editingId ? t('modal.savedEdit') : t('modal.savedAdd'), supplier.name);
    if (validation.warning) toastWarning(t('modal.baseUrlWarning'), validation.warning);
    close();
  }

  /** 用供应商数据回填表单 */
  function fillForm(supplier) {
    editingId = supplier?.id || null;
    storedApiKeyB64 = supplier?.apiKeyB64 || '';
    clearApiKey = false;

    nameInput.value = supplier?.name || '';
    baseUrlInput.value = supplier?.baseUrl || '';
    apiKeyInput.value = '';
    apiKeyInput.type = 'password';
    apiKeyToggle.innerHTML = icon('eye', { size: 16 });

    baseUrlError.hidden = true;

    applyLocaleTexts();
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
  let renderedLocale = null;
  store.subscribe((state) => {
    if (state.modal.open) {
      if (!dialog.open) open(state.modal.supplierId);
    } else if (dialog.open) {
      dialog.close();
    }

    if (state.locale !== renderedLocale) {
      renderedLocale = state.locale;
      applyLocaleTexts();
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
