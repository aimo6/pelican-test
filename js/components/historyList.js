/**
 * 左侧「测试历史」组件：最近记录以「缩略图 + 信息」的卡片平铺展示，列表独立滚动。
 *
 * 历史记录是配置与结果的快照：即使供应商后来被编辑或删除，这里展示的仍然是当时的信息。
 * 点击历史只从本地恢复数据，不会重新调用模型。
 */

import { HISTORY_LIMIT, PROTOCOLS } from '../config.js';
import { clear, el, formatDuration, formatFullTime, formatTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { t } from '../utils/i18n.js';
import { createSvgBlobUrl, ensureSvgSize } from '../utils/svg.js';
import { confirmDialog } from './confirmDialog.js';
import { toastError, toastSuccess } from './toast.js';

/**
 * @param {import('../store/state.js').store} store
 */
export function createHistoryList(store) {
  /** 缩略图 Blob URL 缓存（按记录 ID 复用，避免每次重渲染都新建对象 URL） */
  const thumbUrls = new Map();
  /** 上一次渲染的列表签名，内容没变时跳过重建，避免重复解码缩略图 */
  let renderedSignature = '';

  /** 取得（或创建）某条记录的缩略图 URL */
  function thumbUrlFor(record) {
    if (!record.svgSanitized) return null;
    const cached = thumbUrls.get(record.id);
    if (cached) return cached;
    const sized = ensureSvgSize(record.svgSanitized);
    const url = createSvgBlobUrl(sized.svg);
    thumbUrls.set(record.id, url);
    return url;
  }

  /** 回收已经不在列表中的缩略图 URL */
  function pruneThumbs(history) {
    const alive = new Set(history.map((item) => item.id));
    for (const [id, url] of [...thumbUrls]) {
      if (alive.has(id)) continue;
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
  }

  const list = el('ul', { class: 'item-list' });
  const scroll = el('div', { class: 'sidebar__scroll' }, list);
  const count = el('span', { class: 'sidebar__count' });

  const clearBtn = el('button', {
    class: 'link-btn link-btn--danger',
    type: 'button',
    text: t('history.clear'),
    onClick: async () => {
      const total = store.state.history.length;
      if (total === 0) return;
      const confirmed = await confirmDialog({
        title: t('history.confirmClearTitle'),
        message: t('history.confirmClearMessage', { n: total }),
        detail: t('history.confirmClearDetail'),
        confirmText: t('history.confirmClearConfirm'),
        danger: true,
      });
      if (!confirmed) return;
      const { error } = await store.clearHistory();
      if (error) toastError(t('history.clearFailed'), error.message);
      else toastSuccess(t('history.cleared'));
    },
  });

  const sectionTitle = el('span', { class: 'sidebar__section-title', text: t('history.section') });
  const head = el('div', { class: 'sidebar__section-head' }, [
    el('div', { class: 'sidebar__section-label' }, [sectionTitle, count]),
    clearBtn,
  ]);

  const root = el(
    'section',
    { class: 'sidebar__section sidebar__section--history', attrs: { 'aria-label': t('history.section') } },
    [head, scroll],
  );

  function buildItem(record, isActive) {
    const protocol = PROTOCOLS.find((item) => item.value === record.protocol) || null;

    const thumb = el('span', { class: 'history-card__thumb' });
    const thumbUrl = thumbUrlFor(record);
    if (thumbUrl) {
      thumb.appendChild(
        el('img', {
          class: 'history-card__thumb-img',
          src: thumbUrl,
          alt: '',
          attrs: { loading: 'lazy', draggable: 'false' },
        }),
      );
    } else {
      thumb.classList.add('is-empty');
      thumb.innerHTML = icon('image', { size: 16 });
    }

    const main = el('button', {
      class: 'history-card__main',
      type: 'button',
      title: record.prompt,
      onClick: () => {
        store.openHistory(record.id);
      },
    }, [
      thumb,
      el('span', { class: 'history-card__body' }, [
        el('span', { class: 'history-card__title', text: record.title || t('common.untitledTest') }),
        el('span', {
          class: 'history-card__meta',
          text: `${record.supplierName || t('common.notRecorded')} · ${record.model || t('common.notRecorded')}`,
        }),
        el('span', { class: 'history-card__foot' }, [
          el('span', { class: 'history-card__facts' }, [
            el('span', {
              text: formatTime(record.createdAt),
              title: formatFullTime(record.createdAt),
            }),
            record.durationMs ? el('span', { class: 'history-card__dot', text: '·' }) : null,
            record.durationMs ? el('span', { text: formatDuration(record.durationMs) }) : null,
          ]),
          protocol
            ? el('span', {
                class: 'chip',
                text: protocol.short,
                title: t('common.protocolTitle', { label: t(protocol.labelKey) }),
              })
            : null,
        ]),
      ]),
    ]);

    const deleteBtn = el('button', {
      class: 'icon-btn icon-btn--sm icon-btn--danger',
      type: 'button',
      title: t('history.deleteTitle'),
      html: icon('trash', { size: 14 }),
      onClick: async (event) => {
        event.stopPropagation();
        const { error } = await store.deleteHistory(record.id);
        if (error) toastError(t('supplier.deleteFailed'), error.message);
      },
    });

    return el(
      'li',
      {
        class: `history-card${isActive ? ' is-active' : ''}`,
        attrs: { 'aria-current': isActive ? 'true' : 'false' },
      },
      [main, el('div', { class: 'history-card__actions' }, [deleteBtn])],
    );
  }

  /** 语言变化时更新头部静态文案 */
  let renderedLocale = null;
  function applyLocaleIfNeeded() {
    if (store.state.locale === renderedLocale) return;
    renderedLocale = store.state.locale;
    sectionTitle.textContent = t('history.section');
    root.setAttribute('aria-label', t('history.section'));
    clearBtn.textContent = t('history.clear');
  }

  function render() {
    const { history, activeHistoryId, locale } = store.state;
    pruneThumbs(history);

    applyLocaleIfNeeded();

    count.textContent = history.length ? `${history.length}/${HISTORY_LIMIT}` : '';
    clearBtn.disabled = history.length === 0;

    // 列表内容没变化时跳过重建（例如输入模型名称触发的重渲染）；
    // 语言参与签名，保证切换语言后卡片文案（相对时间、协议 title 等）随之更新
    const signature = `${locale}|${activeHistoryId}|${history
      .map((item) => `${item.id}:${item.createdAt}`)
      .join(',')}`;
    if (signature === renderedSignature) return;
    renderedSignature = signature;

    clear(list);
    if (history.length === 0) {
      list.appendChild(
        el('li', { class: 'empty empty--compact' }, [
          el('div', { class: 'empty__title', text: t('history.emptyTitle') }),
          el('div', {
            class: 'empty__desc',
            text: t('history.emptyDesc', { limit: HISTORY_LIMIT }),
          }),
        ]),
      );
      return;
    }

    for (const record of history) {
      list.appendChild(buildItem(record, record.id === activeHistoryId));
    }
  }

  store.subscribe(render);

  return { root, render };
}
