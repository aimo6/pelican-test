/**
 * 全局配置常量。
 * 这里只放不会随运行时变化的静态配置，运行时数据统一放在 store/state.js。
 */

export const APP_NAME = '鹈鹕测试';
export const APP_TAGLINE = 'SVG 模型测试';

/**
 * GitHub 仓库地址（独立常量）。
 *
 * 请在这里填写真实的仓库地址，例如 'https://github.com/your-name/pelican-test-web'。
 * 留空时导航栏的 GitHub 图标会处于禁用状态并给出提示，不会跳转到任何地址
 * （此处刻意不预置任何猜测出来的仓库地址）。
 */
export const GITHUB_REPO_URL = '';

/** IndexedDB 数据库名与版本 */
export const DB_NAME = 'pelican-svg-test';
export const DB_VERSION = 1;

/** 历史记录最多保留条数 */
export const HISTORY_LIMIT = 10;

/**
 * 单次推理请求超时时间（毫秒）。
 * 这是「浏览器侧」的兜底超时：只在本工具等不到任何响应时生效。
 * 如果链路上有网关（nginx 等）先超时，会先收到网关返回的 504，改这里没有用。
 */
export const REQUEST_TIMEOUT_MS = 600000;

/** 模型列表请求超时时间（毫秒） */
export const MODEL_LIST_TIMEOUT_MS = 20000;

/** 默认示例提示词 */
export const DEFAULT_PROMPT =
  '使用 SVG 绘制一个戴着蓝色帽子的鹈鹕在海边骑自行车的 2D 动画，画面简洁，主体清晰。';

/**
 * 发送给模型的系统提示词。
 * 目的：拿到可直接渲染的 SVG，减少 Markdown 代码围栏和多余解释。
 */
export const SYSTEM_PROMPT = [
  '你是一个 SVG 图形生成专家。',
  '请严格按照用户的要求，直接输出一个完整、可独立渲染的 SVG 文档。',
  '输出要求：',
  '1. 必须包含 <svg> 根元素，并带有 xmlns="http://www.w3.org/2000/svg" 和 viewBox 属性。',
  '2. 不要输出 Markdown 代码围栏（```），不要输出任何解释、前言或后记文字。',
  '3. 不要在 SVG 中使用 <script>、事件处理器（如 onclick）或外部资源引用（外部图片、字体、CSS）。',
  '4. 若需要动画，请使用 SVG 内置的 SMIL 动画（<animate> / <animateTransform>）或内联 <style> 中的 CSS 动画。',
].join('\n');

/**
 * 接口协议。
 *
 * - chat：OpenAI 兼容的对话补全接口（最通用，默认）
 * - responses：OpenAI Responses 接口
 * - messages：Anthropic Claude Messages 接口
 *
 * `defaultModels` 是「拉取模型列表失败」时展示的建议模型，仅作参考，
 * 可直接按自己的网关/供应商情况修改（不保证这些模型一定可用）。
 */
export const PROTOCOLS = [
  {
    value: 'chat',
    short: 'chat',
    label: '对话接口（Chat Completions）',
    endpoint: '/chat/completions',
    defaultModels: [],
  },
  {
    value: 'responses',
    short: 'responses',
    label: 'Responses 接口（OpenAI）',
    endpoint: '/responses',
    defaultModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-4.1', 'gpt-4o'],
  },
  {
    value: 'messages',
    short: 'messages',
    label: 'Messages 接口（Claude）',
    endpoint: '/messages',
    defaultModels: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
];

/** 默认协议 */
export const DEFAULT_PROTOCOL = 'chat';

/**
 * 取得协议配置（非法值回退到默认协议）。
 * @param {string} value
 */
export function getProtocol(value) {
  return PROTOCOLS.find((item) => item.value === value) || PROTOCOLS[0];
}

/** Messages 接口的 max_tokens（该接口必填；思考预算需小于此值） */
export const MESSAGES_MAX_TOKENS = 8192;

/** Anthropic Messages 接口要求的版本号 */
export const ANTHROPIC_VERSION = '2023-06-01';

/** 思考等级选项 */
export const THINKING_LEVELS = [
  { value: 'auto', label: '自动（不发送思考参数）' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

/**
 * 思考参数的预设方案。
 *
 * 不同协议 / 供应商 / 模型对「思考等级」的支持方式完全不同，因此这里只提供参数模板：
 * 参数名（支持 `a.b` 形式的点号路径）、取值类型与各等级取值都可以由用户改写，
 * 不发送任何未配置的参数。`protocols` 声明该预设适用于哪些协议。
 */
export const THINKING_PRESETS = [
  {
    id: 'none',
    label: '不发送思考参数（默认，兼容性最好）',
    protocols: ['chat', 'responses', 'messages'],
    paramName: '',
    valueType: 'string',
    values: { off: '', low: '', medium: '', high: '' },
  },
  {
    id: 'reasoning_effort',
    label: 'reasoning_effort（OpenAI 风格）',
    protocols: ['chat'],
    paramName: 'reasoning_effort',
    valueType: 'string',
    values: { off: 'none', low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'enable_thinking',
    label: 'enable_thinking（布尔型，如 Qwen / DashScope）',
    protocols: ['chat'],
    paramName: 'enable_thinking',
    valueType: 'boolean',
    values: { off: 'false', low: 'true', medium: 'true', high: 'true' },
  },
  {
    id: 'thinking_budget',
    label: 'thinking_budget（token 预算，数字型）',
    protocols: ['chat'],
    paramName: 'thinking_budget',
    valueType: 'number',
    values: { off: '0', low: '1024', medium: '4096', high: '16384' },
  },
  {
    id: 'responses_effort',
    label: 'reasoning.effort（Responses 原生参数）',
    protocols: ['responses'],
    paramName: 'reasoning.effort',
    valueType: 'string',
    values: { off: '', low: 'low', medium: 'medium', high: 'high' },
  },
  {
    id: 'messages_budget',
    label: 'thinking.budget_tokens（Messages 原生参数）',
    protocols: ['messages'],
    paramName: 'thinking.budget_tokens',
    valueType: 'number',
    values: { off: '', low: '1024', medium: '2048', high: '4096' },
  },
  {
    id: 'custom',
    label: '自定义参数名与取值',
    protocols: ['chat', 'responses', 'messages'],
    paramName: '',
    valueType: 'string',
    values: { off: '', low: '', medium: '', high: '' },
  },
];

/** 默认思考参数配置（默认不发送任何思考参数） */
export function createDefaultThinking() {
  const preset = THINKING_PRESETS[0];
  return {
    level: 'auto',
    enabled: false,
    presetId: preset.id,
    paramName: preset.paramName,
    valueType: preset.valueType,
    values: { ...preset.values },
  };
}

/**
 * 取得适用于指定协议的思考参数预设。
 * @param {string} protocol
 */
export function getThinkingPresets(protocol) {
  return THINKING_PRESETS.filter((item) => item.protocols.includes(protocol));
}

/** 值类型选项（用于自定义思考参数取值） */
export const VALUE_TYPES = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔值' },
];

/** 接口端点路径（相对于 Base URL；各协议的推理端点见 PROTOCOLS） */
export const ENDPOINTS = {
  models: '/models',
};

/** 连接状态展示文案 */
export const CONNECTION_STATUS = {
  untested: { label: '未测试', tone: 'muted' },
  ok: { label: '连接成功', tone: 'ok' },
  error: { label: '连接失败', tone: 'error' },
};
