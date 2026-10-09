/**
 * SVG 结果预览组件。
 *
 * 安全说明：模型输出经过 utils/svg.js 白名单清理后，通过 Blob URL 交给 <img> 渲染。
 * 在 <img> 上下文中浏览器不会执行 SVG 内的脚本，也不会加载外部资源，
 * 因此不会把未经处理的模型输出当作可信 HTML 插入页面。
 */

import { getProtocol } from '../config.js';
import { clear, copyText, downloadFile, el, formatDuration, formatFullTime, formatTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { createSvgBlobUrl, ensureSvgSize, svgFileName } from '../utils/svg.js';
import { toastError, toastSuccess } from './toast.js';

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @param {import('../store/state.js').store} store
 */
export function createSvgViewer(store) {
  /* ------------------------------ 内部状态 ------------------------------ */
  let renderedSvg = null; // 当前渲染用的（已清理）SVG
  let objectUrl = null;
  let naturalSize = { width: 800, height: 600 };
  const view = { scale: 1, x: 0, y: 0, mode: /** @type {'fit'|'free'} */ ('fit') };
  let sideOpen = false;
  let activeTab = 'svg';
  let dragging = null;
  let renderedResultRef = null;

  /* ------------------------------ DOM 结构 ------------------------------ */
  const img = el('img', { class: 'viewer__img', alt: 'SVG 生成结果预览' });
  const stage = el('div', { class: 'viewer__stage' }, img);
  const overlay = el('div', { class: 'viewer__overlay' });
  const canvas = el(
    'div',
    {
      class: 'viewer__canvas',
      title: '拖拽平移 · Ctrl / ⌘ + 滚轮缩放 · 双击复位',
    },
    [stage, overlay],
  );

  const statusBadge = el('span', { class: 'badge badge--muted', text: '等待测试' });
  const metaText = el('span', { class: 'viewer__meta' });

  const sourceBtn = el('button', { class: 'btn btn--sm', type: 'button' });
  sourceBtn.innerHTML = `${icon('code', { size: 14 })}<span>查看源码</span>`;
  const rawBtn = el('button', { class: 'btn btn--sm', type: 'button' });
  rawBtn.innerHTML = `${icon('fileText', { size: 14 })}<span>原始响应</span>`;
  const copyBtn = el('button', { class: 'btn btn--sm', type: 'button' });
  copyBtn.innerHTML = `${icon('copy', { size: 14 })}<span>复制</span>`;
  const downloadBtn = el('button', { class: 'btn btn--sm', type: 'button' });
  downloadBtn.innerHTML = `${icon('download', { size: 14 })}<span>下载</span>`;
  const fullscreenBtn = el('button', { class: 'icon-btn', type: 'button', title: '全屏预览', html: icon('expand', { size: 16 }) });

  const codeBlock = el('pre', { class: 'viewer__code' });
  const rawBlock = el('pre', { class: 'viewer__code' });
  const sideNote = el('div', { class: 'viewer__side-note' });

  const tabSvg = el('button', { class: 'tab is-active', type: 'button', text: 'SVG 源码' });
  const tabRaw = el('button', { class: 'tab', type: 'button', text: '原始响应' });
  const sideCloseBtn = el('button', { class: 'icon-btn icon-btn--sm', type: 'button', title: '收起', html: icon('x', { size: 14 }) });
  const sidePanelSvg = el('div', { class: 'viewer__side-panel' }, codeBlock);
  const sidePanelRaw = el('div', { class: 'viewer__side-panel', hidden: true }, rawBlock);

  const side = el('aside', { class: 'viewer__side', hidden: true }, [
    el('div', { class: 'viewer__side-head' }, [
      el('div', { class: 'tabs' }, [tabSvg, tabRaw]),
      sideCloseBtn,
    ]),
    sidePanelSvg,
    sidePanelRaw,
    sideNote,
  ]);

  const root = el('section', { class: 'panel viewer' }, [
    el('div', { class: 'viewer__head' }, [
      el('div', { class: 'viewer__head-info' }, [statusBadge, metaText]),
      el('div', { class: 'viewer__head-actions' }, [
        sourceBtn,
        rawBtn,
        copyBtn,
        downloadBtn,
        fullscreenBtn,
      ]),
    ]),
    el('div', { class: 'viewer__body' }, [canvas, side]),
  ]);

  /* ------------------------------ 交互 ------------------------------ */

  function applyTransform() {
    if (!renderedSvg) return;
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  function computeFitScale() {
    const rect = canvas.getBoundingClientRect();
    const padding = 40;
    const availableWidth = Math.max(40, rect.width - padding);
    const availableHeight = Math.max(40, rect.height - padding);
    return clamp(
      Math.min(availableWidth / naturalSize.width, availableHeight / naturalSize.height),
      MIN_SCALE,
      8,
    );
  }

  function fit() {
    view.scale = computeFitScale();
    view.x = 0;
    view.y = 0;
    view.mode = 'fit';
    applyTransform();
  }

  function setScale(scale) {
    view.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    view.mode = 'free';
    applyTransform();
  }

  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === root) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch (error) {
      toastError('无法进入全屏', '当前浏览器或环境拒绝了全屏请求。');
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = document.fullscreenElement === root;
    fullscreenBtn.innerHTML = icon(isFullscreen ? 'shrink' : 'expand', { size: 16 });
    fullscreenBtn.title = isFullscreen ? '退出全屏' : '全屏预览';
    if (view.mode === 'fit') requestAnimationFrame(fit);
  });

  async function handleCopy() {
    const svg = store.state.result?.svgSanitized;
    if (!svg) {
      toastError('暂无可复制的 SVG 源码');
      return;
    }
    const ok = await copyText(svg);
    if (ok) toastSuccess('已复制 SVG 源码');
    else toastError('复制失败', '浏览器拒绝了剪贴板访问，请手动选中源码复制。');
  }

  function handleDownload() {
    const svg = store.state.result?.svgSanitized;
    if (!svg) {
      toastError('暂无可下载的 SVG');
      return;
    }
    downloadFile(svgFileName(), svg, 'image/svg+xml;charset=utf-8');
    toastSuccess('已开始下载 SVG 文件');
  }

  copyBtn.addEventListener('click', handleCopy);
  downloadBtn.addEventListener('click', handleDownload);

  function setSide(open, tab) {
    sideOpen = open;
    if (tab) activeTab = tab;
    side.hidden = !open;
    sourceBtn.classList.toggle('is-active', open && activeTab === 'svg');
    rawBtn.classList.toggle('is-active', open && activeTab === 'raw');
    tabSvg.classList.toggle('is-active', activeTab === 'svg');
    tabRaw.classList.toggle('is-active', activeTab === 'raw');
    sidePanelSvg.hidden = activeTab !== 'svg';
    sidePanelRaw.hidden = activeTab !== 'raw';
    if (open && view.mode === 'fit') requestAnimationFrame(fit);
  }

  sourceBtn.addEventListener('click', () => setSide(!(sideOpen && activeTab === 'svg'), 'svg'));
  rawBtn.addEventListener('click', () => setSide(!(sideOpen && activeTab === 'raw'), 'raw'));
  tabSvg.addEventListener('click', () => setSide(true, 'svg'));
  tabRaw.addEventListener('click', () => setSide(true, 'raw'));
  sideCloseBtn.addEventListener('click', () => setSide(false));

  /* 拖拽平移 */
  canvas.addEventListener('pointerdown', (event) => {
    if (!renderedSvg || event.button !== 0) return;
    dragging = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    view.x = dragging.originX + (event.clientX - dragging.startX);
    view.y = dragging.originY + (event.clientY - dragging.startY);
    view.mode = 'free';
    applyTransform();
  });

  const endDrag = (event) => {
    if (!dragging) return;
    if (canvas.hasPointerCapture(dragging.pointerId)) canvas.releasePointerCapture(dragging.pointerId);
    dragging = null;
    canvas.classList.remove('is-dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* Ctrl / ⌘ + 滚轮缩放 */
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!renderedSvg) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      setScale(view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    },
    { passive: false },
  );

  /* 双击复位到「适应画布」 */
  canvas.addEventListener('dblclick', () => {
    if (!renderedSvg) return;
    fit();
  });

  /* 画布尺寸变化时，若处于「适应」状态则重新计算 */
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (view.mode === 'fit' && renderedSvg) fit();
    });
    observer.observe(canvas);
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function releaseObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function setSvg(svg) {
    releaseObjectUrl();
    renderedSvg = svg || null;

    if (!renderedSvg) {
      img.removeAttribute('src');
      img.style.width = '0px';
      img.style.height = '0px';
      canvas.classList.remove('has-image');
      return;
    }

    const sized = ensureSvgSize(renderedSvg);
    naturalSize = { width: sized.width, height: sized.height };
    img.style.width = `${sized.width}px`;
    img.style.height = `${sized.height}px`;
    objectUrl = createSvgBlobUrl(sized.svg);
    img.src = objectUrl;
    canvas.classList.add('has-image');
    view.mode = 'fit';
    view.x = 0;
    view.y = 0;
    requestAnimationFrame(() => fit());
  }

  function renderOverlay(result, runStatus) {
    clear(overlay);

    if (runStatus === 'running') {
      canvas.classList.add('is-loading');
      overlay.appendChild(
        el('div', { class: 'viewer__state' }, [
          el('span', { class: 'viewer__state-icon', html: icon('loader', { size: 22, className: 'spin' }) }),
          el('div', { class: 'viewer__state-title', text: '正在生成…' }),
          el('div', { class: 'viewer__state-desc', text: '模型返回后会立即解析并预览 SVG。' }),
        ]),
      );
      return;
    }

    if (!result) {
      canvas.classList.remove('is-loading');
      overlay.appendChild(
        el('div', { class: 'viewer__state' }, [
          el('span', { class: 'viewer__state-icon', html: icon('image', { size: 22 }) }),
          el('div', { class: 'viewer__state-title', text: '还没有生成结果' }),
          el('div', {
            class: 'viewer__state-desc',
            text: '在上方填写提示词并点击「开始测试」，或从左侧历史记录中恢复一次旧结果。',
          }),
        ]),
      );
      return;
    }

    const hasSvg = Boolean(result.svgSanitized);
    if (hasSvg) {
      canvas.classList.remove('is-loading');
      return;
    }

    canvas.classList.remove('is-loading');
    const isError = result.status === 'error';
    const parseError = result.parse?.error;
    overlay.appendChild(
      el('div', { class: `viewer__state ${isError ? 'is-error' : 'is-warning'}` }, [
        el('span', { class: 'viewer__state-icon', html: icon(isError ? 'alert' : 'wand', { size: 22 }) }),
        el('div', {
          class: 'viewer__state-title',
          text: isError ? '本次测试失败' : '没有解析出可预览的 SVG',
        }),
        el('div', { class: 'viewer__state-desc', text: result.error || parseError || '模型输出中不包含 <svg> 片段。' }),
        el('div', {
          class: 'viewer__state-desc',
          text: '原始输出已完整保留，可点击右上角「原始响应」查看模型的实际返回内容。',
        }),
      ]),
    );
  }

  function renderMeta(result, runStatus) {
    clear(metaText);
    if (!result) {
      statusBadge.className = 'badge badge--muted';
      statusBadge.textContent = runStatus === 'running' ? '请求中' : '等待测试';
      return;
    }

    const ok = result.status === 'success';
    statusBadge.className = `badge badge--${ok ? 'ok' : 'error'}`;
    statusBadge.textContent = ok ? '测试成功' : '测试失败';

    const parts = [
      result.supplierName || '未记录',
      result.model || '未记录',
      result.protocol ? `协议：${getProtocol(result.protocol).short}` : '',
      result.durationMs ? `耗时 ${formatDuration(result.durationMs)}` : '',
      formatTime(result.createdAt),
    ].filter(Boolean);

    metaText.textContent = parts.join(' · ');
    metaText.title = formatFullTime(result.createdAt);
  }

  function renderSide(result) {
    const svg = result?.svgSanitized || '';
    codeBlock.textContent = svg || '（本次没有解析出 SVG 源码）';
    rawBlock.textContent = result?.rawResponse || '（暂无原始响应）';

    const removed = result?.parse?.removed || [];
    const notes = ['为安全起见，预览与源码均已移除脚本、事件处理器与外部资源引用。'];
    if (removed.length) notes.push(`已清理：${[...new Set(removed)].join('、')}`);
    if (result?.parse?.strategy === 'unparsed') notes.push('提示：该片段未通过 XML 校验，预览可能不完整。');
    if (result?.finishReason === 'length') notes.push('提示：模型输出因长度限制被截断。');
    sideNote.textContent = notes.join(' ');

    const hasContent = Boolean(svg || result?.rawResponse);
    copyBtn.disabled = !svg;
    downloadBtn.disabled = !svg;
    sourceBtn.disabled = !svg;
    rawBtn.disabled = !result?.rawResponse;
    if (!hasContent && sideOpen) setSide(false);
  }

  function render() {
    const { result, run } = store.state;
    const resultChanged = result !== renderedResultRef;
    renderedResultRef = result;

    renderMeta(result, run.status);
    renderOverlay(result, run.status);

    if (resultChanged || result?.svgSanitized !== renderedSvg) {
      setSvg(result?.svgSanitized || null);
    }

    renderSide(result);
  }

  store.subscribe(render);

  return { root, render, fit };
}
