/**
 * 全局配置常量。
 * 这里只放不会随运行时变化的静态配置，运行时数据统一放在 store/state.js。
 *
 * 面向界面的文案（品牌名、协议名、思考等级、示例提示词等）统一放在 utils/i18n.js 的字典里，
 * 这里只保留与语言无关的标识符与配置。
 */

/**
 * GitHub 仓库地址（独立常量）。
 *
 * 留空时导航栏的 GitHub 图标会处于禁用状态并给出提示，不会跳转到任何地址。
 */
export const GITHUB_REPO_URL = 'https://github.com/aimo6/pelican-test';

/** IndexedDB 数据库名与版本 */
export const DB_NAME = 'pelican-svg-test';
export const DB_VERSION = 1;

/** 历史记录最多保留条数 */
export const HISTORY_LIMIT = 10;

/**
 * 单次推理请求超时时间（毫秒）。
 * 这是「浏览器侧」的兜底超时：只在本工具等不到任何响应时生效。
 * 如果链路上有网关（nginx 等）先超时，会先收到网关返回的 504，改这里没有用。
 * 注意：自动重试时该超时按「每次尝试」计算（5 次尝试最坏情况约 15 分钟）。
 */
export const REQUEST_TIMEOUT_MS = 180000;

/** 模型列表请求超时时间（毫秒） */
export const MODEL_LIST_TIMEOUT_MS = 20000;

/**
 * 单次测试的最大尝试次数（含首次）。
 * 只有「可能靠重试恢复」的失败才会自动重试（超时 / HTTP 408 / 429 / 5xx），
 * 配置类错误（400 / 401 / 403 / 404 / CORS 等）重试没有意义，会立即报错。
 */
export const MAX_ATTEMPTS = 5;

/** 自动重试的基础间隔（毫秒）：第 n 次重试前等待 n × 该值（2s / 4s / 6s / 8s） */
export const RETRY_DELAY_MS = 2000;

/**
 * 发送给模型的系统提示词。
 * 目的：拿到可直接渲染的 SVG，减少 Markdown 代码围栏和多余解释。
 * 注意：该提示词固定为中文，不随界面语言变化（避免请求行为随语言切换而改变）。
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
 * `labelKey` 指向 utils/i18n.js 中的文案 key，展示时用 t(labelKey) 解析；
 * `defaultModels` 是「拉取模型列表失败」时展示的建议模型，仅作参考，
 * 可直接按自己的网关/供应商情况修改（不保证这些模型一定可用）。
 */
export const PROTOCOLS = [
  {
    value: 'chat',
    short: 'chat',
    labelKey: 'protocol.chat',
    endpoint: '/chat/completions',
    defaultModels: [],
  },
  {
    value: 'responses',
    short: 'responses',
    labelKey: 'protocol.responses',
    endpoint: '/responses',
    defaultModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-4.1', 'gpt-4o'],
  },
  {
    value: 'messages',
    short: 'messages',
    labelKey: 'protocol.messages',
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

/** 思考等级选项（default 表示不发送任何思考参数；labelKey 指向 i18n 字典） */
export const THINKING_LEVELS = [
  { value: 'default', labelKey: 'thinking.default' },
  { value: 'low', labelKey: 'thinking.low' },
  { value: 'medium', labelKey: 'thinking.medium' },
  { value: 'high', labelKey: 'thinking.high' },
  { value: 'xhigh', labelKey: 'thinking.xhigh' },
  { value: 'max', labelKey: 'thinking.max' },
];

/**
 * Messages 协议的思考档位 → thinking.budget_tokens。
 * 取值需小于 MESSAGES_MAX_TOKENS（本工具固定 8192）。
 */
export const THINKING_BUDGETS = {
  low: 1024,
  medium: 2048,
  high: 4096,
  xhigh: 6144,
  max: 7168,
};

/** 归一化思考等级（未知值一律回退到「默认」） */
export function getThinkingLevel(value) {
  return THINKING_LEVELS.some((item) => item.value === value) ? value : 'default';
}

/** 默认思考配置（默认不发送任何思考参数） */
export function createDefaultThinking() {
  return { level: 'default' };
}

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
