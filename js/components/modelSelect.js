/**
 * 模型选择区（内联在提示词面板底部操作栏，位于供应商选择之后）。
 *
 * - 协议下拉：chat / responses / messages，决定请求端点与请求体格式
 * - 模型输入：可手动输入，也可通过「获取模型」拉取候选
 * - 拉取失败时按当前协议展示默认模型建议
 *   （responses → GPT 系列、messages → Claude 系列、chat → 留空手填）
 * - 「思考」按钮打开思考参数弹窗
 *
 * 输入采用「本地输入 + blur 落库」策略：输入时只更新内存状态，
 * 避免 store 通知引发的重渲染把输入框内容覆盖掉。
 */

import { PROTOCOLS, THINKING_LEVELS, getProtocol } from '../config.js';
import { decodeApiKey } from '../utils/base64.js';
import { el, setButtonBusy } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { describeError } from '../services/http.js';
import { fetchModelList } from '../services/models.js';
import { createCombobox } from './combobox.js';
import { createThinkingModal } from './thinkingModal.js';
import { toastError, toastSuccess } from './toast.js';

const LEVEL_LABELS = THINKING_LEVELS.reduce((acc, item) => {
  acc[item.value] = item.label.replace('（不发送思考参数）', '');
  return acc;
}, /** @type {Record<string,string>} */ ({}));

/**
 * @param {import('../store/state.js').store} store
 */
export function createModelSelect(store) {
  /** 已拉取到的模型列表缓存（仅内存，按供应商 ID 区分） */
  const modelCache = new Map();
  const thinkingModal = createThinkingModal(store);

  let fetching = false;
  /** @type {AbortController|null} */
  let abortController = null;
  /** 上一次渲染的供应商 ID（用于判断是否需要回填输入框） */
  let renderedSupplierId = null;

  /* --------------------------- 控件 --------------------------- */

  const protocolSelect = el(
    'select',
    {
      class: 'select select--compact',
      title: '接口协议',
      onChange: (event) => handleProtocolChange(event.target.value),
    },
    PROTOCOLS.map((item) => el('option', { value: item.value, text: item.label })),
  );

  const modelCombobox = createCombobox({
    id: 'model-select-input',
    placeholder: '模型名称，例如 gpt-6-astra',
    onChange: (value) => {
      const supplier = store.getCurrentSupplier();
      if (supplier) store.patchSupplierModel(supplier.id, { model: value });
    },
  });
  modelCombobox.input.addEventListener('blur', () => {
    const supplier = store.getCurrentSupplier();
    if (supplier) store.persistSupplier(supplier.id);
  });

  const fetchBtn = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    title: '从 {Base URL}/models 拉取模型列表',
    onClick: () => handleFetchModels(),
  });
  fetchBtn.innerHTML = `${icon('refresh', { size: 14 })}<span>获取模型</span>`;

  const thinkingBtn = el('button', {
    class: 'btn btn--sm',
    type: 'button',
    onClick: () => {
      const supplier = store.getCurrentSupplier();
      if (supplier) thinkingModal.open(supplier.id);
    },
  });

  const statusNode = el('span', { class: 'prompt__model-status' });

  const root = el('div', { class: 'prompt__model-select' }, [
    protocolSelect,
    modelCombobox.root,
    fetchBtn,
    thinkingBtn,
    statusNode,
  ]);

  /* --------------------------- 交互逻辑 --------------------------- */

  function setStatus(text, tone = 'muted') {
    const message = text || '';
    statusNode.textContent = message;
    statusNode.title = message;
    statusNode.className = `prompt__model-status is-${tone}`;
  }

  /** 当前协议下应当展示的候选模型 */
  function optionsFor(supplier) {
    const fetched = modelCache.get(supplier.id);
    if (fetched && fetched.length) return { list: fetched, fromFetch: true };
    return { list: getProtocol(supplier.protocol).defaultModels, fromFetch: false };
  }

  function handleProtocolChange(value) {
    const supplier = store.getCurrentSupplier();
    if (!supplier) return;

    store.patchSupplierModel(supplier.id, { protocol: value });
    store.persistSupplier(supplier.id);

    const meta = getProtocol(value);
    const fetched = modelCache.get(supplier.id);
    if (fetched && fetched.length) {
      modelCombobox.setOptions(fetched);
      setStatus(`候选模型来自已拉取的列表（${fetched.length} 个）。`);
    } else if (meta.defaultModels.length) {
      modelCombobox.setOptions(meta.defaultModels);
      setStatus('尚未拉取模型列表，已展示该协议的默认模型建议。');
    } else {
      modelCombobox.setOptions([]);
      setStatus('该协议没有默认模型建议，请手动输入模型 ID。');
    }
  }

  async function handleFetchModels() {
    const supplier = store.getCurrentSupplier();
    if (!supplier || fetching) return;

    fetching = true;
    abortController = new AbortController();
    setButtonBusy(fetchBtn, true, '获取中…');
    setStatus('正在请求模型列表接口…', 'loading');

    try {
      const { models, host } = await fetchModelList({
        baseUrl: supplier.baseUrl,
        apiKey: decodeApiKey(supplier.apiKeyB64),
        protocol: supplier.protocol || 'chat',
        signal: abortController.signal,
      });
      modelCache.set(supplier.id, models);
      modelCombobox.setOptions(models);
      setStatus(`获取成功：共 ${models.length} 个模型（${host}）。`, 'ok');
      store.setSupplierConnection(supplier.id, {
        status: 'ok',
        message: `已获取模型列表（${models.length} 个）`,
        testedAt: Date.now(),
      });
      toastSuccess('已获取模型列表', `共 ${models.length} 个模型`);
      modelCombobox.input.focus();
    } catch (error) {
      const info = describeError(error);
      if (info.kind === 'canceled') {
        setStatus('已取消获取模型列表。');
      } else {
        const fallback = optionsFor(supplier);
        modelCombobox.setOptions(fallback.list);
        const fallbackText = fallback.list.length
          ? '已展示该协议的默认模型建议，也可以直接手动输入模型 ID。'
          : '请直接手动输入模型 ID。';
        setStatus(`${info.message}${info.detail ? ` ${info.detail}` : ''} ${fallbackText}`, 'error');
        store.setSupplierConnection(supplier.id, {
          status: 'error',
          message: [info.message, info.detail].filter(Boolean).join(' ').slice(0, 300),
          testedAt: Date.now(),
        });
        toastError('获取模型列表失败', fallbackText);
      }
    } finally {
      fetching = false;
      abortController = null;
      setButtonBusy(fetchBtn, false);
    }
  }

  /* --------------------------- 渲染 --------------------------- */

  function render() {
    const supplier = store.getCurrentSupplier();

    if (!supplier) {
      renderedSupplierId = null;
      setStatus('');
      return;
    }

    const protocol = getProtocol(supplier.protocol).value;
    if (protocolSelect.value !== protocol) protocolSelect.value = protocol;

    if (renderedSupplierId !== supplier.id) {
      // 切换供应商：回填该供应商保存的模型与候选列表
      renderedSupplierId = supplier.id;
      modelCombobox.setValue(supplier.model || '');
      modelCombobox.setOptions(optionsFor(supplier).list);
      setStatus('');
    } else if (document.activeElement !== modelCombobox.input) {
      // 外部改动了模型（例如保存时的规范化）且输入框未聚焦时才回填，避免打断输入
      const expected = supplier.model || '';
      if (modelCombobox.getValue() !== expected) modelCombobox.setValue(expected);
    }

    const thinking = supplier.thinking || {};
    const level = thinking.level || 'auto';
    const active = Boolean(thinking.enabled) && level !== 'auto';
    thinkingBtn.innerHTML = `${icon('wand', { size: 14 })}<span>思考 ${LEVEL_LABELS[level] || '自动'}</span>`;
    thinkingBtn.classList.toggle('is-on', active);
    thinkingBtn.title = active
      ? `已开启思考参数：${thinking.paramName || '未配置参数名'}（等级：${LEVEL_LABELS[level]}）`
      : '配置思考等级与参数（默认不发送任何思考参数）';
  }

  store.subscribe(render);

  return { root, render };
}
