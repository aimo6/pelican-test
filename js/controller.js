/**
 * 应用控制器：负责编排「发起测试 → 解析 → 写入历史」的完整流程。
 * 组件只负责展示与触发，业务编排集中在这里。
 */

import { REQUEST_TIMEOUT_MS } from './config.js';
import { decodeApiKey } from './utils/base64.js';
import { formatDuration } from './utils/dom.js';
import { extractSvgFromText, sanitizeSvg } from './utils/svg.js';
import { runInference } from './services/inference.js';
import { describeError } from './services/http.js';
import { toastError, toastInfo, toastWarning } from './components/toast.js';

/** 这些失败类型说明「连接本身」有问题，需要更新供应商的连接状态 */
const CONNECTION_ERROR_KINDS = new Set(['network', 'timeout', 'auth']);

/**
 * @param {import('./store/state.js').store} store
 */
export function createController(store) {
  /** @type {AbortController|null} */
  let abortController = null;

  /** 在提示词区域展示一条配置类错误 */
  function showPromptError(message, hint = '') {
    store.setRun({
      status: 'error',
      error: { message, hint, detail: '', kind: 'config' },
      note: '',
    });
  }

  function cancelRun() {
    if (!abortController) return;
    abortController.abort();
  }

  /**
   * 发起一次真实请求。
   * @param {string} prompt
   */
  async function runTest(prompt) {
    if (abortController) {
      toastInfo('已有请求正在进行，请先等待或取消。');
      return;
    }

    const supplier = store.getCurrentSupplier();
    if (!supplier) {
      toastError('还没有可用的供应商', '请先添加并选择一个供应商。');
      return;
    }
    if (!supplier.model) {
      toastError('当前供应商还没有选择模型', '请在底部的模型输入框中填写或拉取模型。');
      document.getElementById('model-select-input')?.focus();
      return;
    }

    // 请求期间用户可以切换供应商，这里先做快照，结果回写时用快照而不是「当前」供应商
    const snapshot = {
      id: supplier.id,
      name: supplier.name,
      model: supplier.model,
      protocol: supplier.protocol || 'chat',
    };
    const apiKey = decodeApiKey(supplier.apiKeyB64);

    abortController = new AbortController();
    const startedAt = Date.now();

    store.setRun({ status: 'running', startedAt, error: null, note: '' });
    store.setResult(null);
    store.setPromptQuiet(prompt);

    try {
      const response = await runInference({
        baseUrl: supplier.baseUrl,
        apiKey,
        protocol: snapshot.protocol,
        model: snapshot.model,
        prompt,
        thinking: supplier.thinking,
        signal: abortController.signal,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      const durationMs = Date.now() - startedAt;
      const extracted = extractSvgFromText(response.content);

      let svgSanitized = null;
      let sanitizeError = null;
      let removed = [];
      if (extracted.svg) {
        const sanitized = sanitizeSvg(extracted.svg);
        svgSanitized = sanitized.svg;
        sanitizeError = sanitized.error;
        removed = sanitized.removed;
      }

      const parseOk = Boolean(svgSanitized);
      const record = store.buildHistoryRecord({
        prompt,
        rawResponse: response.raw,
        svgSource: extracted.svg,
        svgSanitized,
        parse: {
          ok: parseOk,
          strategy: extracted.strategy,
          error: sanitizeError || extracted.error,
          removed,
        },
        supplierId: snapshot.id,
        supplierName: snapshot.name,
        model: response.model || snapshot.model,
        protocol: snapshot.protocol,
        thinkingNote: response.thinkingNote,
        endpoint: response.endpoint,
        createdAt: Date.now(),
        durationMs,
        status: 'success',
        usage: response.usage,
        finishReason: response.finishReason,
      });

      store.setResult(record);
      store.setRun({
        status: 'success',
        error: null,
        note: `完成，耗时 ${formatDuration(durationMs)}${response.thinkingNote ? ` · ${response.thinkingNote}` : ''}`,
      });
      store.setSupplierConnection(snapshot.id, {
        status: 'ok',
        message: `最近一次请求成功（${formatDuration(durationMs)}）`,
        testedAt: Date.now(),
      });

      const { error } = await store.addHistory(record);
      if (error) toastError('历史记录保存失败', error.message);

      if (!parseOk) {
        toastWarning('没有解析出可预览的 SVG', '原始响应已保留，可在结果区展开「原始响应」查看。');
      } else if (response.finishReason === 'length') {
        toastWarning('模型输出可能被截断', '已达到输出长度上限，SVG 可能不完整。');
      }
    } catch (error) {
      const info = describeError(error);

      if (info.kind === 'canceled') {
        store.setRun({ status: 'canceled', error: null, note: '请求已取消' });
        toastInfo('已取消请求');
        return;
      }

      const record = store.buildHistoryRecord({
        prompt,
        rawResponse: info.detail || '',
        svgSource: null,
        svgSanitized: null,
        parse: { ok: false, strategy: null, error: null, removed: [] },
        supplierId: snapshot.id,
        supplierName: snapshot.name,
        model: snapshot.model,
        protocol: snapshot.protocol,
        createdAt: Date.now(),
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: [info.message, info.detail].filter(Boolean).join(' '),
      });

      store.setResult(record);
      store.setRun({ status: 'error', error: info, note: '' });

      if (CONNECTION_ERROR_KINDS.has(info.kind)) {
        store.setSupplierConnection(snapshot.id, {
          status: 'error',
          message: [info.message, info.detail].filter(Boolean).join(' ').slice(0, 300),
          testedAt: Date.now(),
        });
      }

      const { error: saveError } = await store.addHistory(record);
      if (saveError) toastError('历史记录保存失败', saveError.message);
    } finally {
      abortController = null;
    }
  }

  return { runTest, cancelRun, showPromptError };
}
