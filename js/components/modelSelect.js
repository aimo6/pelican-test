/**
 * 模型选择区（内联在提示词面板底部操作栏，位于供应商选择之后）。
 *
 * - 协议下拉：chat / responses / messages，决定请求端点与请求体格式
 * - 模型输入：可手动输入；输入框右侧的箭头按钮每次展开都会重新拉取模型列表，
 *   避免服务端已更新而前端仍展示旧列表；拉取结果按供应商 ID 归档，互不串扰
 * - 思考下拉：默认不发送思考参数，可选 low / medium / high / xhigh / max，
 *   发送形式按协议映射（见 services/inference.js）
 *
 * 输入采用「本地输入 + blur 落库」策略：输入时只更新内存状态，
 * 避免 store 通知引发的重渲染把输入框内容覆盖掉。
 */

import { PROTOCOLS, THINKING_LEVELS, getProtocol, getThinkingLevel } from '../config.js';
import { decodeApiKey } from '../utils/base64.js';
import { el } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import { describeError } from '../services/http.js';
import { fetchModelList } from '../services/models.js';
import { createCombobox } from './combobox.js';
import { createSelect } from './select.js';
import { toastError } from './toast.js';

/** 协议候选项（label 按当前语言解析） */
const protocolOptions = () => PROTOCOLS.map((item) => ({ value: item.value, label: t(item.labelKey) }));

/** 思考等级候选项（label 按当前语言解析） */
const thinkingOptions = () => THINKING_LEVELS.map((item) => ({ value: item.value, label: t(item.labelKey) }));

/**
 * @param {import('../store/state.js').store} store
 */
export function createModelSelect(store) {
  /** 已拉取到的模型列表缓存（仅内存，按供应商 ID 区分） */
  const modelCache = new Map();
  /** 正在拉取中的供应商 ID：同一供应商不重复请求，不同供应商互不阻塞 */
  const fetchingIds = new Set();

  /** 上一次渲染的供应商 ID（用于判断是否需要回填输入框） */
  let renderedSupplierId = null;

  /* --------------------------- 控件 --------------------------- */

  const protocolSelect = createSelect({
    title: t('model.protocolTitle'),
    value: PROTOCOLS[0].value,
    options: protocolOptions(),
    onChange: (value) => handleProtocolChange(value),
  });

  const modelCombobox = createCombobox({
    id: 'model-select-input',
    placeholder: t('model.placeholder'),
    onChange: (value) => {
      const supplier = store.getCurrentSupplier();
      if (supplier) store.patchSupplierModel(supplier.id, { model: value });
    },
  });
  modelCombobox.input.addEventListener('blur', () => {
    const supplier = store.getCurrentSupplier();
    if (supplier) store.persistSupplier(supplier.id);
  });

  /** 模型输入框右侧的箭头：每次展开都重新拉取模型列表并展开候选 */
  const fetchToggle = el('button', {
    class: 'combo__toggle',
    type: 'button',
    title: t('model.fetchTitle'),
    html: icon('chevronDown', { size: 15 }),
    onClick: () => handleToggleList(),
  });
  modelCombobox.root.appendChild(fetchToggle);

  const thinkingSelect = createSelect({
    title: t('model.thinkingTitle'),
    value: THINKING_LEVELS[0].value,
    options: thinkingOptions(),
    onChange: (value) => handleThinkingChange(value),
  });

  const root = el('div', { class: 'prompt__model-select' }, [
    protocolSelect.root,
    modelCombobox.root,
    thinkingSelect.root,
  ]);

  /* --------------------------- 交互逻辑 --------------------------- */

  /** 当前协议下应当展示的候选模型 */
  function optionsFor(supplier) {
    const fetched = modelCache.get(supplier.id);
    if (fetched && fetched.length) return fetched;
    return getProtocol(supplier.protocol).defaultModels;
  }

  function handleProtocolChange(value) {
    const supplier = store.getCurrentSupplier();
    if (!supplier) return;

    store.patchSupplierModel(supplier.id, { protocol: value });
    store.persistSupplier(supplier.id);
    modelCombobox.setOptions(optionsFor(supplier));
  }

  function handleThinkingChange(level) {
    const supplier = store.getCurrentSupplier();
    if (!supplier) return;
    store.setSupplierThinking(supplier.id, { level: getThinkingLevel(level) });
  }

  function setFetchBusy(busy) {
    fetchToggle.disabled = busy;
    fetchToggle.innerHTML = busy
      ? icon('loader', { size: 15, className: 'spin' })
      : icon('chevronDown', { size: 15 });
  }

  /** 箭头按钮：展开 / 收起候选列表；每次展开都重新拉取，保证列表与服务器一致 */
  async function handleToggleList() {
    const supplier = store.getCurrentSupplier();
    if (!supplier) return;

    if (modelCombobox.isOpen()) {
      modelCombobox.close();
      return;
    }

    await fetchModels();
  }

  /**
   * 拉取当前供应商的模型列表。
   *
   * 结果按「发起请求时的供应商 ID」归档：请求期间若用户切换了供应商，
   * 只更新该供应商的缓存与连接状态，绝不写入当前下拉框，避免列表互串。
   */
  async function fetchModels() {
    const supplier = store.getCurrentSupplier();
    if (!supplier || fetchingIds.has(supplier.id)) return;

    const supplierId = supplier.id;
    fetchingIds.add(supplierId);
    setFetchBusy(true);

    try {
      const { models } = await fetchModelList({
        baseUrl: supplier.baseUrl,
        apiKey: decodeApiKey(supplier.apiKeyB64),
        protocol: supplier.protocol || 'chat',
      });
      modelCache.set(supplierId, models);
      store.setSupplierConnection(supplierId, {
        status: 'ok',
        message: t('model.fetchSuccess', { n: models.length }),
        testedAt: Date.now(),
      });
      // 请求期间已切换供应商：结果只留在缓存里，不回写到当前下拉框
      if (store.state.currentSupplierId !== supplierId) return;
      // 刚拉取到的完整列表要全部展示，不能被输入框里已填的模型名过滤掉
      modelCombobox.setOptions(models);
      modelCombobox.openUnfiltered();
    } catch (error) {
      const info = describeError(error);
      if (info.kind === 'canceled') return;
      store.setSupplierConnection(supplierId, {
        status: 'error',
        message: [info.message, info.detail].filter(Boolean).join(' ').slice(0, 300),
        testedAt: Date.now(),
      });
      if (store.state.currentSupplierId !== supplierId) return;
      modelCombobox.setOptions(optionsFor(supplier));
      toastError(t('model.fetchFailed'), [info.message, info.detail].filter(Boolean).join(' '));
      modelCombobox.openUnfiltered();
    } finally {
      fetchingIds.delete(supplierId);
      setFetchBusy(fetchingIds.has(store.state.currentSupplierId));
    }
  }

  /* --------------------------- 渲染 --------------------------- */

  /** 语言变化时更新下拉标题、候选项与占位符（保留输入值与模型缓存） */
  let renderedLocale = null;
  function applyLocaleIfNeeded() {
    if (store.state.locale === renderedLocale) return;
    renderedLocale = store.state.locale;
    protocolSelect.trigger.title = t('model.protocolTitle');
    thinkingSelect.trigger.title = t('model.thinkingTitle');
    fetchToggle.title = t('model.fetchTitle');
    modelCombobox.input.placeholder = t('model.placeholder');
    protocolSelect.setOptions(protocolOptions());
    thinkingSelect.setOptions(thinkingOptions());
  }

  function render() {
    applyLocaleIfNeeded();

    const supplier = store.getCurrentSupplier();

    if (!supplier) {
      renderedSupplierId = null;
      return;
    }

    const protocol = getProtocol(supplier.protocol).value;
    if (protocolSelect.getValue() !== protocol) protocolSelect.setValue(protocol);

    if (renderedSupplierId !== supplier.id) {
      // 切换供应商：回填该供应商保存的模型与候选列表，并同步拉取按钮状态
      renderedSupplierId = supplier.id;
      modelCombobox.setValue(supplier.model || '');
      modelCombobox.setOptions(optionsFor(supplier));
      setFetchBusy(fetchingIds.has(supplier.id));
    } else if (document.activeElement !== modelCombobox.input) {
      // 外部改动了模型（例如保存时的规范化）且输入框未聚焦时才回填，避免打断输入
      const expected = supplier.model || '';
      if (modelCombobox.getValue() !== expected) modelCombobox.setValue(expected);
    }

    const level = getThinkingLevel(supplier.thinking?.level);
    if (thinkingSelect.getValue() !== level) thinkingSelect.setValue(level);
  }

  store.subscribe(render);

  return { root, render };
}
