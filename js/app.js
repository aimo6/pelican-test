/**
 * 应用入口：装配所有组件并启动。
 */

import { APP_NAME, APP_TAGLINE, GITHUB_REPO_URL } from './config.js';
import { clear, el } from './utils/dom.js';
import { icon } from './utils/icons.js';
import { store } from './store/state.js';
import { createController } from './controller.js';
import { createPromptPanel } from './components/promptPanel.js';
import { createSidebar } from './components/sidebar.js';
import { createSupplierModal } from './components/supplierModal.js';
import { createSvgViewer } from './components/svgViewer.js';
import { initToast, toastError } from './components/toast.js';

const appRoot = document.getElementById('app');
const bannerRoot = document.getElementById('banner-root');
const topbarActions = document.getElementById('topbar-actions');
const sidebarRoot = document.getElementById('sidebar');
const workspaceRoot = document.getElementById('workspace');
const toastRoot = document.getElementById('toast-root');
const brandName = document.getElementById('brand-name');
const brandTag = document.getElementById('brand-tag');

/** 渲染顶部导航栏右侧的 GitHub 入口 */
function renderTopbar() {
  brandName.textContent = APP_NAME;
  brandTag.textContent = APP_TAGLINE;
  document.title = `${APP_NAME} · ${APP_TAGLINE}`;

  clear(topbarActions);
  const repoUrl = String(GITHUB_REPO_URL || '').trim();

  if (repoUrl) {
    topbarActions.appendChild(
      el('a', {
        class: 'icon-btn icon-btn--lg',
        href: repoUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: '打开 GitHub 仓库',
        html: icon('github', { size: 20 }),
      }),
    );
    return;
  }

  // 未配置仓库地址时保持禁用状态，不跳转到任何猜测出来的地址
  topbarActions.appendChild(
    el('button', {
      class: 'icon-btn icon-btn--lg',
      type: 'button',
      disabled: true,
      title: '尚未配置 GitHub 仓库地址：请在 js/config.js 中填写 GITHUB_REPO_URL',
      html: icon('github', { size: 20 }),
    }),
  );
}

/** 顶部提示条：存储降级、file:// 打开等环境问题 */
function renderBanner() {
  const { storageMode, storageError } = store.state;
  clear(bannerRoot);

  const messages = [];
  if (window.location.protocol === 'file:') {
    messages.push({
      tone: 'warning',
      text: '当前页面通过 file:// 直接打开，浏览器可能限制 ES 模块与本地存储。建议在项目目录执行 python3 -m http.server 5173，然后访问 http://localhost:5173。',
    });
  }
  if (storageMode === 'memory') {
    messages.push({
      tone: 'error',
      text: `${(storageError && storageError.message) || 'IndexedDB 不可用。'}当前处于内存模式，供应商配置与历史记录在刷新后会丢失。`,
    });
  }

  for (const message of messages) {
    bannerRoot.appendChild(
      el('div', { class: `banner banner--${message.tone}` }, [
        el('span', { class: 'banner__icon', html: icon('alert', { size: 15 }) }),
        el('span', { class: 'banner__text', text: message.text }),
      ]),
    );
  }
}

/** 装配主工作区 */
function mountWorkspace() {
  const controller = createController(store);
  const promptPanel = createPromptPanel(store, controller);
  const svgViewer = createSvgViewer(store);

  clear(workspaceRoot);
  workspaceRoot.appendChild(promptPanel.root);
  workspaceRoot.appendChild(svgViewer.root);

  return { controller, promptPanel, svgViewer };
}

async function main() {
  initToast(toastRoot);
  renderTopbar();

  const sidebar = createSidebar(store);
  clear(sidebarRoot);
  sidebarRoot.appendChild(sidebar.root);

  const workspace = mountWorkspace();
  createSupplierModal(store);

  // 调试入口：在浏览器控制台可通过 __pelican.store 查看当前状态
  window.__pelican = { store, workspace };

  store.subscribe(renderBanner);
  renderBanner();

  try {
    const { loadError } = await store.init();
    if (loadError) {
      toastError('读取本地数据失败', loadError.message || String(loadError));
    }
  } catch (error) {
    toastError('初始化失败', String(error && error.message ? error.message : error));
    console.error('[app] 初始化异常：', error);
  }
}

main();
