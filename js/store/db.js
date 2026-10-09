/**
 * IndexedDB 存储模块。
 *
 * 所有本地持久化操作都收敛在这里，上层只调用语义化的函数。
 * 设计要点：
 * - 供应商、设置、历史记录分三个对象仓库（object store）
 * - IndexedDB 不可用（隐私模式 / 浏览器禁用 / file:// 受限）时降级为内存存储，
 *   保证页面仍可使用，同时把降级原因暴露给 UI 做提示
 * - 存储空间不足等写入失败会转成带中文说明的 StorageError
 */

import { DB_NAME, DB_VERSION, HISTORY_LIMIT } from '../config.js';

export class StorageError extends Error {
  /**
   * @param {string} message
   * @param {{kind?: string, cause?: any}} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'StorageError';
    /** @type {string} unavailable | quota | read | write | unknown */
    this.kind = options.kind || 'unknown';
    this.cause = options.cause;
  }
}

/** 三个对象仓库：供应商配置、键值设置、测试历史 */
const STORE_SUPPLIERS = 'suppliers';
const STORE_SETTINGS = 'settings';
const STORE_HISTORY = 'history';

/** @type {'indexeddb'|'memory'} */
let mode = 'indexeddb';
let dbPromise = null;

/** 内存降级存储 */
const memory = {
  suppliers: new Map(),
  settings: new Map(),
  history: new Map(),
};

/** 判断当前环境是否支持 IndexedDB */
function isIndexedDbSupported() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch (error) {
    return false;
  }
}

/** 把底层异常翻译成可读的 StorageError */
function toStorageError(error, fallbackKind = 'unknown') {
  if (error instanceof StorageError) return error;
  const name = error && error.name ? String(error.name) : '';
  const message = error && error.message ? String(error.message) : String(error || '未知错误');

  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return new StorageError('浏览器本地存储空间不足，写入失败。', {
      kind: 'quota',
      cause: error,
    });
  }
  return new StorageError(
    fallbackKind === 'read' ? `读取本地数据失败：${message}` : `写入本地数据失败：${message}`,
    { kind: fallbackKind, cause: error },
  );
}

/**
 * 初始化存储。失败时不抛出，而是降级到内存模式并返回原因。
 * @returns {Promise<{mode: 'indexeddb'|'memory', error: StorageError|null}>}
 */
export async function initStorage() {
  if (!isIndexedDbSupported()) {
    mode = 'memory';
    return {
      mode,
      error: new StorageError(
        '当前浏览器环境不支持 IndexedDB（可能处于隐私模式或被浏览器策略禁用），已临时改用内存存储。',
        { kind: 'unavailable' },
      ),
    };
  }

  try {
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        reject(toStorageError(error, 'write'));
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SUPPLIERS)) {
          const store = db.createObjectStore(STORE_SUPPLIERS, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const store = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // 其他标签页触发升级时主动关闭，避免阻塞
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onerror = () => reject(toStorageError(request.error, 'write'));
      request.onblocked = () =>
        reject(
          new StorageError('本地数据库被其他标签页占用，请关闭本站的其他标签页后刷新重试。', {
            kind: 'unavailable',
          }),
        );
    });

    await dbPromise;
    mode = 'indexeddb';
    return { mode, error: null };
  } catch (error) {
    mode = 'memory';
    dbPromise = null;
    return { mode, error: toStorageError(error, 'write') };
  }
}

/** 通用：读取一个仓库的全部记录 */
async function getAll(storeName) {
  if (mode === 'memory') return [...memory[storeName].values()];
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    } catch (error) {
      reject(toStorageError(error, 'read'));
      return;
    }
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(toStorageError(request.error, 'read'));
  });
}

/** 通用：写入一条记录 */
async function put(storeName, value) {
  if (mode === 'memory') {
    const key = value.id ?? value.key;
    memory[storeName].set(key, JSON.parse(JSON.stringify(value)));
    return value;
  }
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    } catch (error) {
      reject(toStorageError(error, 'write'));
      return;
    }
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(toStorageError(request.error, 'write'));
  });
}

/** 通用：删除一条记录 */
async function remove(storeName, key) {
  if (mode === 'memory') {
    memory[storeName].delete(key);
    return;
  }
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    } catch (error) {
      reject(toStorageError(error, 'write'));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(toStorageError(request.error, 'write'));
  });
}

/** 通用：清空一个仓库 */
async function clear(storeName) {
  if (mode === 'memory') {
    memory[storeName].clear();
    return;
  }
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    } catch (error) {
      reject(toStorageError(error, 'write'));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(toStorageError(request.error, 'write'));
  });
}

/* ------------------------------------------------------------------ *
 * 供应商
 * ------------------------------------------------------------------ */

/** 读取全部供应商（按创建时间升序） */
export async function loadSuppliers() {
  const list = await getAll(STORE_SUPPLIERS);
  return list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** 保存供应商 */
export async function putSupplierRecord(record) {
  return put(STORE_SUPPLIERS, record);
}

/** 删除供应商（不影响历史记录） */
export async function deleteSupplierRecord(id) {
  return remove(STORE_SUPPLIERS, id);
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */

/**
 * 读取全部设置，返回键值对象。
 * 目前只用到 currentSupplierId，保留通用结构方便后续扩展。
 */
export async function loadSettings() {
  const list = await getAll(STORE_SETTINGS);
  const result = {};
  for (const item of list) {
    if (item && typeof item.key === 'string') result[item.key] = item.value;
  }
  return result;
}

/** 保存单个设置项 */
export async function saveSetting(key, value) {
  return put(STORE_SETTINGS, { key, value });
}

/* ------------------------------------------------------------------ *
 * 历史记录
 * ------------------------------------------------------------------ */

/** 读取历史记录（按时间倒序，最新在前） */
export async function loadHistory() {
  const list = await getAll(STORE_HISTORY);
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * 写入一条历史记录，并淘汰超出上限的最旧记录。
 * @param {object} record
 * @param {number} [limit]
 * @returns {Promise<{list: object[], evicted: object[]}>}
 */
export async function insertHistoryRecord(record, limit = HISTORY_LIMIT) {
  await put(STORE_HISTORY, record);
  const list = await loadHistory();
  const evicted = list.slice(limit);
  for (const item of evicted) {
    await remove(STORE_HISTORY, item.id);
  }
  return { list: list.slice(0, limit), evicted };
}

/** 删除单条历史 */
export async function deleteHistoryRecord(id) {
  return remove(STORE_HISTORY, id);
}

/** 清空历史（不影响供应商配置） */
export async function clearHistoryRecords() {
  return clear(STORE_HISTORY);
}
