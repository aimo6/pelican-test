# 鹈鹕测试 · SVG 模型测试

用于测试大语言模型生成 SVG 图形能力的小工具，有**网页版**和**桌面版**两种用法。
支持 OpenAI 兼容对话接口、OpenAI Responses、Anthropic Messages 三种协议，
可以拉取模型列表、发提示词测试、预览 SVG、保存历史记录。

零构建、零后端：原生 HTML + CSS + JavaScript（ES Modules），桌面版基于 Electron（`desktop/`）。

## 数据保存在本地，安全可控

所有数据都存在你自己的机器上，**不经过任何服务器，也不会上传**：

- 供应商（Base URL、API Key）、测试历史都保存在浏览器/本机的 IndexedDB 中；
- API Key 只在本地存储、只发送给你填写的接口地址，界面上默认掩码显示（`sk-••••••1234`），
  错误信息和响应内容在展示前也会做密钥脱敏；
- 项目自身不包含任何遥测、统计或上报代码，断网也能正常使用（只要接口可达）。

> 说明：API Key 落盘前只做了 Base64 编码，**这不是加密**，能访问本机浏览器存储的人仍可还原出密钥。
> 请只在自己的电脑上使用，不要把浏览器数据目录分享给别人。

## 运行方式

### 网页版

因为用了 ES Modules 与 IndexedDB，**不能直接双击 `index.html`**，需要起一个静态服务器：

```bash
python3 -m http.server 5173   # 或 npx serve .
```

然后访问 <http://localhost:5173>。

网页版由浏览器直接请求模型接口，要求接口开启 CORS 跨域；若被拦截，页面会给出明确提示
（本工具不内置代理，需要绕开时请用桌面版）。

### 桌面版（Windows）

桌面版把请求交给 Electron 主进程发出，**不受浏览器同源策略限制，接口无需开启 CORS**。

```bash
npm install        # 首次安装会下载 Electron 二进制
npm run dev        # 开发模式启动
npm run build:win  # 构建 Windows 安装包与免安装版（产物在 dist/）
```

打 tag（如 `v1.0.0`）会触发 GitHub Actions 自动构建并发布 Release。

## 使用流程

1. **添加供应商**：填 Base URL 与 API Key 即可，名称可留空（自动用域名）。
2. **选择模型**：先选供应商，再选协议并填写模型；点输入框右侧箭头可从 `{Base URL}/models`
   拉取候选模型，也可以直接手动输入模型 ID。
3. **（可选）设置思考等级**：默认不发送任何思考参数，参数形式按协议自动映射。
4. **开始测试**：填好提示词后点「开始测试」（或 Ctrl / ⌘ + Enter）。
   成功生成图片的测试会连同当时的配置快照存入本地历史（最多 10 条），
   失败或没解析出 SVG 的测试只显示在结果区，不写入历史。

## 界面预览

<!-- TODO: 补充截图 -->

| 主界面 | SVG 预览 |
| --- | --- |
| ![主界面](docs/images/main.png) | ![SVG 预览](docs/images/viewer.png) |

## 已知限制

- 请求为非流式，默认超时 600 秒，支持手动取消。
- 浏览器隐私模式等场景下 IndexedDB 不可用时，会降级为内存存储（页面有提示，刷新即丢）。
- 桌面版目前只提供 Windows 构建，未做代码签名，首次运行可能弹 SmartScreen 提示，选择「仍要运行」即可。

---

# Pelican Test · SVG Model Test (English)

A small tool for testing how well LLMs generate SVG graphics. Available as a **web app** and a
**desktop app** (Electron). Supports OpenAI-compatible chat, OpenAI Responses, and Anthropic
Messages protocols, with model listing, prompt testing, SVG preview, and local history.

Zero build, zero backend: plain HTML + CSS + JavaScript (ES Modules).

## Your data stays local

Everything is stored on your own machine — **no server, no uploads**:

- Suppliers (Base URL, API Key) and test history live in your local IndexedDB;
- API Keys are only stored locally and only sent to the endpoint you configure, masked in the UI
  (`sk-••••••1234`) and redacted from error messages;
- No telemetry or reporting code of any kind.

> Note: API Keys are only Base64-encoded before storage — **that is not encryption**.

## Running

**Web**: ES Modules + IndexedDB require a static server (you cannot open `index.html` directly):

```bash
python3 -m http.server 5173   # or npx serve .
```

Then open <http://localhost:5173>. The API must allow CORS, since the browser calls it directly.

**Desktop (Windows)**: requests are made from the Electron main process, so **CORS is not required**.

```bash
npm install
npm run dev
npm run build:win   # NSIS installer + portable build in dist/
```

## Usage

1. Add a supplier: Base URL + API Key (name optional).
2. Pick the supplier, protocol, and model — fetch candidates from `{Base URL}/models` or type an ID.
3. Optionally set the reasoning level (nothing is sent by default).
4. Enter a prompt and hit "Run test" (Ctrl / ⌘ + Enter). Successful SVGs are saved to local
   history (max 10 entries); failures are shown but not saved.
