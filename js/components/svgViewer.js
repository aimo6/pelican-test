/**
 * SVG 结果预览组件。
 *
 * 安全说明：模型输出经过 utils/svg.js 白名单清理后，通过 Blob URL 交给 <img> 渲染。
 * 在 <img> 上下文中浏览器不会执行 SVG 内的脚本，也不会加载外部资源，
 * 因此不会把未经处理的模型输出当作可信 HTML 插入页面。
 */

import { getProtocol } from '../config.js';
import { clear, el, formatDuration, formatFullTime, formatTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import { createSvgBlobUrl, ensureSvgSize } from '../utils/svg.js';

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
  let dragging = null;
  let renderedResultRef = null;

  /* ------------------------------ DOM 结构 ------------------------------ */
  const img = el('img', { class: 'viewer__img', alt: t('viewer.alt') });
  const stage = el('div', { class: 'viewer__stage' }, img);
  const overlay = el('div', { class: 'viewer__overlay' });
  const canvas = el(
    'div',
    {
      class: 'viewer__canvas',
      title: t('viewer.canvasTitle'),
    },
    [stage, overlay],
  );

  const statusBadge = el('span', { class: 'badge badge--muted', text: t('viewer.badgeWaiting') });
  const metaText = el('span', { class: 'viewer__meta' });

  const root = el('section', { class: 'panel viewer' }, [
    el('div', { class: 'viewer__head' }, [el('div', { class: 'viewer__head-info' }, [statusBadge, metaText])]),
    el('div', { class: 'viewer__body' }, [canvas]),
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
          el('div', { class: 'viewer__state-title', text: t('viewer.stateGenerating') }),
          el('div', { class: 'viewer__state-desc', text: t('viewer.stateGeneratingDesc') }),
        ]),
      );
      return;
    }

    if (!result) {
      canvas.classList.remove('is-loading');
      overlay.appendChild(
        el('div', { class: 'viewer__state' }, [
          el('span', { class: 'viewer__state-icon', html: icon('image', { size: 22 }) }),
          el('div', { class: 'viewer__state-title', text: t('viewer.stateEmptyTitle') }),
          el('div', { class: 'viewer__state-desc', text: t('viewer.stateEmptyDesc') }),
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
          text: isError ? t('viewer.stateErrorTitle') : t('viewer.stateNoSvgTitle'),
        }),
        el('div', { class: 'viewer__state-desc', text: result.error || parseError || t('viewer.stateNoSvgDesc') }),
      ]),
    );
  }

  function renderMeta(result, runStatus) {
    clear(metaText);
    if (!result) {
      statusBadge.className = 'badge badge--muted';
      statusBadge.textContent = runStatus === 'running' ? t('viewer.badgeRunning') : t('viewer.badgeWaiting');
      return;
    }

    const ok = result.status === 'success';
    statusBadge.className = `badge badge--${ok ? 'ok' : 'error'}`;
    statusBadge.textContent = ok ? t('viewer.badgeOk') : t('viewer.badgeError');

    const parts = [
      result.supplierName || t('common.notRecorded'),
      result.model || t('common.notRecorded'),
      result.protocol ? t('viewer.metaProtocol', { name: getProtocol(result.protocol).short }) : '',
      result.durationMs ? t('viewer.metaDuration', { d: formatDuration(result.durationMs) }) : '',
      formatTime(result.createdAt),
    ].filter(Boolean);

    metaText.textContent = parts.join(' · ');
    metaText.title = formatFullTime(result.createdAt);
  }

  /** 语言变化时更新静态文案（overlay 与状态徽章每次渲染都会重建，天然使用新语言） */
  let renderedLocale = null;
  function applyLocaleIfNeeded() {
    if (store.state.locale === renderedLocale) return;
    renderedLocale = store.state.locale;
    img.alt = t('viewer.alt');
    canvas.title = t('viewer.canvasTitle');
  }

  function render() {
    const { result, run } = store.state;
    const resultChanged = result !== renderedResultRef;
    renderedResultRef = result;

    applyLocaleIfNeeded();
    renderMeta(result, run.status);
    renderOverlay(result, run.status);

    if (resultChanged || result?.svgSanitized !== renderedSvg) {
      setSvg(result?.svgSanitized || null);
    }
  }

  store.subscribe(render);

  return { root, render, fit };
}
