/**
 * 轻量国际化（i18n）：中文 / 英文两套文案 + 运行时语言状态。
 *
 * 设计要点：
 * - 零依赖、零构建；本模块不 import 任何其他模块，避免与 store / utils 形成循环引用。
 * - 语言在模块加载时同步从 localStorage 读取，因此首屏渲染即是最终语言（无闪烁），
 *   store.init() 期间产生的错误文案也天然使用正确语言。
 * - 组件响应语言变化：语言真值同时镜像到 store.state.locale，store.setLocale() 触发
 *   notify()，各组件在自己的 render() 中调用 t() 重新取文案。
 * - t() 只应在渲染 / 运行时调用，不要在模块顶层求值，否则会冻结为加载时的语言。
 *
 * 文案规范：扁平 key，按 `<域>.<子域>.<名>` 命名；插值统一使用 `{name}` 形式。
 */

/** 语言存储键（localStorage） */
const STORAGE_KEY = 'pelican-test.locale';

/** 默认语言 */
export const DEFAULT_LOCALE = 'zh';

/** 支持的语言（顺序即切换顺序） */
export const LOCALES = ['zh', 'en'];

/** <html lang> 取值 */
const HTML_LANG = { zh: 'zh-CN', en: 'en' };

/** 中文文案（基准字典：英文缺 key 时回退到这里） */
const zh = {
  /* —— 品牌 —— */
  'app.name': '鹈鹕测试',
  'app.tagline': 'SVG 模型测试',

  /* —— 通用 —— */
  'common.close': '关闭',
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.processing': '处理中…',
  'common.processingSave': '保存中…',
  'common.protocolTitle': '接口协议：{label}',
  'common.notRecorded': '未记录',
  'common.untitledTest': '未命名测试',
  'common.unnamedProvider': '未命名供应商',
  'common.unknownError': '未知错误',
  'base64.notSet': '（未设置）',

  /* —— 顶栏 —— */
  'topbar.lang.switch': '切换到 {name}',
  'topbar.github.openTitle': '打开 GitHub 仓库：{url}',
  'topbar.github.openAria': '打开 GitHub 仓库',
  'topbar.github.disabledTitle': '尚未配置 GitHub 仓库地址：请在 js/config.js 中填写 GITHUB_REPO_URL',
  'topbar.github.disabledAria': 'GitHub 仓库地址未配置',

  /* —— 顶部提示条与初始化 —— */
  'banner.fileProtocol':
    '当前页面通过 file:// 直接打开，浏览器可能限制 ES 模块与本地存储。建议在项目目录执行 python3 -m http.server 5173，然后访问 http://localhost:5173。',
  'banner.memoryMode': '{message}当前处于内存模式，供应商配置与历史记录在刷新后会丢失。',
  'banner.storageUnavailable': 'IndexedDB 不可用。',
  'app.loadFailed': '读取本地数据失败',
  'app.initFailed': '初始化失败',

  /* —— 提示词面板 —— */
  'prompt.placeholder':
    '描述你希望模型生成的 SVG，例如：使用 SVG 绘制一个戴着蓝色帽子的鹈鹕在海边骑自行车的 2D 动画。',
  'prompt.counter': '{n} 字符',
  'prompt.loadExample': '载入示例',
  'prompt.clear': '清空',
  'prompt.addProvider': '添加供应商',
  'prompt.noProvider': '尚未配置供应商',
  'prompt.run': '开始测试',
  'prompt.running': '请求中…',
  'prompt.cancel': '取消请求',
  'prompt.shortcut': 'Ctrl / ⌘ + Enter 提交',
  'prompt.statusRunning': '正在调用模型，请稍候…',
  'prompt.statusCanceled': '请求已取消',
  'prompt.statusDone': '请求完成',
  'prompt.required': '请先填写提示词。',
  'prompt.runNoProvider': '请先添加并选择一个供应商',
  'prompt.runNoModel': '请先在配置行填写或拉取模型',
  'prompt.selectProvider': '切换供应商',
  'prompt.editProvider': '编辑当前供应商配置',
  'prompt.example': '使用 SVG 绘制一个戴着蓝色帽子的鹈鹕在海边骑自行车的 2D 动画，画面简洁，主体清晰。',

  /* —— 供应商列表 —— */
  'supplier.section': '供应商',
  'supplier.add': '添加',
  'supplier.addTitle': '添加供应商',
  'supplier.editTitle': '编辑供应商',
  'supplier.deleteTitle': '删除供应商',
  'supplier.confirmDeleteTitle': '删除供应商',
  'supplier.confirmDeleteMessage': '确定要删除「{name}」吗？',
  'supplier.confirmDeleteDetail': '已生成的测试历史不会被删除，历史记录里会保留当时的配置快照。',
  'supplier.confirmDeleteConfirm': '删除',
  'supplier.deleteFailed': '删除失败',
  'supplier.deleted': '已删除供应商',
  'supplier.emptyTitle': '还没有供应商',
  'supplier.emptyDesc': '添加一个模型接口（Base URL + API Key）即可开始测试。',

  /* —— 测试历史 —— */
  'history.section': '测试历史',
  'history.clear': '清空',
  'history.confirmClearTitle': '清空测试历史',
  'history.confirmClearMessage': '确定要清空全部 {n} 条测试历史吗？',
  'history.confirmClearDetail': '只清除历史记录，已保存的供应商配置不受影响。该操作无法撤销。',
  'history.confirmClearConfirm': '清空',
  'history.clearFailed': '清空失败',
  'history.cleared': '已清空测试历史',
  'history.deleteTitle': '删除这条历史',
  'history.emptyTitle': '暂无测试历史',
  'history.emptyDesc': '成功生成图片的测试会自动保存在这里，最多保留最近 {limit} 条。',

  /* —— 供应商弹窗 —— */
  'modal.addTitle': '添加供应商',
  'modal.editTitle': '编辑供应商',
  'modal.nameLabel': '供应商名称',
  'modal.namePlaceholder': '例如：我的 Qwen API',
  'modal.baseUrlLabel': 'Base URL',
  'modal.apiKeyLabel': 'API Key',
  'modal.apiKeyToggle': '显示 / 隐藏',
  'modal.apiKeyHint': 'Key 会以 Base64 编码后保存在本地',
  'modal.apiKeySaved': '已保存：{mask}（留空表示不修改）',
  'modal.apiKeyClearPending': '保存后将清除已保存的 API Key。',
  'modal.showStoredKey': '显示已保存的 Key',
  'modal.clearStoredKey': '清除已保存的 Key',
  'modal.cancelClearKey': '取消清除',
  'modal.save': '保存供应商',
  'modal.baseUrlWillUse': '将使用：{url}',
  'modal.saveFailed': '保存失败',
  'modal.savedAdd': '供应商已添加',
  'modal.savedEdit': '供应商已更新',
  'modal.baseUrlWarning': 'Base URL 提示',

  /* —— 模型选择区 —— */
  'model.protocolTitle': '接口协议',
  'model.placeholder': '模型名称，例如 gpt-6-astra',
  'model.fetchTitle': '获取模型列表',
  'model.thinkingTitle': '思考等级（默认不发送思考参数）',
  'model.fetchSuccess': '已获取模型列表（{n} 个）',
  'model.fetchFailed': '获取模型列表失败',

  /* —— 协议与思考等级 —— */
  'protocol.chat': '对话接口（Chat Completions）',
  'protocol.responses': 'Responses 接口（OpenAI）',
  'protocol.messages': 'Messages 接口（Claude）',
  'thinking.default': '默认（不发送）',
  'thinking.low': 'low',
  'thinking.medium': 'medium',
  'thinking.high': 'high',
  'thinking.xhigh': 'xhigh',
  'thinking.max': 'max',

  /* —— 结果预览 —— */
  'viewer.alt': 'SVG 生成结果预览',
  'viewer.canvasTitle': '拖拽平移 · Ctrl / ⌘ + 滚轮缩放 · 双击复位',
  'viewer.badgeWaiting': '等待测试',
  'viewer.badgeRunning': '请求中',
  'viewer.badgeOk': '测试成功',
  'viewer.badgeError': '测试失败',
  'viewer.stateGenerating': '正在生成…',
  'viewer.stateGeneratingDesc': '模型返回后会立即解析并预览 SVG。',
  'viewer.stateEmptyTitle': '还没有生成结果',
  'viewer.stateEmptyDesc': '在上方填写提示词并点击「开始测试」，或从左侧历史记录中恢复一次旧结果。',
  'viewer.stateErrorTitle': '本次测试失败',
  'viewer.stateNoSvgTitle': '没有解析出可预览的 SVG',
  'viewer.stateNoSvgDesc': '模型输出中不包含 <svg> 片段。',
  'viewer.metaProtocol': '协议：{name}',
  'viewer.metaDuration': '耗时 {d}',

  /* —— 通用下拉组件 —— */
  'select.empty': '暂无可选项',
  'combobox.empty': '暂无模型列表，可直接手动输入模型 ID',
  'combobox.noMatch': '没有匹配的模型，可直接手动输入',

  /* —— 控制器（流程编排） —— */
  'controller.busy': '已有请求正在进行，请先等待或取消。',
  'controller.noProvider': '还没有可用的供应商',
  'controller.noProviderHint': '请先添加并选择一个供应商。',
  'controller.noModel': '当前供应商还没有选择模型',
  'controller.noModelHint': '请在底部的模型输入框中填写或拉取模型。',
  'controller.done': '完成，耗时 {d}',
  'controller.connectionOk': '最近一次请求成功（{d}）',
  'controller.retrying': '请求失败，{seconds} 秒后进行第 {next}/{max} 次尝试…',
  'controller.historySaveFailed': '历史记录保存失败',
  'controller.noSvg': '没有解析出可预览的 SVG',
  'controller.noSvgHint': '本次结果不会保存到测试历史。',
  'controller.truncated': '模型输出可能被截断',
  'controller.truncatedHint': '已达到输出长度上限，SVG 可能不完整。',
  'controller.canceled': '请求已取消',
  'controller.canceledToast': '已取消请求',

  /* —— Base URL 校验 —— */
  'url.required': '请填写 Base URL',
  'url.invalid': 'Base URL 不是合法的绝对地址，请检查是否漏写了 https://',
  'url.unsupportedProtocol': '不支持的协议 {protocol}，请使用 http 或 https',
  'url.mixedContentWarning':
    '当前页面通过 HTTPS 打开，浏览器会拦截 HTTPS → HTTP 的混合内容请求。建议改用 https 地址或通过 http 打开本页面。',
  'url.localhostWarning': '本地地址需要在允许跨域的本地服务上运行，请确认该服务已开启 CORS。',

  /* —— HTTP 错误诊断 —— */
  'http.400.message': '请求被接口拒绝（HTTP 400）。',
  'http.400.hint': '常见原因：模型名称不正确、参数不被支持，或请求体格式不符合该接口要求。',
  'http.401.message': '认证失败（HTTP 401）。',
  'http.401.hint': '请检查 API Key 是否正确、是否已过期，以及是否需要带 Bearer 前缀。',
  'http.403.message': '没有访问权限（HTTP 403）。',
  'http.403.hint': 'API Key 可能无权访问该模型，或该模型未开通。',
  'http.404.message': '接口路径不存在（HTTP 404）。',
  'http.404.hint': '请检查 Base URL 是否完整，例如是否需要包含 /v1；本工具不会自动补 /v1。',
  'http.405.message': '请求方法不被支持（HTTP 405）。',
  'http.405.hint': '该地址可能不是所选协议对应的接口。',
  'http.408.message': '接口响应超时（HTTP {status}）。',
  'http.408.hint':
    'HTTP 504 是链路上某一层等待上游超时后返回的，最常见的是网关 / 反向代理（如 nginx 的 proxy_read_timeout，默认 60 秒）。这不是浏览器侧超时，调大本工具的超时没有用，需要调大那一层的超时，或换用响应更快的模型。',
  'http.413.message': '请求体过大（HTTP 413）。',
  'http.413.hint': '请缩短提示词后重试。',
  'http.422.message': '请求参数校验失败（HTTP 422）。',
  'http.422.hint': '接口不接受当前参数，请检查模型名称与思考参数配置。',
  'http.429.message': '请求过于频繁，已触发限流（HTTP 429）。',
  'http.429.hint': '请稍后重试，或检查账号配额。',
  'http.5xx.message': '接口服务端错误（HTTP {status}）。',
  'http.5xx.hint': '这通常是供应商侧的问题，可以稍后重试。',
  'http.other.message': '请求失败（HTTP {status}）。',
  'http.htmlDetail': '接口返回的是 HTML 页面而不是 JSON，通常说明地址指向了网页而不是 API。',
  'http.mixedContent.message': '请求被浏览器拦截：HTTPS 页面不允许访问 HTTP 接口（混合内容）。',
  'http.mixedContent.hint': '接口地址是 {target}。请把 Base URL 改成 https，或改用 http 打开本页面。',
  'http.cors.message': '接口有响应，但响应被浏览器拦截（缺少跨域头）。',
  'http.cors.hint':
    '服务器对 {target} 是有响应的，但响应里没有 Access-Control-Allow-Origin，浏览器因此拒绝把状态码交给页面——所以这里看不到真实的 HTTP 状态码（可能是 401/404，也可能是网关生成的 504）。请到 DevTools → Network 查看该请求的真实状态码。若要前端直接调用，需要接口方放行来源 {origin}，并允许 authorization、content-type 等请求头（OPTIONS 预检）。',
  'http.unreachable.message': '无法连接到接口：网络层完全无响应。',
  'http.unreachable.hint':
    '请求地址 {target} 没有任何响应。常见原因：域名解析失败、端口未开放、服务未启动，或本机网络 / DNS 异常。可先用 curl 直接请求该地址验证。',
  'http.probeTimeout.message': '无法连接到接口。',
  'http.probeTimeout.hint':
    '探测请求也超时了，无法确定原因。请求地址 {target}。常见原因：Base URL 写错、接口未开启 CORS 跨域、网络不可达，或服务响应极慢。',
  'http.dns.message': '无法解析接口域名。',
  'http.dns.hint': '请求地址 {target}。请检查 Base URL 中的域名拼写，以及本机 DNS 是否正常。',
  'http.refused.message': '无法连接到接口：连接被拒绝或中断。',
  'http.refused.hint': '请求地址 {target}。请确认该地址可访问、端口已开放、服务已启动。',
  'http.connectTimeout.message': '连接接口超时。',
  'http.connectTimeout.hint': '请求地址 {target}。请检查网络是否可达、目标服务是否在正常运行。',
  'http.cert.message': '接口 HTTPS 证书校验失败。',
  'http.cert.hint': '请求地址 {target}。请检查该地址的证书配置是否有效。',
  'http.offline.message': '本机网络不可用。',
  'http.offline.hint': '请检查本机网络连接（或代理设置）后重试。',
  'http.desktopUnknown.message': '无法连接到接口。',
  'http.desktopUnknown.hint': '请求地址 {target}。请检查地址、网络和接口服务状态。',
  'http.timeout.message': '请求超时（超过 {seconds} 秒未收到响应）。',
  'http.timeout.hint': '可以点击取消后重试，或换用响应更快的模型。',
  'http.canceled': '请求已取消。',
  'http.readFailed': '读取响应内容失败。',
  'http.invalidJson.message': '接口返回的内容不是合法 JSON。',
  'http.invalidJson.hintHtml':
    '返回的是 HTML 页面，通常说明 Base URL 指向了网页而不是 API，或中间存在需要登录的代理。',
  'http.invalidJson.hintProtocol': '请确认该地址与所选协议匹配（chat / responses / messages）。',
  'http.bodyError': '接口返回了错误信息。',
  'http.unknownError': '发生未知错误。',

  /* —— 推理服务 —— */
  'inference.thinkingDefault': '思考等级为「默认」，未发送思考参数',
  'inference.thinkingBudget': '已发送思考参数 thinking.budget_tokens={budget}',
  'inference.thinkingEffort': '已发送思考参数 reasoning.effort={effort}',
  'inference.thinkingReasoningEffort': '已发送思考参数 reasoning_effort={effort}',
  'inference.notObject': '接口返回的内容不是有效的 JSON 对象。',
  'inference.noChoices': '接口响应中没有 choices 字段。',
  'inference.noChoicesHint': '该地址可能不是 OpenAI 兼容的对话补全接口，可尝试切换协议。',
  'inference.noOutput': '接口响应中没有 output 字段。',
  'inference.noOutputHint': '该地址可能不是 OpenAI Responses 接口，可尝试切换协议。',
  'inference.noContent': '接口响应中没有 content 字段。',
  'inference.noContentHint': '该地址可能不是 Claude Messages 接口，可尝试切换协议。',
  'inference.reasoningOnly': '模型只返回了思考过程，没有返回最终回答。',
  'inference.reasoningOnlyHint': '可以把思考等级调低或关闭后重试，也可以调大输出长度限制。',
  'inference.emptyContent': '模型返回的内容为空。',
  'inference.emptyContentHint': '可以尝试更换模型或调整提示词后重试。',
  'inference.invalidBaseUrl': 'Base URL 不合法',
  'inference.modelRequired': '请先选择或填写模型名称。',
  'inference.promptRequired': '请先填写提示词。',

  /* —— 模型列表服务 —— */
  'models.buildUrlFailed': '无法根据 Base URL 拼接出模型列表地址',
  'models.empty.message': '接口调用成功，但响应中没有找到模型列表。',
  'models.empty.detail': '请求地址：{url}',
  'models.empty.hint':
    '本工具期望的返回结构是 { "data": [ { "id": "模型名" } ] }。该供应商可能不支持 /models 接口，请直接手动填写模型 ID。',

  /* —— SVG 解析 —— */
  'svg.xmlException': 'XML 解析异常，无法解析该内容',
  'svg.parseFailedWithMessage': 'XML 解析失败：{message}',
  'svg.parseFailed': 'XML 解析失败，内容不是合法的 SVG',
  'svg.noRoot': '内容中未找到 <svg> 根元素',
  'svg.emptyOutput': '模型返回内容为空',
  'svg.noBlock': '未在模型输出中找到完整的 <svg>…</svg> 片段（可能被截断或未按要求输出）',
  'svg.invalidFragment': 'SVG 片段无法通过 XML 校验',
  'svg.parseError': 'SVG 解析失败',
  'svg.serializeFailed': 'SVG 序列化失败',

  /* —— 本地存储 —— */
  'storage.quota':
    '浏览器本地存储空间不足，数据可能未保存成功。请清理浏览器存储或删除部分历史记录后重试。',
  'storage.failed': '本地存储操作失败。',
  'storage.unavailable':
    '当前浏览器环境不支持 IndexedDB（可能处于隐私模式或被浏览器策略禁用），已临时改用内存存储。',
  'storage.quotaWrite': '浏览器本地存储空间不足，写入失败。',
  'storage.readFailed': '读取本地数据失败：{message}',
  'storage.writeFailed': '写入本地数据失败：{message}',
  'storage.blocked': '本地数据库被其他标签页占用，请关闭本站的其他标签页后刷新重试。',
  'storage.historyNotFound': '找不到该历史记录',
  'storage.exportNote': '出于安全考虑，导出的数据不包含 API Key，导入后需要重新填写。',

  /* —— 时间格式化 —— */
  'time.justNow': '刚刚',
  'time.minutesAgo': '{n} 分钟前',
  'time.hoursAgo': '{n} 小时前',
};

/** 英文文案 */
const en = {
  /* —— Brand —— */
  'app.name': 'Pelican Test',
  'app.tagline': 'SVG Model Test',

  /* —— Common —— */
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.processing': 'Processing…',
  'common.processingSave': 'Saving…',
  'common.protocolTitle': 'Protocol: {label}',
  'common.notRecorded': 'Not recorded',
  'common.untitledTest': 'Untitled test',
  'common.unnamedProvider': 'Unnamed provider',
  'common.unknownError': 'Unknown error',
  'base64.notSet': '(not set)',

  /* —— Topbar —— */
  'topbar.lang.switch': 'Switch to {name}',
  'topbar.github.openTitle': 'Open GitHub repository: {url}',
  'topbar.github.openAria': 'Open GitHub repository',
  'topbar.github.disabledTitle': 'GitHub repository URL is not configured: set GITHUB_REPO_URL in js/config.js',
  'topbar.github.disabledAria': 'GitHub repository URL not configured',

  /* —— Banner & init —— */
  'banner.fileProtocol':
    'This page is opened directly via file://, so the browser may restrict ES modules and local storage. Run python3 -m http.server 5173 in the project directory and visit http://localhost:5173 instead.',
  'banner.memoryMode':
    '{message} Currently running in memory mode: providers and history will be lost on refresh.',
  'banner.storageUnavailable': 'IndexedDB is unavailable.',
  'app.loadFailed': 'Failed to load local data',
  'app.initFailed': 'Initialization failed',

  /* —— Prompt panel —— */
  'prompt.placeholder':
    'Describe the SVG you want the model to generate, e.g. a 2D animation of a pelican wearing a blue hat riding a bicycle by the sea.',
  'prompt.counter': '{n} characters',
  'prompt.loadExample': 'Load example',
  'prompt.clear': 'Clear',
  'prompt.addProvider': 'Add provider',
  'prompt.noProvider': 'No provider configured',
  'prompt.run': 'Run test',
  'prompt.running': 'Running…',
  'prompt.cancel': 'Cancel',
  'prompt.shortcut': 'Ctrl / ⌘ + Enter to run',
  'prompt.statusRunning': 'Calling the model, please wait…',
  'prompt.statusCanceled': 'Request canceled',
  'prompt.statusDone': 'Request completed',
  'prompt.required': 'Please enter a prompt first.',
  'prompt.runNoProvider': 'Add and select a provider first',
  'prompt.runNoModel': 'Enter or fetch a model in the config row first',
  'prompt.selectProvider': 'Switch provider',
  'prompt.editProvider': 'Edit current provider',
  'prompt.example':
    'Draw a 2D animation of a pelican wearing a blue hat riding a bicycle by the sea using SVG, with a clean composition and a clear subject.',

  /* —— Provider list —— */
  'supplier.section': 'Providers',
  'supplier.add': 'Add',
  'supplier.addTitle': 'Add provider',
  'supplier.editTitle': 'Edit provider',
  'supplier.deleteTitle': 'Delete provider',
  'supplier.confirmDeleteTitle': 'Delete provider',
  'supplier.confirmDeleteMessage': 'Delete “{name}”?',
  'supplier.confirmDeleteDetail':
    'Test history is kept: each record stores a snapshot of the configuration at that time.',
  'supplier.confirmDeleteConfirm': 'Delete',
  'supplier.deleteFailed': 'Delete failed',
  'supplier.deleted': 'Provider deleted',
  'supplier.emptyTitle': 'No providers yet',
  'supplier.emptyDesc': 'Add a model endpoint (Base URL + API key) to get started.',

  /* —— History —— */
  'history.section': 'History',
  'history.clear': 'Clear',
  'history.confirmClearTitle': 'Clear history',
  'history.confirmClearMessage': 'Clear all {n} history records?',
  'history.confirmClearDetail':
    'Only history records are removed; saved providers are not affected. This cannot be undone.',
  'history.confirmClearConfirm': 'Clear',
  'history.clearFailed': 'Failed to clear history',
  'history.cleared': 'History cleared',
  'history.deleteTitle': 'Delete this record',
  'history.emptyTitle': 'No history yet',
  'history.emptyDesc': 'Successful tests are saved here automatically, up to the latest {limit} records.',

  /* —— Provider modal —— */
  'modal.addTitle': 'Add provider',
  'modal.editTitle': 'Edit provider',
  'modal.nameLabel': 'Provider name',
  'modal.namePlaceholder': 'e.g. My Qwen API',
  'modal.baseUrlLabel': 'Base URL',
  'modal.apiKeyLabel': 'API Key',
  'modal.apiKeyToggle': 'Show / hide',
  'modal.apiKeyHint': 'The key is Base64-encoded and stored locally',
  'modal.apiKeySaved': 'Saved: {mask} (leave blank to keep it)',
  'modal.apiKeyClearPending': 'The saved API key will be removed when you save.',
  'modal.showStoredKey': 'Show saved key',
  'modal.clearStoredKey': 'Remove saved key',
  'modal.cancelClearKey': 'Cancel removal',
  'modal.save': 'Save provider',
  'modal.baseUrlWillUse': 'Will use: {url}',
  'modal.saveFailed': 'Save failed',
  'modal.savedAdd': 'Provider added',
  'modal.savedEdit': 'Provider updated',
  'modal.baseUrlWarning': 'Base URL warning',

  /* —— Model select —— */
  'model.protocolTitle': 'Protocol',
  'model.placeholder': 'Model name, e.g. gpt-6-astra',
  'model.fetchTitle': 'Fetch model list',
  'model.thinkingTitle': 'Thinking level (no thinking parameters sent by default)',
  'model.fetchSuccess': 'Fetched {n} models',
  'model.fetchFailed': 'Failed to fetch models',

  /* —— Protocols & thinking —— */
  'protocol.chat': 'Chat Completions',
  'protocol.responses': 'Responses (OpenAI)',
  'protocol.messages': 'Messages (Claude)',
  'thinking.default': 'Default (not sent)',
  'thinking.low': 'low',
  'thinking.medium': 'medium',
  'thinking.high': 'high',
  'thinking.xhigh': 'xhigh',
  'thinking.max': 'max',

  /* —— Viewer —— */
  'viewer.alt': 'Generated SVG preview',
  'viewer.canvasTitle': 'Drag to pan · Ctrl / ⌘ + wheel to zoom · double-click to reset',
  'viewer.badgeWaiting': 'Waiting',
  'viewer.badgeRunning': 'Running',
  'viewer.badgeOk': 'Success',
  'viewer.badgeError': 'Failed',
  'viewer.stateGenerating': 'Generating…',
  'viewer.stateGeneratingDesc': 'The SVG will be parsed and previewed as soon as the model responds.',
  'viewer.stateEmptyTitle': 'No result yet',
  'viewer.stateEmptyDesc':
    'Enter a prompt above and click “Run test”, or restore a previous result from the history list.',
  'viewer.stateErrorTitle': 'Test failed',
  'viewer.stateNoSvgTitle': 'No previewable SVG found',
  'viewer.stateNoSvgDesc': 'The model output does not contain an <svg> fragment.',
  'viewer.metaProtocol': 'Protocol: {name}',
  'viewer.metaDuration': 'Duration: {d}',

  /* —— Generic dropdowns —— */
  'select.empty': 'No options',
  'combobox.empty': 'No model list yet — type a model ID manually',
  'combobox.noMatch': 'No matching model — type a model ID manually',

  /* —— Controller —— */
  'controller.busy': 'A request is already running. Wait for it or cancel it first.',
  'controller.noProvider': 'No provider available',
  'controller.noProviderHint': 'Add and select a provider first.',
  'controller.noModel': 'No model selected for this provider',
  'controller.noModelHint': 'Enter or fetch a model in the input at the bottom.',
  'controller.done': 'Completed in {d}',
  'controller.connectionOk': 'Last request succeeded ({d})',
  'controller.retrying': 'Request failed; retrying in {seconds}s (attempt {next}/{max})…',
  'controller.historySaveFailed': 'Failed to save history',
  'controller.noSvg': 'No previewable SVG found',
  'controller.noSvgHint': 'This result will not be saved to history.',
  'controller.truncated': 'Model output may be truncated',
  'controller.truncatedHint': 'The output length limit was reached; the SVG may be incomplete.',
  'controller.canceled': 'Request canceled',
  'controller.canceledToast': 'Request canceled',

  /* —— Base URL validation —— */
  'url.required': 'Please enter a Base URL',
  'url.invalid': 'The Base URL is not a valid absolute URL; check for a missing https://',
  'url.unsupportedProtocol': 'Unsupported protocol {protocol}; use http or https',
  'url.mixedContentWarning':
    'This page is served over HTTPS, so the browser will block HTTPS → HTTP mixed-content requests. Use an https URL or open this page over http.',
  'url.localhostWarning':
    'Local addresses must be served with CORS enabled; make sure the local service allows cross-origin requests.',

  /* —— HTTP diagnostics —— */
  'http.400.message': 'The API rejected the request (HTTP 400).',
  'http.400.hint':
    'Common causes: wrong model name, unsupported parameters, or a request body that does not match the API.',
  'http.401.message': 'Authentication failed (HTTP 401).',
  'http.401.hint': 'Check whether the API key is correct, expired, or needs a Bearer prefix.',
  'http.403.message': 'Access denied (HTTP 403).',
  'http.403.hint': 'The API key may not have access to this model, or the model is not enabled.',
  'http.404.message': 'Endpoint not found (HTTP 404).',
  'http.404.hint':
    'Check that the Base URL is complete, e.g. whether it should include /v1. This tool never appends /v1 automatically.',
  'http.405.message': 'Method not allowed (HTTP 405).',
  'http.405.hint': 'This URL may not match the selected protocol.',
  'http.408.message': 'The API timed out (HTTP {status}).',
  'http.408.hint':
    'HTTP 504 is returned by a layer on the path (most often a gateway / reverse proxy such as nginx with proxy_read_timeout, 60s by default) waiting for upstream. This is not a browser-side timeout; increasing this tool’s timeout will not help — raise that layer’s timeout or use a faster model.',
  'http.413.message': 'Payload too large (HTTP 413).',
  'http.413.hint': 'Shorten the prompt and retry.',
  'http.422.message': 'Request validation failed (HTTP 422).',
  'http.422.hint': 'The API does not accept the current parameters; check the model name and thinking settings.',
  'http.429.message': 'Rate limited (HTTP 429).',
  'http.429.hint': 'Retry later, or check your account quota.',
  'http.5xx.message': 'API server error (HTTP {status}).',
  'http.5xx.hint': 'This is usually on the provider side; retry later.',
  'http.other.message': 'Request failed (HTTP {status}).',
  'http.htmlDetail':
    'The API returned an HTML page instead of JSON — the URL probably points to a web page rather than an API.',
  'http.mixedContent.message':
    'Blocked by the browser: an HTTPS page cannot call an HTTP API (mixed content).',
  'http.mixedContent.hint':
    'The API address is {target}. Change the Base URL to https, or open this page over http.',
  'http.cors.message': 'The API responded, but the browser blocked the response (missing CORS headers).',
  'http.cors.hint':
    'The server did respond to {target}, but the response has no Access-Control-Allow-Origin header, so the browser refuses to expose the status code to the page — that is why the real HTTP status (which could be 401/404 or a gateway-generated 504) is invisible here. Check the real status in DevTools → Network. To call the API directly from the frontend, the API side must allow origin {origin} and permit headers such as authorization and content-type (OPTIONS preflight).',
  'http.unreachable.message': 'Cannot reach the API: no response at the network level.',
  'http.unreachable.hint':
    'There is no response from {target}. Common causes: DNS resolution failure, closed port, service not running, or local network / DNS problems. Try requesting the address with curl to verify.',
  'http.probeTimeout.message': 'Cannot reach the API.',
  'http.probeTimeout.hint':
    'The probe request also timed out, so the cause cannot be determined. Request address: {target}. Common causes: a wrong Base URL, CORS not enabled on the API, an unreachable network, or a very slow service.',
  'http.dns.message': 'Cannot resolve the API domain.',
  'http.dns.hint': 'Request address: {target}. Check the domain spelling in the Base URL and your DNS.',
  'http.refused.message': 'Cannot reach the API: connection refused or interrupted.',
  'http.refused.hint': 'Request address: {target}. Make sure the address is reachable, the port is open, and the service is running.',
  'http.connectTimeout.message': 'Connection timed out.',
  'http.connectTimeout.hint': 'Request address: {target}. Check network reachability and whether the target service is running.',
  'http.cert.message': 'API HTTPS certificate validation failed.',
  'http.cert.hint': 'Request address: {target}. Check whether the certificate for this address is valid.',
  'http.offline.message': 'Local network unavailable.',
  'http.offline.hint': 'Check your network connection (or proxy settings) and retry.',
  'http.desktopUnknown.message': 'Cannot reach the API.',
  'http.desktopUnknown.hint': 'Request address: {target}. Check the address, network, and API service status.',
  'http.timeout.message': 'Request timed out (no response after {seconds}s).',
  'http.timeout.hint': 'Cancel and retry, or use a faster model.',
  'http.canceled': 'Request canceled.',
  'http.readFailed': 'Failed to read the response body.',
  'http.invalidJson.message': 'The API response is not valid JSON.',
  'http.invalidJson.hintHtml':
    'The response is an HTML page — the Base URL probably points to a web page rather than an API, or there is a login-protected proxy in between.',
  'http.invalidJson.hintProtocol': 'Make sure the URL matches the selected protocol (chat / responses / messages).',
  'http.bodyError': 'The API returned an error.',
  'http.unknownError': 'An unknown error occurred.',

  /* —— Inference —— */
  'inference.thinkingDefault': 'Thinking level is “default”; no thinking parameters were sent',
  'inference.thinkingBudget': 'Sent thinking parameter thinking.budget_tokens={budget}',
  'inference.thinkingEffort': 'Sent thinking parameter reasoning.effort={effort}',
  'inference.thinkingReasoningEffort': 'Sent thinking parameter reasoning_effort={effort}',
  'inference.notObject': 'The API response is not a valid JSON object.',
  'inference.noChoices': 'The response has no choices field.',
  'inference.noChoicesHint': 'This URL may not be an OpenAI-compatible chat completions API; try switching protocols.',
  'inference.noOutput': 'The response has no output field.',
  'inference.noOutputHint': 'This URL may not be an OpenAI Responses API; try switching protocols.',
  'inference.noContent': 'The response has no content field.',
  'inference.noContentHint': 'This URL may not be a Claude Messages API; try switching protocols.',
  'inference.reasoningOnly': 'The model returned only its reasoning, with no final answer.',
  'inference.reasoningOnlyHint': 'Lower or disable the thinking level and retry, or raise the output length limit.',
  'inference.emptyContent': 'The model returned empty content.',
  'inference.emptyContentHint': 'Try another model or adjust the prompt and retry.',
  'inference.invalidBaseUrl': 'Invalid Base URL',
  'inference.modelRequired': 'Select or enter a model name first.',
  'inference.promptRequired': 'Please enter a prompt first.',

  /* —— Model list service —— */
  'models.buildUrlFailed': 'Cannot build the model list URL from the Base URL',
  'models.empty.message': 'The request succeeded, but no model list was found in the response.',
  'models.empty.detail': 'Request URL: {url}',
  'models.empty.hint':
    'The expected shape is { "data": [ { "id": "model-name" } ] }. This provider may not support the /models endpoint — enter the model ID manually.',

  /* —— SVG parsing —— */
  'svg.xmlException': 'XML parsing error: the content could not be parsed',
  'svg.parseFailedWithMessage': 'XML parsing failed: {message}',
  'svg.parseFailed': 'XML parsing failed: the content is not valid SVG',
  'svg.noRoot': 'No <svg> root element found',
  'svg.emptyOutput': 'The model returned empty content',
  'svg.noBlock':
    'No complete <svg>…</svg> fragment found in the model output (it may be truncated or not produced as requested)',
  'svg.invalidFragment': 'The SVG fragment failed XML validation',
  'svg.parseError': 'SVG parsing failed',
  'svg.serializeFailed': 'SVG serialization failed',

  /* —— Local storage —— */
  'storage.quota':
    'Browser storage is full; the data may not have been saved. Free up browser storage or delete some history records and retry.',
  'storage.failed': 'Local storage operation failed.',
  'storage.unavailable':
    'IndexedDB is not available in this environment (private mode or browser policy), so in-memory storage is used temporarily.',
  'storage.quotaWrite': 'Browser storage is full; write failed.',
  'storage.readFailed': 'Failed to read local data: {message}',
  'storage.writeFailed': 'Failed to write local data: {message}',
  'storage.blocked': 'The local database is locked by another tab. Close other tabs of this site and refresh.',
  'storage.historyNotFound': 'History record not found',
  'storage.exportNote': 'For security, exported data does not include API keys; they must be re-entered after import.',

  /* —— Time formatting —— */
  'time.justNow': 'just now',
  'time.minutesAgo': '{n} min ago',
  'time.hoursAgo': '{n} hr ago',
};

const DICTS = { zh, en };

/** 归一化语言值：非法值一律回退默认语言 */
export function normalizeLocale(value) {
  return value === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** 从 localStorage 读取上次选择的语言（不可用时回退默认） */
function readStoredLocale() {
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    return DEFAULT_LOCALE;
  }
}

/** 持久化语言选择（不可用时静默忽略，仅本次会话生效） */
function storeLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch (error) {
    // 忽略：隐私模式 / 存储被禁用时仅内存生效
  }
}

let current = readStoredLocale();

/** 当前语言 */
export function getLocale() {
  return current;
}

/** 语言显示名（用于切换按钮的提示） */
export function localeName(locale = current) {
  return locale === 'en' ? 'English' : '中文';
}

/** 切换按钮上展示的短标签（显示目标语言） */
export function localeShortLabel(locale = current) {
  return locale === 'en' ? 'EN' : '中';
}

/** 下一个语言（两语言间切换） */
export function nextLocale(locale = current) {
  return locale === 'en' ? 'zh' : 'en';
}

/**
 * 设置当前语言：同步更新模块状态、<html lang> 与 localStorage。
 * 注意：这里不触发重渲染；组件感知语言变化通过 store.setLocale() → notify()。
 */
export function setLocale(next) {
  current = normalizeLocale(next);
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[current];
  storeLocale(current);
  return current;
}

/**
 * 取文案并插值：t('time.minutesAgo', { n: 5 })
 * - 当前语言缺失时回退中文，再缺失时回退 key 本身（并输出警告，便于开发期发现漏翻）。
 * @param {string} key
 * @param {Record<string, any>} [vars]
 */
export function t(key, vars) {
  const dict = DICTS[current] || zh;
  let text = dict[key];
  if (text === undefined) {
    text = zh[key];
    if (text === undefined) {
      console.warn(`[i18n] 缺少文案：${key}`);
      return key;
    }
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

// 模块加载时同步应用语言（<html lang>），保证首屏即为最终语言
setLocale(current);
