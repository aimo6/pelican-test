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
  THINKING_LEVELS,
  getProtocol,
} from '../config.js';
import { buildEndpoint, describeUrl, validateBaseUrl } from '../utils/url.js';
import { ApiError, requestJson } from './http.js';

const LEVEL_LABELS = THINKING_LEVELS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, /** @type {Record<string,string>} */ ({}));

/** 把字符串取值转换成配置声明的类型 */
function coerceValue(raw, valueType) {
  if (valueType === 'number') {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  if (valueType === 'boolean') {
    const lower = String(raw).trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
    return Boolean(raw);
  }
  return String(raw);
}

/**
 * 按点号路径写入嵌套对象，例如 setByPath(target, 'reasoning.effort', 'high')。
 * 已存在的非对象值会被覆盖，避免路径冲突时报错。
 */
function setByPath(target, path, value) {
  const segments = String(path)
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length === 0) return target;

  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
  return target;
}

/**
 * 根据思考配置生成附加请求参数。
 *
 * 设计原则：只有用户显式开启并配置了参数名与取值时才会发送，
 * 绝不把某个供应商的私有参数无条件塞给所有接口。
 * 参数名支持 `a.b` 形式的点号路径（用于 Responses / Messages 的嵌套参数）。
 *
 * @param {{level?: string, enabled?: boolean, paramName?: string, valueType?: string, values?: Record<string,string>}} thinking
 * @param {string} protocol
 * @returns {{params: Record<string, any>, note: string}}
 */
export function buildThinkingParams(thinking, protocol = 'chat') {
  const config = thinking || {};
  const level = config.level || 'auto';

  if (level === 'auto') {
    return { params: {}, note: '思考等级为「自动」，未发送思考参数' };
  }
  if (!config.enabled) {
    return { params: {}, note: `思考等级「${LEVEL_LABELS[level] || level}」仅记录在本地，未发送参数` };
  }
  const paramName = String(config.paramName || '').trim();
  if (!paramName) {
    return { params: {}, note: '未配置思考参数名，本次请求未发送思考参数' };
  }
  const rawValue = config.values ? config.values[level] : '';
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return { params: {}, note: `等级「${LEVEL_LABELS[level] || level}」没有配置取值，本次请求未发送思考参数` };
  }

  const params = setByPath({}, paramName, coerceValue(rawValue, config.valueType));
  const extras = [];
  // Messages 接口的思考参数必须带 type，这里自动补齐，避免用户被迫配置两个参数
  if (
    protocol === 'messages' &&
    params.thinking &&
    typeof params.thinking === 'object' &&
    !params.thinking.type
  ) {
    params.thinking.type = 'enabled';
    extras.push('已自动补充 thinking.type=enabled');
  }

  return {
    params,
    note: `已发送思考参数 ${paramName}=${rawValue}${extras.length ? `（${extras.join('；')}）` : ''}`,
  };
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
    throw new ApiError('接口返回的内容不是有效的 JSON 对象。', { kind: 'format' });
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ApiError('接口响应中没有 choices 字段。', {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: '该地址可能不是 OpenAI 兼容的对话补全接口，可尝试切换协议。',
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
    throw new ApiError('接口返回的内容不是有效的 JSON 对象。', { kind: 'format' });
  }

  const output = Array.isArray(payload.output) ? payload.output : null;
  const hasOutputText = typeof payload.output_text === 'string';
  if (!output && !hasOutputText) {
    throw new ApiError('接口响应中没有 output 字段。', {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: '该地址可能不是 OpenAI Responses 接口，可尝试切换协议。',
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
    throw new ApiError('接口返回的内容不是有效的 JSON 对象。', { kind: 'format' });
  }
  const blocks = Array.isArray(payload.content) ? payload.content : null;
  if (!blocks) {
    throw new ApiError('接口响应中没有 content 字段。', {
      kind: 'format',
      detail: JSON.stringify(payload).slice(0, 300),
      hint: '该地址可能不是 Claude Messages 接口，可尝试切换协议。',
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
    throw new ApiError('模型只返回了思考过程，没有返回最终回答。', {
      kind: 'format',
      detail: parsed.reasoning.slice(0, 500),
      hint: '可以把思考等级调低或关闭后重试，也可以调大输出长度限制。',
    });
  }
  throw new ApiError('模型返回的内容为空。', {
    kind: 'format',
    detail: parsed.detail || '',
    hint: '可以尝试更换模型或调整提示词后重试。',
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
  if (!validation.ok) throw new ApiError(validation.error || 'Base URL 不合法', { kind: 'config' });
  if (!String(model || '').trim()) {
    throw new ApiError('请先选择或填写模型名称。', { kind: 'config' });
  }
  if (!String(prompt || '').trim()) {
    throw new ApiError('请先填写提示词。', { kind: 'config' });
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
