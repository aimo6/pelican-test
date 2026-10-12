/**
 * SVG 解析与安全清理工具。
 *
 * 安全模型（两层防护）：
 * 1. 白名单解析：用 DOMParser 以 image/svg+xml 解析后遍历 DOM，
 *    只保留白名单内的元素与属性，移除脚本、事件处理器、外部资源引用等。
 * 2. 渲染隔离：清理后的 SVG 通过 Blob URL 交给 <img> 渲染。
 *    在 <img> 上下文中，浏览器不会执行 SVG 内的脚本，也不会加载外部资源，
 *    即使清理逻辑有遗漏，也无法在页面上下文里执行代码。
 *
 * 注意：绝不能把模型原始输出直接 innerHTML 到页面里。
 */

import { t } from './i18n.js';

/** 允许保留的 SVG 元素白名单 */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'a',
  'view',
  'metadata',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'marker',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'filter',
  'fegaussianblur',
  'feoffset',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'femerge',
  'femergenode',
  'feflood',
  'fecomposite',
  'feturbulence',
  'fedisplacementmap',
  'femorphology',
  'fedropshadow',
  'fedistantlight',
  'fepointlight',
  'fespotlight',
  'fespecularlighting',
  'fediffuselighting',
  'animate',
  'animatetransform',
  'animatemotion',
  'mpath',
  'set',
  'image',
  'foreignobject', // 会被下面显式移除，列在此处只是为了让移除原因更清晰
]);

/** 明确禁止的元素（优先级高于白名单） */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'embed',
  'object',
  'link',
  'meta',
  'base',
  'handler',
  'listener',
  'audio',
  'video',
  'canvas',
]);

/** 允许的 data: 图片类型（其余 data: 一律移除，避免 data:text/html 之类被滥用） */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i;

/** 危险的 CSS / URL 片段 */
const DANGEROUS_CSS = /(expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:|-moz-binding)/i;

/**
 * 预清理原始字符串：移除 DOCTYPE 与实体声明。
 * 目的是避免 XML 实体扩展（如「十亿笑声」攻击）在解析阶段消耗内存。
 */
function preStripDangerousMarkup(text) {
  return String(text ?? '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!ENTITY[^>]*>/gi, '')
    .replace(/<!\[CDATA\[/gi, '')
    .replace(/\]\]>/gi, '');
}

/**
 * 在文本中扫描完整的 <svg>...</svg> 片段（支持嵌套，忽略 Markdown 代码围栏）。
 * @param {string} text
 * @returns {string[]}
 */
function findSvgBlocks(text) {
  const blocks = [];
  const tagRe = /<\/?svg\b[^>]*>/gi;
  let match;
  let depth = 0;
  let startIndex = -1;

  while ((match = tagRe.exec(text)) !== null) {
    const tag = match[0];
    const isClosing = /^<\//.test(tag);
    const isSelfClosing = /\/>$/.test(tag);

    if (!isClosing) {
      if (depth === 0) startIndex = match.index;
      if (isSelfClosing) {
        if (depth === 0) blocks.push(text.slice(startIndex, match.index + tag.length));
      } else {
        depth += 1;
      }
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        blocks.push(text.slice(startIndex, match.index + tag.length));
        startIndex = -1;
      }
    }
  }
  return blocks;
}

/**
 * 用 XML 解析器校验片段是否为合法 SVG。
 * @param {string} source
 * @returns {{ok: boolean, doc: Document|null, error: string|null}}
 */
function parseSvgDocument(source) {
  const cleaned = preStripDangerousMarkup(source);
  let doc;
  try {
    doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml');
  } catch (error) {
    return { ok: false, doc: null, error: t('svg.xmlException') };
  }

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    const message = (parserError.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      ok: false,
      doc: null,
      error: message ? t('svg.parseFailedWithMessage', { message: message.slice(0, 200) }) : t('svg.parseFailed'),
    };
  }

  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') {
    return { ok: false, doc: null, error: t('svg.noRoot') };
  }
  return { ok: true, doc, error: null };
}

/**
 * 从模型输出中提取 SVG。
 * 无论模型是否使用了 Markdown 代码围栏、是否夹带解释文字，都会尽力识别完整的 <svg> 片段。
 *
 * @param {string} text 模型返回的原始文本
 * @returns {{svg: string|null, strategy: string|null, error: string|null, candidateCount: number}}
 */
export function extractSvgFromText(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return { svg: null, strategy: null, error: t('svg.emptyOutput'), candidateCount: 0 };
  }

  const blocks = findSvgBlocks(raw);
  if (blocks.length === 0) {
    return {
      svg: null,
      strategy: null,
      error: t('svg.noBlock'),
      candidateCount: 0,
    };
  }

  // 优先返回第一个能通过 XML 校验的片段；多个片段时取内容最长的那个作为兜底
  let firstError = null;
  let fallback = null;
  for (const block of blocks) {
    const parsed = parseSvgDocument(block);
    if (parsed.ok) {
      return { svg: block.trim(), strategy: 'xml-parse', error: null, candidateCount: blocks.length };
    }
    if (!firstError) firstError = parsed.error;
    if (!fallback || block.length > fallback.length) fallback = block;
  }

  return {
    svg: fallback ? fallback.trim() : null,
    strategy: 'unparsed',
    error: firstError || t('svg.invalidFragment'),
    candidateCount: blocks.length,
  };
}

/**
 * 清理属性值中的危险内容。
 * @returns {{value: string, removed: boolean}}
 */
function sanitizeAttributeValue(name, value) {
  const text = String(value ?? '');

  if (/^on/i.test(name)) return { value: '', removed: true };

  if (name === 'href' || name === 'xlink:href' || name === 'src') {
    const trimmed = text.trim();
    if (trimmed.startsWith('#')) return { value: trimmed, removed: false };
    if (SAFE_DATA_IMAGE.test(trimmed)) return { value: trimmed, removed: false };
    // 外部资源引用（http、//、相对路径、其他 data: 类型）一律移除
    return { value: '', removed: true };
  }

  if (DANGEROUS_CSS.test(text)) return { value: '', removed: true };

  // style 属性中的 url(...) 只允许指向本文档内部锚点
  if (name === 'style' && /url\s*\(/i.test(text)) {
    const sanitized = text.replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, target) =>
      String(target).trim().startsWith('#') ? match : 'none',
    );
    return { value: sanitized, removed: sanitized !== text };
  }

  return { value: text, removed: false };
}

/** 清理 <style> 元素内的 CSS 文本 */
function sanitizeCssText(css) {
  return String(css ?? '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (match, quote, target) =>
      String(target).trim().startsWith('#') ? match : 'none',
    )
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '');
}

/**
 * 安全清理 SVG 字符串。
 * @param {string} source
 * @returns {{svg: string|null, removed: string[], error: string|null}}
 */
export function sanitizeSvg(source) {
  const parsed = parseSvgDocument(source);
  if (!parsed.ok || !parsed.doc) {
    return { svg: null, removed: [], error: parsed.error || t('svg.parseError') };
  }

  const doc = parsed.doc;
  const removed = new Set();

  const walk = (node) => {
    // 自底向上遍历，便于整棵子树被移除
    const children = Array.from(node.childNodes || []);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
        const tag = child.nodeName.toLowerCase();
        if (FORBIDDEN_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
          removed.add(tag);
          child.remove();
          continue;
        }
        if (tag === 'style') {
          child.textContent = sanitizeCssText(child.textContent);
        }
        sanitizeElementAttributes(child, removed);
      } else if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
        // 例如 <?xml-stylesheet ...?>，一并移除
        removed.add('processing-instruction');
        child.remove();
      }
    }
  };

  sanitizeElementAttributes(doc.documentElement, removed);
  walk(doc.documentElement);

  // 确保根元素带上必要的命名空间
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  let serialized;
  try {
    serialized = new XMLSerializer().serializeToString(doc.documentElement);
    // 使用了 xlink: 前缀但没有声明命名空间时补上，避免 <img> 渲染失败
    if (
      serialized.includes('xlink:') &&
      !doc.documentElement.getAttribute('xmlns:xlink') &&
      !serialized.includes('xmlns:xlink')
    ) {
      doc.documentElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      serialized = new XMLSerializer().serializeToString(doc.documentElement);
    }
  } catch (error) {
    return { svg: null, removed: [...removed], error: t('svg.serializeFailed') };
  }

  return { svg: serialized, removed: [...removed], error: null };
}

/** 清理单个元素的属性 */
function sanitizeElementAttributes(element, removed) {
  const tag = element.nodeName.toLowerCase();
  const attributes = Array.from(element.attributes || []);
  for (const attr of attributes) {
    const name = attr.name;
    const lower = name.toLowerCase();

    // 事件处理器
    if (lower.startsWith('on')) {
      element.removeAttribute(name);
      removed.add(`${tag}[${lower}]`);
      continue;
    }

    // <a> 标签去掉跳转能力，只保留内容
    if (tag === 'a' && (lower === 'href' || lower === 'xlink:href')) {
      element.removeAttribute(name);
      removed.add('a[href]');
      continue;
    }

    // <image> 只允许内嵌 data: 图片
    const { value, removed: wasRemoved } = sanitizeAttributeValue(lower, attr.value);
    if (wasRemoved) {
      element.removeAttribute(name);
      removed.add(`${tag}[${lower}]`);
    } else if (value !== attr.value) {
      element.setAttribute(name, value);
      removed.add(`${tag}[${lower}]`);
    }
  }
}

/**
 * 确保 SVG 具备可用于缩放计算的尺寸信息。
 * - 有 viewBox：直接读取
 * - 只有 width/height：补一个等价的 viewBox
 * - 都没有：返回兜底尺寸并标记
 *
 * @param {string} source 已清理的 SVG
 * @returns {{svg: string, width: number, height: number, hasViewBox: boolean, fallback: boolean}}
 */
export function ensureSvgSize(source) {
  const FALLBACK = { width: 800, height: 600 };
  const parsed = parseSvgDocument(source);
  if (!parsed.ok || !parsed.doc) {
    return { svg: source, ...FALLBACK, hasViewBox: false, fallback: true };
  }

  const root = parsed.doc.documentElement;
  const viewBox = (root.getAttribute('viewBox') || '').trim();
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { svg: source, width: parts[2], height: parts[3], hasViewBox: true, fallback: false };
    }
  }

  const parseLength = (value) => {
    const match = String(value ?? '').trim().match(/^([\d.]+)/);
    const num = match ? Number(match[1]) : NaN;
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  const width = parseLength(root.getAttribute('width'));
  const height = parseLength(root.getAttribute('height'));

  if (width && height) {
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return {
      svg: new XMLSerializer().serializeToString(root),
      width,
      height,
      hasViewBox: false,
      fallback: false,
    };
  }

  // 缺少尺寸信息：补一个 viewBox，让 <img> 渲染时有稳定的宽高比
  root.setAttribute('viewBox', `0 0 ${FALLBACK.width} ${FALLBACK.height}`);
  return {
    svg: new XMLSerializer().serializeToString(root),
    ...FALLBACK,
    hasViewBox: false,
    fallback: true,
  };
}

/**
 * 把 SVG 字符串转成 Blob URL，用于 <img> 隔离渲染。
 * 调用方负责在替换时 revoke 旧 URL。
 * @param {string} svg
 * @returns {string}
 */
export function createSvgBlobUrl(svg) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * 生成下载文件名
 * @param {string} prefix
 */
export function svgFileName(prefix = 'pelican-svg') {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}.svg`;
}
