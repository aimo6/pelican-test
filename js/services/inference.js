/**
 * 推理请求服务：统一处理三种接口协议。
 *
 * 支持的协议（见 config.js 的 PROTOCOLS）：
 * - chat：OpenAI 兼容的 /chat/completions
 * - responses：OpenAI 的 /responses
 * - messages：Anthropic 的 /messages
 *
 * 所有请求构造、思考参数适配、响应解析都收敛在这里，
 * UI 与存储层不直接接触接口细节。
 */

import {
  ANTHROPIC_VERSION,
  MESSAGES_MAX_TOKENS,
  REQUEST_TIMEOUT_MS,
  SYSTEM_PROMPT,
  THINKING_BUDGETS,
  getProtocol,
  getThinkingLevel,
} from '../config.js';
import { buildEndpoint, describeUrl, validateBaseUrl } from '../utils/url.js';
import { t } from '../utils/i18n.js';
import { ApiError, requestJson } from './http.js';

/**
 * 根据思考等级生成附加请求参数（按协议映射）。
 *
 * - chat：reasoning_effort = 等级
 * - responses：reasoning.effort = 等级
 * - messages：thinking.budget_tokens = 档位对应的 token 预算（并自动补充 thinking.type）
 *
 * 等级为「默认」时不发送任何思考参数。
 *
 * @param {{level?: string}} thinking
 * @param {string} protocol
 * @returns {{params: Record<string, any>, note: string}}
 */
export function buildThinkingParams(thinking, protocol = 'chat') {
  const level = getThinkingLevel(thinking?.level);
  if (level === 'default') {
    return { params: {}, note: t('inference.thinkingDefault') };
  }

  if (protocol === 'messages') {
    const budget = THINKING_BUDGETS[level];
    return {
      params: { thinking: { type: 'enabled', budget_tokens: budget } },
      note: t('inference.thinkingBudget', { budget }),
    };
  }
  if (protocol === 'responses') {
    return {
      params: { reasoning: { effort: level } },
      note: t('inference.thinkingEffort', { effort: level }),
    };
  }
  return { params: { reasoning_effort: level }, note: t('inference.thinkingReasoningEffort', { effort: level }) };
}

/* ------------------------------------------------------------------ *
 * 请求头
 * ------------------------------------------------------------------ */

/**
 * 按协议构造鉴权请求头（不含 Content-Type）。
 *
 * Messages 协议使用 Anthropic 官方鉴权方式，并显式声明允许浏览器直连
 * （缺少 anthropic-dangerous-direct-browser-access 时 CORS 预检会被拒绝）；
 * 同时附带 Authorization，兼容只认 Bearer 的 Anthropic 兼容网关。
 *
 * @param {string} apiKey
 * @param {string} protocol
 * @returns {Record<string, string>}
 */
export function buildAuthHeaders(apiKey, protocol = 'chat') {
  const headers = { Accept: 'application/json' };

  if (getProtocol(protocol).value === 'messages') {
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    if (apiKey) {
      headers['x-api-key'] = apiKey;
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/* ------------------------------------------------------------------ *
 * 响应解析
 * ------------------------------------------------------------------ */

/** 从 content 字段（字符串或分片数组）中提取纯文本 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

/** 解析 OpenAI 兼容的对话补全响应 */
function parseChatCompletion(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(t('inference.notObject'), { kind: 'format' });
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ApiError(t('inference.noChoices'), {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: t('inference.noChoicesHint'),
    });
  }

  const choice = choices[0] || {};
  const message = choice.message || {};
  const content = message.content !== undefined ? contentToText(message.content) : contentToText(choice.text);
  const reasoning =
    (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
    (typeof message.reasoning === 'string' && message.reasoning) ||
    '';

  return {
    content,
    reasoning,
    model: typeof payload.model === 'string' ? payload.model : null,
    usage: payload.usage || null,
    finishReason: choice.finish_reason || null,
    detail: JSON.stringify(choice).slice(0, 300),
  };
}

/** 解析 OpenAI Responses 接口响应 */
function parseResponses(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(t('inference.notObject'), { kind: 'format' });
  }

  const output = Array.isArray(payload.output) ? payload.output : null;
  const hasOutputText = typeof payload.output_text === 'string';
  if (!output && !hasOutputText) {
    throw new ApiError(t('inference.noOutput'), {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: t('inference.noOutputHint'),
    });
  }

  let content = hasOutputText ? payload.output_text : '';
  const reasoningParts = [];

  for (const item of output || []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') content += part.text;
      }
    }
    if (item.type === 'reasoning' && Array.isArray(item.summary)) {
      for (const part of item.summary) {
        if (part && typeof part.text === 'string') reasoningParts.push(part.text);
      }
    }
  }

  const status = typeof payload.status === 'string' ? payload.status : '';
  const incompleteReason = payload.incomplete_details && payload.incomplete_details.reason;
  let finishReason = null;
  if (status === 'incomplete' && incompleteReason === 'max_output_tokens') finishReason = 'length';
  else if (status === 'completed') finishReason = 'stop';
  else if (typeof incompleteReason === 'string') finishReason = incompleteReason;

  return {
    content,
    reasoning: reasoningParts.join('\n'),
    model: typeof payload.model === 'string' ? payload.model : null,
    usage: payload.usage || null,
    finishReason,
    detail: JSON.stringify(payload).slice(0, 300),
  };
}

/** 解析 Anthropic Messages 接口响应 */
function parseMessages(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(t('inference.notObject'), { kind: 'format' });
  }
  const blocks = Array.isArray(payload.content) ? payload.content : null;
  if (!blocks) {
    throw new ApiError(t('inference.noContent'), {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: t('inference.noContentHint'),
    });
  }

  let content = '';
  const reasoningParts = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') content += block.text;
    else if (block.type === 'thinking' && typeof block.thinking === 'string') reasoningParts.push(block.thinking);
  }

  const stop = typeof payload.stop_reason === 'string' ? payload.stop_reason : null;

  return {
    content,
    reasoning: reasoningParts.join('\n'),
    model: typeof payload.model === 'string' ? payload.model : null,
    usage: payload.usage || null,
    finishReason: stop === 'max_tokens' ? 'length' : stop,
    detail: JSON.stringify(blocks).slice(0, 300),
  };
}

/** 校验解析结果中确实有正文内容 */
function ensureContent(parsed) {
  if (String(parsed.content || '').trim()) return parsed;

  if (parsed.reasoning) {
    throw new ApiError(t('inference.reasoningOnly'), {
      kind: 'format',
      detail: parsed.reasoning.slice(0, 500),
      hint: t('inference.reasoningOnlyHint'),
    });
  }
  throw new ApiError(t('inference.emptyContent'), {
    kind: 'format',
    detail: parsed.detail || '',
    hint: t('inference.emptyContentHint'),
  });
}

/* ------------------------------------------------------------------ *
 * 协议适配器
 * ------------------------------------------------------------------ */

/** @type {Record<string, {endpoint: string, buildBody: Function, parse: Function}>} */
const ADAPTERS = {
  chat: {
    endpoint: '/chat/completions',
    buildBody({ model, prompt, thinkingParams }) {
      return {
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: false,
        ...thinkingParams,
      };
    },
    parse: parseChatCompletion,
  },

  responses: {
    endpoint: '/responses',
    buildBody({ model, prompt, thinkingParams }) {
      return {
        model,
        instructions: SYSTEM_PROMPT,
        input: prompt,
        ...thinkingParams,
      };
    },
    parse: parseResponses,
  },

  messages: {
    endpoint: '/messages',
    buildBody({ model, prompt, thinkingParams }) {
      return {
        model,
        max_tokens: MESSAGES_MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        ...thinkingParams,
      };
    },
    parse: parseMessages,
  },
};

/**
 * 发起一次推理请求（按协议选择端点与请求格式）。
 *
 * @param {{
 *   baseUrl: string,
 *   apiKey?: string,
 *   protocol?: string,
 *   model: string,
 *   prompt: string,
 *   thinking?: object,
 *   signal?: AbortSignal|null,
 *   timeoutMs?: number,
 * }} params
 * @returns {Promise<{content: string, raw: string, model: string|null, usage: any, finishReason: string|null, thinkingNote: string, endpoint: string, durationMs: number}>}
 */
export async function runInference(params) {
  const {
    baseUrl,
    apiKey = '',
    protocol = 'chat',
    model,
    prompt,
    thinking = null,
    signal = null,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = params;

  const validation = validateBaseUrl(baseUrl);
  if (!validation.ok) throw new ApiError(validation.error || t('inference.invalidBaseUrl'), { kind: 'config' });
  if (!String(model || '').trim()) {
    throw new ApiError(t('inference.modelRequired'), { kind: 'config' });
  }
  if (!String(prompt || '').trim()) {
    throw new ApiError(t('inference.promptRequired'), { kind: 'config' });
  }

  const meta = getProtocol(protocol);
  const adapter = ADAPTERS[meta.value] || ADAPTERS.chat;
  const { params: thinkingParams, note: thinkingNote } = buildThinkingParams(thinking, meta.value);

  const url = buildEndpoint(baseUrl, adapter.endpoint);
  const body = adapter.buildBody({ model, prompt, thinkingParams });

  const startedAt = performance.now();
  const { data, text } = await requestJson(url, {
    method: 'POST',
    headers: { ...buildAuthHeaders(apiKey, meta.value), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    timeoutMs,
    secret: apiKey,
  });
  const durationMs = Math.round(performance.now() - startedAt);

  const parsed = ensureContent(adapter.parse(data));

  return {
    content: parsed.content,
    raw: text,
    model: parsed.model,
    usage: parsed.usage,
    finishReason: parsed.finishReason,
    thinkingNote,
    endpoint: describeUrl(url),
    durationMs,
  };
}
