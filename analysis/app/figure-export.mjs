const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 20000000;
const MAX_SVG_BYTES = 12000000;
const FONT_STACK = 'Arial, sans-serif';

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]);
}

function readAttribute(attributes, name) {
  const doubleQuoted = attributes.match(new RegExp("\\s+" + name + "\\s*=\\s*\"([^\"]*)\"", "i"));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = attributes.match(new RegExp("\\s+" + name + "\\s*=\\s*'([^']*)'", "i"));
  return singleQuoted ? singleQuoted[1] : null;
}

function setAttribute(attributes, name, value) {
  const pattern = new RegExp("\\s+" + name + "\\s*=\\s*(?:\"[^\"]*\"|'[^']*')", "i");
  const encoded = ' ' + name + '="' + xmlEscape(value) + '"';
  return pattern.test(attributes) ? attributes.replace(pattern, encoded) : attributes + encoded;
}

function removeAttribute(attributes, name) {
  return attributes.replace(new RegExp("\\s+" + name + "\\s*=\\s*(?:\"[^\"]*\"|'[^']*')", "i"), '');
}

function positiveLimit(value, fallback, hardLimit, label) {
  if (value == null) return fallback;
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) throw new RangeError(label + ' 必须是正有限数。');
  return Math.min(Math.floor(limit), hardLimit);
}

function numericLength(value) {
  const match = String(value ?? '').trim().match(/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i);
  return match ? Number(match[1]) : null;
}

function parseViewBox(attributes) {
  const raw = readAttribute(attributes, 'viewBox');
  if (raw) {
    const values = raw.trim().split(/[\s,]+/).map(Number);
    if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
      return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
    throw new TypeError('SVG viewBox 尺寸无效。');
  }
  const width = numericLength(readAttribute(attributes, 'width'));
  const height = numericLength(readAttribute(attributes, 'height'));
  if (!(width > 0) || !(height > 0)) throw new TypeError('SVG 必须提供有效的 viewBox 或 px 宽高。');
  return { x: 0, y: 0, width, height };
}

function sourceMarkup(svg) {
  if (typeof svg === 'string') return svg;
  if (!svg || typeof svg !== 'object') throw new TypeError('请提供 SVG 元素或 SVG 字符串。');
  if (typeof globalThis.XMLSerializer === 'function') {
    return new globalThis.XMLSerializer().serializeToString(svg);
  }
  if (typeof svg.outerHTML === 'string') return svg.outerHTML;
  throw new TypeError('当前环境不支持序列化 SVG 元素。');
}

function assertSelfContained(markup) {
  if (/<!\s*(?:doctype|entity)|<\?xml-stylesheet/i.test(markup)) {
    throw new TypeError('SVG 不允许包含外部 DTD 或样式表。');
  }
  if (/<\s*(?:script|foreignObject|iframe|object|embed|image|audio|video|animate|set)\b/i.test(markup)) {
    throw new TypeError('SVG 含有可能引用外部资源或执行脚本的元素。');
  }
  if (/<[a-z][^>]*\s+on[a-z0-9_-]+\s*=/i.test(markup)) {
    throw new TypeError('SVG 不允许含有事件处理属性。');
  }
  for (const tag of markup.matchAll(/<[^!?][^>]*>/g)) {
    for (const match of tag[0].matchAll(/\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const target = match[1] ?? match[2] ?? match[3] ?? '';
      if (!target.startsWith('#')) throw new TypeError('SVG 不允许引用外部资源。');
    }
  }
  for (const match of markup.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const target = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!target.startsWith('#')) throw new TypeError('SVG 不允许引用外部资源。');
  }
}

function addTextFontIsolation(markup) {
  return markup.replace(/<text\b([^>]*)>/gi, (_whole, attributes) => {
    const size = readAttribute(attributes, 'font-size') || '12';
    const weight = readAttribute(attributes, 'font-weight') || '400';
    const cssSize = /^\d+(?:\.\d+)?$/.test(size) ? size + 'px' : size;
    const style = 'font-family:Arial,sans-serif !important;font-size:' + cssSize + ' !important;font-weight:' + weight + ' !important;';
    let updated = setAttribute(attributes, 'font-family', FONT_STACK);
    updated = setAttribute(updated, 'style', style);
    return '<text' + updated + '>';
  });
}

function wrapTitle(title, viewBoxWidth, fontSize) {
  const raw = Array.from(String(title).trim());
  const truncated = raw.length > 90;
  const chars = raw.slice(0, 90);
  if (truncated) chars[chars.length - 1] = '…';
  const maxWidth = Math.max(fontSize * 8, viewBoxWidth - 20);
  const lines = [];
  let line = '';
  let lineWidth = 0;
  for (const char of chars) {
    const charWidth = char.codePointAt(0) > 255 ? fontSize : fontSize * .58;
    if (line && lineWidth + charWidth > maxWidth) {
      lines.push(line);
      line = '';
      lineWidth = 0;
    }
    line += char;
    lineWidth += charWidth;
  }
  if (line) lines.push(line);
  return lines;
}

function visibleTitle(lines, x, baseline, fontSize) {
  if (!lines.length) return '';
  const weight = '650';
  const style = 'font-family:Arial,sans-serif !important;font-size:' + fontSize + 'px !important;font-weight:' + weight + ' !important;fill:#173c3c !important;';
  const spans = lines.map((line, index) => '<tspan x="' + x + '" dy="' + (index ? 22 : 0) + '">' + xmlEscape(line) + '</tspan>').join('');
  return '<text x="' + x + '" y="' + baseline + '" font-family="' + FONT_STACK + '" font-size="' + fontSize + '" font-weight="' + weight + '" fill="#173c3c" style="' + style + '">' + spans + '</text>';
}

export function serializeFigure(svg, options = {}) {
  const maxDimension = positiveLimit(options.maxDimension, MAX_DIMENSION, MAX_DIMENSION, '最大尺寸');
  const maxBytes = positiveLimit(options.maxBytes, MAX_SVG_BYTES, MAX_SVG_BYTES, 'SVG 字节上限');
  let markup = sourceMarkup(svg).trim().replace(/^<\?xml[^>]*>\s*/i, '');
  assertSelfContained(markup);
  const rootMatch = markup.match(/<svg\b([^>]*)>/i);
  if (!rootMatch || rootMatch[0].endsWith('/>')) throw new TypeError('输入内容不是有效的 SVG 根元素。');
  let attributes = rootMatch[1];
  const originalViewBox = parseViewBox(attributes);
  const requestedWidth = options.width ?? options.widthPx;
  const sourceWidth = numericLength(readAttribute(attributes, 'width')) || originalViewBox.width;
  const width = Math.round(requestedWidth == null ? sourceWidth : Number(requestedWidth));
  if (!Number.isFinite(width) || width < 1 || width > maxDimension) {
    throw new RangeError('SVG 导出宽度必须为 1 至 ' + maxDimension + ' px。');
  }
  const titleText = options.title == null ? '' : String(options.title).trim();
  const fontSize = originalViewBox.width < 420 ? 15 : 18;
  const lines = titleText ? wrapTitle(titleText, originalViewBox.width, fontSize) : [];
  const titlePadding = lines.length ? 42 + (lines.length - 1) * 22 : 0;
  const viewBoxY = originalViewBox.y - titlePadding;
  const viewBoxHeight = originalViewBox.height + titlePadding;
  const height = Math.round(width * viewBoxHeight / originalViewBox.width);
  if (!Number.isFinite(height) || height < 1 || height > maxDimension) {
    throw new RangeError('SVG 导出高度超出尺寸上限。');
  }
  const background = options.background ?? 'white';
  if (!['white', 'transparent'].includes(background)) throw new TypeError('背景只支持 white 或 transparent。');
  attributes = setAttribute(attributes, 'xmlns', SVG_NS);
  attributes = setAttribute(attributes, 'viewBox', originalViewBox.x + ' ' + viewBoxY + ' ' + originalViewBox.width + ' ' + viewBoxHeight);
  attributes = setAttribute(attributes, 'width', width + 'px');
  attributes = setAttribute(attributes, 'height', height + 'px');
  attributes = setAttribute(attributes, 'font-family', FONT_STACK);
  if (titleText) {
    attributes = setAttribute(attributes, 'role', 'img');
    attributes = setAttribute(attributes, 'aria-label', titleText);
  }
  if (background === 'transparent') {
    const rootStyle = readAttribute(attributes, 'style');
    if (rootStyle) {
      const cleaned = rootStyle.split(';').filter((decl) => !/^\s*background\s*:/i.test(decl)).join(';');
      attributes = cleaned.trim() ? setAttribute(attributes, 'style', cleaned) : removeAttribute(attributes, 'style');
    }
  }
  const metadataTitle = titleText ? '<title>' + xmlEscape(titleText) + '</title>' : '';
  const backgroundRect = background === 'white'
    ? '<rect x="' + originalViewBox.x + '" y="' + viewBoxY + '" width="' + originalViewBox.width + '" height="' + viewBoxHeight + '" fill="#ffffff"/>'
    : '';
  const titleMarkup = lines.length
    ? visibleTitle(lines, originalViewBox.x + 8, viewBoxY + 26, fontSize)
    : '';
  const openLength = rootMatch[0].length;
  const closeIndex = markup.toLowerCase().lastIndexOf('</svg>');
  if (closeIndex < openLength) throw new TypeError('SVG 缺少闭合标签。');
  markup = '<svg' + attributes + '>' + metadataTitle + backgroundRect + titleMarkup +
    markup.slice(openLength, closeIndex) + '</svg>';
  markup = addTextFontIsolation(markup);
  const bytes = new TextEncoder().encode(markup).byteLength;
  if (bytes > maxBytes) throw new RangeError('SVG 内容超过导出字节上限。');
  return markup;
}

export async function exportFigurePng(svg, options = {}) {
  const maxDimension = positiveLimit(options.maxDimension, MAX_DIMENSION, MAX_DIMENSION, '最大尺寸');
  const maxPixels = positiveLimit(options.maxPixels, MAX_PIXELS, MAX_PIXELS, '最大像素数');
  const markup = serializeFigure(svg, { ...options, maxDimension });
  const root = markup.match(/<svg\b([^>]*)>/i);
  const width = numericLength(readAttribute(root[1], 'width'));
  const height = numericLength(readAttribute(root[1], 'height'));
  if (width * height > maxPixels) throw new RangeError('PNG 像素总量超过安全上限。');
  if (typeof globalThis.document === 'undefined' || typeof globalThis.Image !== 'function' ||
      typeof globalThis.URL?.createObjectURL !== 'function') {
    throw new Error('PNG 导出需要浏览器的 SVG、Canvas 和 Blob URL 支持。');
  }
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = globalThis.URL.createObjectURL(svgBlob);
  try {
    const image = new globalThis.Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('浏览器无法解码该 SVG。'));
      image.src = objectUrl;
    });
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: options.background === 'transparent' });
    if (!context) throw new Error('浏览器无法创建 PNG 画布。');
    if (options.background !== 'transparent') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('浏览器未能生成 PNG 文件。'));
      }, 'image/png');
    });
  } finally {
    globalThis.URL.revokeObjectURL(objectUrl);
  }
}