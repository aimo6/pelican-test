/**
 * 应用入口：装配所有组件并启动。
 */

import { GITHUB_REPO_URL } from './config.js';
import { clear, el } from './utils/dom.js';
import { icon } from './utils/icons.js';
import { localeName, localeShortLabel, nextLocale, t } from './utils/i18n.js';
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

/** 渲染顶部导航栏：品牌、语言切换与 GitHub 入口 */
function renderTopbar() {
  brandName.textContent = t('app.name');
  brandTag.textContent = t('app.tagline');
  document.title = `${t('app.name')} · ${t('app.tagline')}`;

  clear(topbarActions);

  // 语言切换：按钮展示「目标语言」，点击后切换（语言选择会持久化）
  const target = nextLocale();
  const langTitle = t('topbar.lang.switch', { name: localeName(target) });
  topbarActions.appendChild(
    el(
      'button',
      {
        class: 'icon-btn icon-btn--xl icon-btn--outline icon-btn--wide',
        type: 'button',
        title: langTitle,
        attrs: { 'aria-label': langTitle },
        onClick: () => store.setLocale(target),
      },
      [
        el('span', { class: 'icon-btn__glyph', html: icon('globe', { size: 18 }) }),
        el('span', { class: 'icon-btn__text', text: localeShortLabel(target) }),
      ],
    ),
  );

  const repoUrl = String(GITHUB_REPO_URL || '').trim();

  if (repoUrl) {
    topbarActions.appendChild(
      el('a', {
        class: 'icon-btn icon-btn--xl icon-btn--outline',
        href: repoUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: t('topbar.github.openTitle', { url: repoUrl }),
        attrs: { 'aria-label': t('topbar.github.openAria') },
        html: icon('github', { size: 24 }),
      }),
    );
    return;
  }

  // 未配置仓库地址时保持禁用状态，不跳转到任何猜测出来的地址
  topbarActions.appendChild(
    el('button', {
      class: 'icon-btn icon-btn--xl icon-btn--outline',
      type: 'button',
      disabled: true,
      title: t('topbar.github.disabledTitle'),
      attrs: { 'aria-label': t('topbar.github.disabledAria') },
      html: icon('github', { size: 24 }),
    }),
  );
}

/** 语言变化时才重建顶栏，避免每次状态通知都重刷 DOM */
let renderedLocale = null;
function syncTopbar() {
  if (store.state.locale === renderedLocale) return;
  renderedLocale = store.state.locale;
  renderTopbar();
}

/** 顶部提示条：存储降级、file:// 打开等环境问题 */
function renderBanner() {
  const { storageMode, storageError } = store.state;
  clear(bannerRoot);

  const messages = [];
  if (window.location.protocol === 'file:') {
    messages.push({ tone: 'warning', text: t('banner.fileProtocol') });
  }
  if (storageMode === 'memory') {
    messages.push({
      tone: 'error',
      text: t('banner.memoryMode', {
        message: (storageError && storageError.message) || t('banner.storageUnavailable'),
      }),
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
  syncTopbar();
  store.subscribe(syncTopbar);

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
      toastError(t('app.loadFailed'), loadError.message || String(loadError));
    }
  } catch (error) {
    toastError(t('app.initFailed'), String(error && error.message ? error.message : error));
    console.error('[app] 初始化异常：', error);
  }
}

main();
