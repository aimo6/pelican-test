/**
 * 模型列表获取。
 *
 * 只调用 `GET {Base URL}/models`，不做任何伪造：
 * 拿不到就明确报错，让用户手动填写模型 ID。
 * 鉴权头按当前协议构造（Anthropic 需要 x-api-key 与版本号）。
 */

import { ENDPOINTS, MODEL_LIST_TIMEOUT_MS } from '../config.js';
import { buildEndpoint, describeUrl, validateBaseUrl } from '../utils/url.js';
import { ApiError, requestJson } from './http.js';
import { buildAuthHeaders } from './inference.js';

/**
 * 从各种常见返回结构中解析模型 ID 列表。
 * 支持：数组 / { data: [...] } / { models: [...] } / { data: { models: [...] } }
 * @param {any} payload
 * @returns {string[]}
 */
export function parseModelList(payload) {
  const collect = (list) => {
    if (!Array.isArray(list)) return [];
    const ids = [];
    for (const item of list) {
      if (typeof item === 'string') {
        if (item.trim()) ids.push(item.trim());
        continue;
      }
      if (item && typeof item === 'object') {
        const id = item.id ?? item.model ?? item.name ?? item.slug;
        if (typeof id === 'string' && id.trim()) ids.push(id.trim());
      }
    }
    return ids;
  };

  let ids = [];
  if (Array.isArray(payload)) {
    ids = collect(payload);
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) ids = collect(payload.data);
    else if (Array.isArray(payload.models)) ids = collect(payload.models);
    else if (payload.data && typeof payload.data === 'object' && Array.isArray(payload.data.models)) {
      ids = collect(payload.data.models);
    } else if (Array.isArray(payload.result)) {
      ids = collect(payload.result);
    }
  }

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * 获取模型列表。
 *
 * @param {{baseUrl: string, apiKey?: string, protocol?: string, signal?: AbortSignal|null}} params
 * @returns {Promise<{models: string[], url: string, host: string}>}
 * @throws {ApiError}
 */
export async function fetchModelList({ baseUrl, apiKey = '', protocol = 'chat', signal = null }) {
  const validation = validateBaseUrl(baseUrl);
  if (!validation.ok) {
    throw new ApiError(validation.error || 'Base URL 不合法', { kind: 'config' });
  }

  const url = buildEndpoint(baseUrl, ENDPOINTS.models);
  if (!url) {
    throw new ApiError('无法根据 Base URL 拼接出模型列表地址', { kind: 'config' });
  }

  const { data } = await requestJson(url, {
    method: 'GET',
    headers: buildAuthHeaders(apiKey, protocol),
    signal,
    timeoutMs: MODEL_LIST_TIMEOUT_MS,
    secret: apiKey,
  });

  const models = parseModelList(data);
  if (models.length === 0) {
    throw new ApiError('接口调用成功，但响应中没有找到模型列表。', {
      kind: 'format',
      detail: `请求地址：${describeUrl(url)}`,
      hint: '本工具期望的返回结构是 { "data": [ { "id": "模型名" } ] }。该供应商可能不支持 /models 接口，请直接手动填写模型 ID。',
    });
  }

  return { models, url, host: describeUrl(url) };
}
