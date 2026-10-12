/**
 * 应用状态与数据动作。
 *
 * 采用极简的「单一状态 + 订阅重渲染」模型，组件订阅变化后重绘自己的区域。
 * 所有持久化都通过 store/db.js 完成，这里只负责维护内存中的一致视图。
 */

import { DEFAULT_PROTOCOL, HISTORY_LIMIT, createDefaultThinking, getProtocol } from '../config.js';
import { uid, truncate } from '../utils/dom.js';
import * as i18n from '../utils/i18n.js';
import { t } from '../utils/i18n.js';
import * as db from './db.js';

/** @typedef {ReturnType<typeof createInitialState>} AppState */

function createInitialState() {
  return {
    /** 初始化是否完成 */
    ready: false,
    /** 存储模式：indexeddb | memory */
    storageMode: /** @type {'indexeddb'|'memory'} */ ('indexeddb'),
    /** 存储层初始化错误（用于顶部提示） */
    storageError: /** @type {Error|null} */ (null),

    /** 当前界面语言（zh | en），语言真值由 utils/i18n.js 持有 */
    locale: i18n.getLocale(),

    /** @type {any[]} 供应商列表 */
    suppliers: [],
    /** @type {string|null} 当前选中的供应商 ID */
    currentSupplierId: null,

    /** @type {any[]} 历史记录（最新在前） */
    history: [],
    /** @type {string|null} 当前展示的历史记录 ID */
    activeHistoryId: null,

    /** 提示词草稿（外部恢复历史时通过 promptRevision 通知输入框同步） */
    prompt: t('prompt.example'),
    promptRevision: 0,

    /** 请求运行状态 */
    run: {
      status: /** @type {'idle'|'running'|'success'|'error'|'canceled'} */ ('idle'),
      startedAt: 0,
      error: /** @type {{message: string, hint: string, detail: string, kind: string}|null} */ (null),
      note: '',
    },

    /** 当前展示的结果（与历史记录同构） */
    result: /** @type {any|null} */ (null),

    /** 供应商弹窗状态 */
    modal: { open: false, supplierId: /** @type {string|null} */ (null) },
  };
}

const state = createInitialState();
const listeners = new Set();

/** 订阅状态变化，返回取消订阅函数 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      // 单个组件渲染失败不应影响其他组件
      console.error('[state] 组件渲染异常：', error);
    }
  }
}

function patch(partial) {
  Object.assign(state, partial);
  notify();
}

/** 统一的错误提示文本 */
function describeStorageFailure(error) {
  if (error && error.kind === 'quota') {
    return t('storage.quota');
  }
  return (error && error.message) || t('storage.failed');
}

/**
 * 判断一条历史记录是否符合「只保存成功图片」的规则。
 * 旧版本会写入请求失败 / 未解析出 SVG 的记录，这里用于清理。
 * @param {any} record
 */
function isSavedHistoryRecord(record) {
  return Boolean(record && record.status === 'success' && record.svgSanitized);
}

/**
 * 供应商名称留空时的兜底：用 Base URL 的域名命名，重名时追加序号。
 * @param {string} baseUrl
 * @param {any[]} suppliers
 * @param {string|null} excludeId 编辑时排除自身，避免和自己重名
 */
function deriveSupplierName(baseUrl, suppliers, excludeId = null) {
  let host = '';
  try {
    host = new URL(baseUrl).host;
  } catch (error) {
    host = '';
  }
  const base = host || t('common.unnamedProvider');
  const taken = new Set(suppliers.filter((item) => item.id !== excludeId).map((item) => item.name));
  if (!taken.has(base)) return base;

  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

export const store = {
  get state() {
    return state;
  },

  subscribe,

  /* ---------------------------------------------------------------- *
   * 界面语言
   * ---------------------------------------------------------------- */

  /**
   * 切换界面语言：更新 i18n 模块（含 localStorage 持久化与 <html lang>）并触发重渲染。
   * @param {string} next zh | en
   */
  setLocale(next) {
    const locale = i18n.setLocale(next);
    if (locale === state.locale) return locale;
    state.locale = locale;
    notify();
    return locale;
  },

  /* ---------------------------------------------------------------- *
   * 初始化
   * ---------------------------------------------------------------- */

  async init() {
    const { mode, error } = await db.initStorage();
    state.storageMode = mode;
    state.storageError = error;

    let suppliers = [];
    let history = [];
    let settings = {};
    let loadError = null;

    try {
      [suppliers, history, settings] = await Promise.all([
        db.loadSuppliers(),
        db.loadHistory(),
        db.loadSettings(),
      ]);
    } catch (err) {
      loadError = err;
    }

    // 归一化历史遗留字段：旧版本的 protocol 为 'openai'，现在统一为 'chat'
    state.suppliers = suppliers.map((item) => ({
      ...item,
      protocol: getProtocol(item.protocol).value,
    }));

    // 历史只保留成功生成图片的记录：清理旧版本遗留的失败 / 解析失败记录
    const keptHistory = history.filter(isSavedHistoryRecord);
    const staleHistory = history.filter((item) => !isSavedHistoryRecord(item));
    if (staleHistory.length) {
      try {
        await Promise.all(staleHistory.map((item) => db.deleteHistoryRecord(item.id)));
      } catch (error) {
        // 清理失败不影响使用：内存中已按新规则过滤
      }
    }
    state.history = keptHistory.slice(0, HISTORY_LIMIT);

    // 恢复上次选中的供应商；若已不存在则退回第一个
    const savedId = settings.currentSupplierId;
    const exists = savedId && state.suppliers.some((item) => item.id === savedId);
    state.currentSupplierId = exists ? savedId : state.suppliers[0]?.id || null;

    state.ready = true;
    state.run = { status: 'idle', startedAt: 0, error: null, note: '' };
    notify();

    return { loadError };
  },

  /* ---------------------------------------------------------------- *
   * 供应商
   * ---------------------------------------------------------------- */

  getSupplier(id) {
    return state.suppliers.find((item) => item.id === id) || null;
  },

  getCurrentSupplier() {
    return store.getSupplier(state.currentSupplierId);
  },

  /**
   * 新增或更新供应商。
   * 未提供的字段一律保留原值：模型、协议、思考配置现在由「模型选择区」单独维护。
   * @param {{
   *   id?: string|null, name?: string, baseUrl: string, apiKeyB64?: string,
   *   model?: string, protocol?: string, thinking?: object,
   *   connection?: object, createdAt?: number,
   * }} input
   * @returns {Promise<{supplier: any, error: Error|null}>}
   */
  async saveSupplier(input) {
    const now = Date.now();
    const existing = input.id ? store.getSupplier(input.id) : null;
    const baseUrl = String(input.baseUrl || '').trim();
    const rawName = String(input.name || '').trim();

    const record = {
      id: existing?.id || input.id || uid('sup'),
      name: rawName || deriveSupplierName(baseUrl, state.suppliers, existing?.id || null),
      baseUrl,
      apiKeyB64: input.apiKeyB64 !== undefined ? input.apiKeyB64 : existing?.apiKeyB64 || '',
      model: input.model !== undefined ? String(input.model || '').trim() : existing?.model || '',
      protocol:
        input.protocol !== undefined
          ? getProtocol(input.protocol).value
          : existing?.protocol || DEFAULT_PROTOCOL,
      thinking:
        input.thinking !== undefined ? input.thinking : existing?.thinking || createDefaultThinking(),
      connection:
        input.connection !== undefined
          ? input.connection
          : existing?.connection || { status: 'untested', message: '', testedAt: null },
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: now,
    };

    try {
      await db.putSupplierRecord(record);
    } catch (error) {
      return { supplier: null, error: new Error(describeStorageFailure(error)) };
    }

    const index = state.suppliers.findIndex((item) => item.id === record.id);
    if (index >= 0) state.suppliers[index] = record;
    else state.suppliers = [...state.suppliers, record];

    state.currentSupplierId = record.id;
    try {
      await db.saveSetting('currentSupplierId', record.id);
    } catch (error) {
      // 选中态保存失败不影响主流程，只在内存中保持
    }

    notify();
    return { supplier: record, error: null };
  },

  /**
   * 只更新内存中的模型 / 协议选择（输入过程中高频调用，不写库、不打断输入）。
   * @param {string} id
   * @param {{model?: string, protocol?: string}} patch
   */
  patchSupplierModel(id, patch) {
    const supplier = store.getSupplier(id);
    if (!supplier) return;
    if (patch.model !== undefined) supplier.model = String(patch.model || '').trim();
    if (patch.protocol !== undefined) supplier.protocol = getProtocol(patch.protocol).value;
    notify();
  },

  /** 把供应商记录落库（模型输入完成、切换协议后调用） */
  async persistSupplier(id) {
    const supplier = store.getSupplier(id);
    if (!supplier) return { error: null };
    supplier.updatedAt = Date.now();
    try {
      await db.putSupplierRecord(supplier);
      return { error: null };
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }
  },

  /** 保存思考配置（思考弹窗点「完成」时调用） */
  async setSupplierThinking(id, thinking) {
    const supplier = store.getSupplier(id);
    if (!supplier) return { error: null };
    supplier.thinking = thinking || createDefaultThinking();
    supplier.updatedAt = Date.now();
    try {
      await db.putSupplierRecord(supplier);
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }
    notify();
    return { error: null };
  },

  /**
   * 删除供应商。
   * 只删除配置本身，历史记录会完整保留（历史里存的是当时的快照）。
   * @param {string} id
   */
  async deleteSupplier(id) {
    try {
      await db.deleteSupplierRecord(id);
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }

    state.suppliers = state.suppliers.filter((item) => item.id !== id);

    if (state.currentSupplierId === id) {
      // 优先选择列表中的下一个，没有则回到未配置状态
      const next = state.suppliers[0] || null;
      state.currentSupplierId = next ? next.id : null;
      try {
        await db.saveSetting('currentSupplierId', state.currentSupplierId);
      } catch (error) {
        // 忽略：内存状态已更新
      }
    }

    notify();
    return { error: null };
  },

  /** 切换当前供应商 */
  async selectSupplier(id) {
    if (id === state.currentSupplierId) return;
    state.currentSupplierId = id;
    notify();
    try {
      await db.saveSetting('currentSupplierId', id);
    } catch (error) {
      // 忽略：内存状态已更新
    }
  },

  /** 更新供应商的连接状态 */
  async setSupplierConnection(id, connection) {
    const supplier = store.getSupplier(id);
    if (!supplier) return;
    supplier.connection = connection;
    supplier.updatedAt = Date.now();
    try {
      await db.putSupplierRecord(supplier);
    } catch (error) {
      // 状态写入失败不阻塞流程
    }
    notify();
  },

  /* ---------------------------------------------------------------- *
   * 历史记录
   * ---------------------------------------------------------------- */

  /**
   * 写入一条历史记录并刷新列表（自动淘汰最旧记录）。
   * @param {object} record
   */
  async addHistory(record) {
    try {
      const { list } = await db.insertHistoryRecord(record, HISTORY_LIMIT);
      state.history = list;
      notify();
      return { error: null };
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }
  },

  /** 删除单条历史 */
  async deleteHistory(id) {
    try {
      await db.deleteHistoryRecord(id);
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }
    state.history = state.history.filter((item) => item.id !== id);
    if (state.activeHistoryId === id) state.activeHistoryId = null;
    notify();
    return { error: null };
  },

  /** 清空历史（不会动供应商配置） */
  async clearHistory() {
    try {
      await db.clearHistoryRecords();
    } catch (error) {
      return { error: new Error(describeStorageFailure(error)) };
    }
    state.history = [];
    state.activeHistoryId = null;
    notify();
    return { error: null };
  },

  /**
   * 打开历史记录：直接恢复提示词、原始输出与 SVG 预览，不重新请求接口。
   * @param {string} id
   */
  openHistory(id) {
    const record = state.history.find((item) => item.id === id);
    if (!record) return { error: new Error(t('storage.historyNotFound')) };

    state.activeHistoryId = id;
    state.result = record;
    state.prompt = record.prompt || '';
    state.promptRevision += 1;
    state.run = {
      status: record.status === 'error' ? 'error' : 'success',
      startedAt: 0,
      error: record.error
        ? { message: record.error, hint: '', detail: '', kind: 'history' }
        : null,
      note: '',
    };
    notify();
    return { error: null };
  },

  /* ---------------------------------------------------------------- *
   * 运行状态与结果
   * ---------------------------------------------------------------- */

  /** 设置提示词并通知输入框同步（用于恢复历史、载入示例等外部来源） */
  setPrompt(text) {
    state.prompt = text;
    state.promptRevision += 1;
    notify();
  },

  /** 仅记录最近一次使用的提示词，不覆盖输入框内容 */
  setPromptQuiet(text) {
    state.prompt = text;
    notify();
  },

  setRun(runPatch) {
    state.run = { ...state.run, ...runPatch };
    notify();
  },

  setResult(result) {
    state.result = result;
    if (result && result.id) state.activeHistoryId = result.id;
    notify();
  },

  /** 构建一条历史记录对象 */
  buildHistoryRecord(input) {
    return {
      id: uid('hist'),
      title: truncate(input.prompt || t('common.untitledTest'), 60),
      prompt: input.prompt || '',
      rawResponse: input.rawResponse || '',
      svgSource: input.svgSource || null,
      svgSanitized: input.svgSanitized || null,
      parse: input.parse || { ok: false, strategy: null, error: null, removed: [] },
      supplierId: input.supplierId || null,
      supplierName: input.supplierName || t('common.notRecorded'),
      model: input.model || '',
      protocol: input.protocol || '',
      thinkingLevel: input.thinkingLevel || 'auto',
      thinkingNote: input.thinkingNote || '',
      endpoint: input.endpoint || '',
      createdAt: input.createdAt || Date.now(),
      durationMs: input.durationMs ?? null,
      status: input.status || 'success',
      error: input.error || null,
      usage: input.usage || null,
      finishReason: input.finishReason || null,
    };
  },

  /* ---------------------------------------------------------------- *
   * 弹窗
   * ---------------------------------------------------------------- */

  openSupplierModal(supplierId = null) {
    state.modal = { open: true, supplierId: supplierId || null };
    notify();
  },

  closeSupplierModal() {
    state.modal = { open: false, supplierId: null };
    notify();
  },

  /* ---------------------------------------------------------------- *
   * 数据导出
   * ---------------------------------------------------------------- */

  /**
   * 导出本地数据为 JSON。
   * 出于安全考虑，默认不包含 API Key（连 Base64 后的内容也不导出）。
   */
  buildExportPayload() {
    return {
      app: 'pelican-test-web',
      exportedAt: new Date().toISOString(),
      note: t('storage.exportNote'),
      currentSupplierId: state.currentSupplierId,
      suppliers: state.suppliers.map((supplier) => {
        const { apiKeyB64, ...rest } = supplier;
        return { ...rest, hasApiKey: Boolean(apiKeyB64) };
      }),
      history: state.history,
    };
  },
};
