# 鹈鹕测试 · SVG 模型测试

一个用于测试大语言模型生成 SVG 图形能力的工具，提供**网页版**与**桌面版**两种运行方式。
支持多协议模型接入（OpenAI 兼容对话接口 / OpenAI Responses 接口 / Anthropic Messages 接口）、
模型列表拉取、提示词测试、SVG 预览与历史记录管理，所有数据保存在本机，
不需要任何后端服务。

技术栈：原生 HTML + CSS + JavaScript（ES Modules）。网页版零构建、零运行时依赖；
桌面版基于 Electron（`desktop/`），只负责解决浏览器跨域限制，业务代码完全共用。

## 运行方式

### 网页版

由于使用了 ES Modules 与 IndexedDB，**不能直接双击 `index.html`（file:// 协议）打开**，
需要通过一个静态服务器访问：

```bash
# 任选一种
python3 -m http.server 5173
npx serve .
```

然后访问 <http://localhost:5173>。

网页版由浏览器直接请求模型接口，因此**要求接口开启 CORS 跨域**（响应包含
`Access-Control-Allow-Origin`，且允许 `authorization`、`content-type` 等请求头通过预检）。

### 桌面版（Windows）

桌面版把请求交给 Electron 主进程发出，**不受浏览器同源策略约束，接口无需开启 CORS**。

```bash
npm install          # 首次安装会下载 Electron 二进制
npm run dev          # 开发模式启动
npm run build:win    # 构建 Windows 安装包与免安装版（产物在 dist/）
```

在 GitHub 上打 tag（如 `v1.0.0`）会触发 Actions 自动构建并发布 Release；
也可以在 Actions 页面手动触发 `.github/workflows/build-desktop.yml`。

## 需要补充的配置

`js/config.js` 中的 `GITHUB_REPO_URL` 默认为空字符串。填写真实仓库地址后，
顶部导航栏右侧的 GitHub 图标才会变为可点击的链接；留空时图标保持禁用状态并给出提示
（此处刻意没有预置任何猜测的地址）。

```js
export const GITHUB_REPO_URL = 'https://github.com/<你的账号>/<你的仓库>';
```

## 使用流程

1. **添加供应商**：只需要 Base URL 与 API Key；名称可留空，留空时自动使用 Base URL 的域名。
   API Key 会以 Base64 编码后保存在浏览器本地。
2. **选择模型**：在提示词面板底部，先选供应商，再选协议并填写模型。
   - 点击「获取模型」调用 `{Base URL}/models` 拉取候选模型；
   - 拉取失败时按协议给出默认建议：Responses → GPT 系列、Messages → Claude 系列、
     Chat → 留空由用户手动输入；
   - 模型输入框始终支持手动输入任意模型 ID。
3. **（可选）配置思考参数**：点击「思考」按钮，按当前协议选择等级与参数。
   默认不发送任何思考参数。
4. **开始测试**：填写提示词后点击「开始测试」（或 Ctrl / ⌘ + Enter）。
   结果、原始响应与当时的配置快照都会保存在本地历史记录中。

## 目录结构

```
index.html                 页面骨架（顶栏 / 侧边栏挂载点 / 工作区挂载点）
styles/
  base.css                 设计变量、重置、整体布局、侧边栏、面板
  components.css           按钮、表单、列表、弹窗、SVG 预览器、Toast
js/
  config.js                全局常量（仓库地址、协议与端点、默认模型建议、思考参数预设等）
  app.js                   应用入口，装配所有组件
  controller.js            编排「发起请求 → 解析 → 写入历史」流程
  utils/
    dom.js                 DOM 创建与时间/耗时格式化、剪贴板、下载、按钮加载态
    base64.js              API Key 的 Base64 编解码（含「不是加密」的说明）
    url.js                 Base URL 规范化与端点拼接
    svg.js                 SVG 提取、白名单安全清理、尺寸兜底
    icons.js               内置图标（Octicons GitHub 图标 + Lucide 风格线性图标）
    platform.js            运行环境判定：桌面版 / 网页版（window.pelicanDesktop 是否存在）
  services/
    http.js                统一请求层：超时、取消、错误分类、密钥脱敏；网页走浏览器 fetch，桌面走主进程
    models.js              获取模型列表并解析多种返回结构
    inference.js           三种协议的请求构造、思考参数适配与响应解析
  store/
    db.js                  IndexedDB 封装（含内存降级与配额错误处理）
    state.js               应用状态与数据动作（订阅式重渲染）
  components/
    sidebar.js             侧边栏容器（供应商 / 历史折叠面板 + 数据导出）
    supplierList.js        供应商列表（可折叠，含协议标签与连接状态）
    supplierModal.js       供应商新增/编辑弹窗（名称 / Base URL / API Key）
    modelSelect.js         模型选择区（协议下拉 + 模型输入 + 获取模型 + 思考）
    thinkingModal.js       思考参数配置弹窗（预设按协议过滤）
    combobox.js            可搜索下拉框（支持手动输入）
    historyList.js         测试历史列表（可折叠）
    promptPanel.js         提示词输入、供应商与模型选择、开始测试
    svgViewer.js           SVG 预览（滚轮缩放 / 拖拽平移 / 双击复位）、全屏、源码、复制、下载
    confirmDialog.js       二次确认弹窗
    toast.js               轻量提示
desktop/
  main.js                  Electron 主进程：app:// 协议加载页面 + 原生侧 HTTP 桥（net.fetch）
  preload.js               预加载脚本：只向页面暴露 request / cancel 两个方法
build/
  icon.ico                 Windows 应用与安装包图标
.github/workflows/
  build-desktop.yml        Windows 安装包自动构建与发布
package.json               Electron 依赖与 electron-builder 打包配置（网页版不依赖它）
```

## 关键实现说明

### 接口协议

三种协议使用不同的端点与请求体，全部在 `services/inference.js` 中收敛：

| 协议 | 端点 | 请求体要点 | 响应解析 |
| --- | --- | --- | --- |
| chat | `POST {Base URL}/chat/completions` | `messages`（system + user）、`stream: false` | `choices[0].message.content` |
| responses | `POST {Base URL}/responses` | `instructions` + `input` | `output_text`，或遍历 `output[].content[].text` |
| messages | `POST {Base URL}/messages` | `system` + `messages` + 必填 `max_tokens`（固定 8192） | `content[]` 中的 `text` / `thinking` 块 |

Messages 协议的请求头带 `x-api-key`、`anthropic-version` 与
`anthropic-dangerous-direct-browser-access: true`（浏览器直连必需，否则 CORS 预检会被拒绝），
并同时附带 `Authorization: Bearer` 以兼容只认 Bearer 的网关。

### SVG 安全渲染

模型输出**不会**被当作可信 HTML 插入页面，采用两层防护：

1. `utils/svg.js` 用 `DOMParser` 以 `image/svg+xml` 解析后遍历 DOM，按白名单保留元素，
   移除 `<script>`、`<foreignObject>`、`on*` 事件属性、外部资源引用（`href` / `src` /
   CSS `url()` 中的外部地址），并剥离 `<!DOCTYPE>` 与实体声明以避免实体扩展攻击。
2. 清理后的 SVG 通过 Blob URL 交给 `<img>` 渲染。在 `<img>` 上下文中浏览器不会执行
   SVG 内的脚本，也不会加载外部资源，即使清理有遗漏也无法在页面上下文执行代码。

因此预览与源码、下载都使用清理后的版本；原始模型响应会被完整保留，可在
「原始响应」标签页中查看。

### API Key 存储

API Key 在写入 IndexedDB 之前会用 Base64 编码（`utils/base64.js`）。

**Base64 只是编码格式，不是加密，不提供任何保密能力。** 任何能访问本页面运行环境或
浏览器存储的人都可以还原出原始密钥。如果将来要公开部署或面向多人使用，
必须另外设计真正的密钥保护与访问控制方案（例如由服务端代理请求、密钥托管在服务端）。

界面默认只展示掩码（`sk-••••••1234`），错误信息与响应内容在输出前都会做密钥脱敏。

### 模型选择与默认建议

模型选择区位于「选择供应商」之后（提示词面板底部）。点击「获取模型」会请求
`{Base URL}/models`，成功时把返回的模型 ID 作为候选；失败时按当前协议回退到
`js/config.js` 中 `PROTOCOLS[].defaultModels` 的默认建议：

- Responses 协议 → GPT 系列（如 `gpt-6-astra`、`gpt-6.1-sol`、`gpt-6-luna` 等）
- Messages 协议 → Claude 系列（如 `claude-fable-5-1`、`claude-opus-5-5` 等）
- Chat 协议 → 不预置建议，由用户手动输入

默认建议只是方便起步，**不代表这些模型一定可用**，可以直接修改 `js/config.js` 中的列表。
拉取到的模型列表仅缓存在内存中，刷新页面后需要重新拉取。

### 思考参数

不同协议 / 供应商 / 模型对思考参数的支持方式完全不同，因此本工具：

- 默认「自动」，即不发送任何思考参数；
- 预设按协议区分：chat 提供 `reasoning_effort`、`enable_thinking`、`thinking_budget`，
  responses 提供 `reasoning.effort`，messages 提供 `thinking.budget_tokens`；
- 参数名支持点号路径（如 `reasoning.effort` 会构造出 `{"reasoning":{"effort":...}}`），
  取值类型（字符串 / 数字 / 布尔）与各等级取值都可以改写；
- messages 协议下只要配置了 `thinking.*` 参数，会自动补充 `thinking.type = "enabled"`，
  且思考预算需小于固定的 `max_tokens`（8192）；
- 只有显式开启且配置完整时才会把参数附加到请求体，不会把某个供应商的私有参数
  无条件发给所有接口。

**本工具只按配置原样发送参数，不保证模型一定遵循所选等级。**

### Base URL 处理

`utils/url.js` 会去掉末尾斜杠，并剥离重复的 `/chat/completions`、`/completions`、
`/responses`、`/messages`、`/models` 后缀，避免出现 `.../v1/v1/models` 这类地址。
工具**不会**自动补 `/v1`，因为不同网关前缀不同，猜测只会掩盖真实错误。

### 桌面端与跨域

浏览器出于同源策略，会拦截网页对第三方域名的跨域请求（CORS）。网页版受此限制，
桌面版则把请求移出浏览器：

```
渲染进程（页面）── window.pelicanDesktop.request() ──> preload 桥 ──> 主进程 net.fetch ──> 模型接口
```

- 页面通过自定义协议 `app://pelican` 加载（`desktop/main.js`），因此 ES Modules 与
  IndexedDB 都正常工作，与网页版行为一致；
- 请求由主进程的 `net.fetch` 发出，这是 Chromium 网络栈的原生调用，不受 CORS 约束，
  能拿到真实的 HTTP 状态码与网络错误码；网页版在 CORS 被拦时只能看到笼统的 `TypeError`，
  需要额外发一次 no-cors 探测来区分「服务器无响应」与「响应缺跨域头」；
- 渲染进程只通过 preload 暴露的 `request` / `cancel` 两个方法与外界通信，
  开启了 `contextIsolation`、关闭了 `nodeIntegration`；
- 主进程只接受 `http` / `https` 协议的目标地址，其余协议一律拒绝；
- 取消在渲染侧立即生效（不等待主进程确认），同时通知主进程中止底层连接。

两种模式的差异集中在 `js/services/http.js` 与 `js/utils/platform.js`，其余代码完全共用。

## 已知限制

- 网页版只实现了浏览器直接调用接口的方式。如果接口未开启 CORS 跨域，浏览器会拦截请求，
  页面会明确提示这是跨域/网络问题——网页版不会引入代理服务绕过限制，需要绕开时请使用桌面版。
- 无法访问 `/models` 不代表推理接口不可用，可以手动输入模型 ID 后单独测试；
  Anthropic 的 `/models` 需要 `x-api-key` 与版本号（本工具已按协议携带）。
- 请求为非流式（`stream: false`），默认超时 600 秒，支持手动取消。
- IndexedDB 不可用（隐私模式、浏览器策略限制）时会降级为内存存储，页面顶部会有明确提示，
  此时刷新页面数据会丢失。
- 历史记录最多保留 10 条，超出后自动淘汰最旧的一条；删除供应商不会删除历史记录。
- 桌面版目前只配置了 Windows 构建（NSIS 安装包 + 免安装版）；未做代码签名，
  Windows 首次运行可能弹出 SmartScreen 提示，选择「仍要运行」即可。
- 桌面版不包含任何自动更新、遥测或崩溃上报通道，升级需要手动下载新版本。
