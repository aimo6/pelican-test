/**
 * 应用控制器：负责编排「发起测试 → 解析 → 写入历史」的完整流程。
 * 组件只负责展示与触发，业务编排集中在这里。
 */

import { MAX_ATTEMPTS, REQUEST_TIMEOUT_MS, RETRY_DELAY_MS } from './config.js';
import { decodeApiKey } from './utils/base64.js';
import { formatDuration } from './utils/dom.js';
import { t } from './utils/i18n.js';
import { extractSvgFromText, sanitizeSvg } from './utils/svg.js';
import { runInference } from './services/inference.js';
import { ApiError, describeError, isRetryableError } from './services/http.js';
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
   * 等待重试间隔；等待期间被取消时立即以「已取消」结束。
   * @param {number} ms
   * @param {AbortSignal|null} signal
   */
  function waitForRetry(ms, signal) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new ApiError(t('http.canceled'), { kind: 'canceled' }));
      };
      timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      if (signal && signal.aborted) onAbort();
      else if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * 带自动重试的推理请求。
   *
   * 只重试可恢复的失败（超时 / 限流 / 服务端错误），最多尝试 MAX_ATTEMPTS 次（含首次）；
   * 每次重试前渐进等待（2s / 4s / 6s / 8s），等待期间取消会立即结束。
   * 重试进度通过 run.note 反馈到界面。
   *
   * @param {Parameters<typeof runInference>[0]} params
   */
  async function runWithRetry(params) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runInference(params);
      } catch (error) {
        const canRetry =
          isRetryableError(error) &&
          attempt < MAX_ATTEMPTS &&
          !(params.signal && params.signal.aborted);
        if (!canRetry) throw error;

        const delayMs = RETRY_DELAY_MS * attempt;
        store.setRun({
          note: t('controller.retrying', {
            next: attempt + 1,
            max: MAX_ATTEMPTS,
            seconds: Math.round(delayMs / 1000),
          }),
        });
        await waitForRetry(delayMs, params.signal);
      }
    }
  }

  /**
   * 发起一次真实请求。
   * @param {string} prompt
   */
  async function runTest(prompt) {
    if (abortController) {
      toastInfo(t('controller.busy'));
      return;
    }

    const supplier = store.getCurrentSupplier();
    if (!supplier) {
      toastError(t('controller.noProvider'), t('controller.noProviderHint'));
      return;
    }
    if (!supplier.model) {
      toastError(t('controller.noModel'), t('controller.noModelHint'));
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
      const response = await runWithRetry({
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
      const doneNote = t('controller.done', { d: formatDuration(durationMs) });
      store.setRun({
        status: 'success',
        error: null,
        note: response.thinkingNote ? `${doneNote} · ${response.thinkingNote}` : doneNote,
      });
      store.setSupplierConnection(snapshot.id, {
        status: 'ok',
        message: t('controller.connectionOk', { d: formatDuration(durationMs) }),
        testedAt: Date.now(),
      });

      // 测试历史只保存「成功生成图片」的结果，没解析出 SVG 的响应不写入历史
      if (parseOk) {
        const { error } = await store.addHistory(record);
        if (error) toastError(t('controller.historySaveFailed'), error.message);
      }

      if (!parseOk) {
        toastWarning(t('controller.noSvg'), t('controller.noSvgHint'));
      } else if (response.finishReason === 'length') {
        toastWarning(t('controller.truncated'), t('controller.truncatedHint'));
      }
    } catch (error) {
      const info = describeError(error);

      if (info.kind === 'canceled') {
        store.setRun({ status: 'canceled', error: null, note: t('controller.canceled') });
        toastInfo(t('controller.canceledToast'));
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

      // 失败的测试只在结果区展示，不写入历史
    } finally {
      abortController = null;
    }
  }

  return { runTest, cancelRun, showPromptError };
}
