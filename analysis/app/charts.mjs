const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#087e78', '#c95744', '#4579a8', '#9a6f18', '#7b5b9b', '#28806a', '#a34670', '#687b2a'];
const INK = '#173c3c';
const FONT_STACK = 'Arial, sans-serif';
const MUTED = '#607b79';
const LINE = '#9fb7b2';
const MISSING = '#d6dfdd';

const finite = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const shortLabel = (value, max = 18) => {
  const chars = Array.from(String(value ?? ''));
  return chars.length > max ? chars.slice(0, Math.max(1, max - 1)).join('') + '…' : chars.join('');
};
const estimatedTextWidth = (value, size = 11) => [...String(value ?? '')].reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? size : size * .58), 0);
const fitLabel = (value, maxWidth, size = 10) => {
  const chars = Array.from(String(value ?? ''));
  if (estimatedTextWidth(chars.join(''), size) <= maxWidth) return chars.join('');
  let visible = '';
  for (const char of chars) {
    if (estimatedTextWidth(visible + char + '…', size) > maxWidth) break;
    visible += char;
  }
  return visible + '…';
};
const formatNumber = (value) => {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1e5 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(2);
  return Number(value.toPrecision(3)).toString();
};
function linearTicks(min, max, target = 4) {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [min, max];
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = multiplier * magnitude;
  const values = [];
  for (let value = Math.ceil(min / step - 1e-10) * step; value <= max + step * 1e-9 && values.length < 8; value += step) {
    values.push(Number(value.toPrecision(12)));
  }
  return values.length >= 2 ? values : [min, (min + max) / 2, max];
};
function element(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function text(svg, value, x, y, options = {}) {
  const size = options.size || 12;
  const weight = options.weight || 450;
  const fill = options.fill || INK;
  const node = element('text', {
    x, y, fill, 'font-size': size, 'font-weight': weight, 'font-family': FONT_STACK,
    style: 'font-family:Arial,sans-serif !important;font-size:' + size + 'px !important;font-weight:' + weight + ' !important;fill:' + fill + ' !important;',
    'text-anchor': options.anchor || 'middle', transform: options.transform,
  }, svg);
  node.textContent = value == null ? '' : String(value);
  if (options.title) {
    const title = element('title', {}, node);
    title.textContent = String(options.title);
  }
  return node;
}
function makeSvg(container, width, height, label) {
  container.replaceChildren();
  const svg = element('svg', {
    xmlns: NS, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label,
    preserveAspectRatio: 'xMidYMid meet', 'font-family': FONT_STACK, 'font-size': '12',
  }, container);
  svg.style.background = '#ffffff';
  return svg;
}

function empty(container, message) {
  container.replaceChildren();
  const note = document.createElement('p');
  note.className = 'chart-empty';
  note.textContent = message;
  container.append(note);
}

function axes(svg, box, xLabel, yLabel, xTicks, yTicks, xMap, yMap, formatX = (v) => v, formatY = (v) => v) {
  const { left, top, width, height } = box;
  element('path', { d: `M${left} ${top + height}V${top} M${left} ${top + height}H${left + width}`, fill: 'none', stroke: INK, 'stroke-width': 1.25 }, svg);
  for (const value of xTicks) {
    const x = xMap(value);
    element('path', { d: `M${x} ${top + height}v5`, fill: 'none', stroke: INK, 'stroke-width': 1 }, svg);
    text(svg, formatX(value), x, top + height + 20, { fill: MUTED, size: 11 });
  }
  for (const value of yTicks) {
    const y = yMap(value);
    element('path', { d: `M${left - 5} ${y}h5`, fill: 'none', stroke: INK, 'stroke-width': 1 }, svg);
    text(svg, formatY(value), left - 9, y + 4, { fill: MUTED, size: 11, anchor: 'end' });
  }
  text(svg, xLabel, left + width / 2, top + height + 43, { size: 12, weight: 650 });
  text(svg, yLabel, 18, top + height / 2, { size: 12, weight: 650, transform: `rotate(-90 18 ${top + height / 2})` });
}

export function groupColors(design = []) {
  const groups = [...new Set(design.filter((row) => !row.exclude).map((row) => String(row.group || '').trim()).filter(Boolean))];
  return Object.fromEntries(groups.map((group, i) => [group, COLORS[i % COLORS.length]]));
}

function groupLookup(design = []) {
  const map = new Map();
  for (const row of design) {
    if (row.exclude) continue;
    const group = String(row.group || '').trim();
    for (const name of [row.run, row.sample]) if (name != null) map.set(String(name), group);
  }
  return map;
}

function getGroup(sample, lookup) {
  return lookup.get(String(sample)) || '';
}

function drawLegend(svg, entries, x, y) {
  let yy = y;
  for (const [label, color] of entries) {
    element('circle', { cx: x, cy: yy - 4, r: 4, fill: color }, svg);
    const visible = shortLabel(label || '未分组', 20);
    text(svg, visible, x + 9, yy, { anchor: 'start', size: 11, fill: MUTED, title: label || '未分组' });
    yy += 18;
  }
}

export function drawCorrelation(container, sampleIds = [], correlation = []) {
  if (!Array.isArray(correlation) || !correlation.length) return empty(container, '分析结果未提供相关矩阵。');
  const n = Math.min(correlation.length, sampleIds.length || correlation.length);
  if (!n) return empty(container, '没有可显示的样本相关性数据。');
  const cell = n > 22 ? 22 : 32;
  const left = Math.max(170, Math.min(220, n * 4 + 110));
  const top = 88;
  const width = left + n * cell + 122;
  const height = top + n * cell + 46;
  const svg = makeSvg(container, width, height, '样本相关性热图');
  const x0 = left;
  const y0 = top;
  for (let i = 0; i < n; i += 1) {
    const label = shortLabel(sampleIds[i], n > 14 ? 8 : 10);
    text(svg, label, x0 - 8, y0 + i * cell + cell * .68, { anchor: 'end', size: n > 20 ? 9 : 11, title: sampleIds[i] });
    text(svg, label, x0 + i * cell + cell * .45, y0 - 8, { anchor: 'start', size: n > 20 ? 9 : 11, transform: `rotate(-55 ${x0 + i * cell + cell * .45} ${y0 - 8})`, title: sampleIds[i] });
    for (let j = 0; j < n; j += 1) {
      const value = finite(correlation[i]?.[j]);
      const t = value == null ? 0 : clamp((value + 1) / 2, 0, 1);
      const r = Math.round(244 - 195 * t);
      const g = Math.round(249 - 99 * t);
      const b = Math.round(247 - 92 * t);
      const rect = element('rect', {
        x: x0 + j * cell, y: y0 + i * cell, width: cell, height: cell,
        fill: value == null ? MISSING : `rgb(${r},${g},${b})`, stroke: '#ffffff', 'stroke-width': 1,
      }, svg);
      const title = element('title', {}, rect);
      title.textContent = `${sampleIds[i]} × ${sampleIds[j]}: ${value == null ? '缺失' : value.toFixed(3)}`;
    }
  }
  text(svg, '相关系数', x0 + n * cell + 10, y0 + 4, { anchor: 'start', size: 11, fill: MUTED });
  const gradient = element('linearGradient', { id: `corr-gradient-${Math.random().toString(36).slice(2)}`, x1: '0%', x2: '100%', y1: '0%', y2: '0%' }, svg);
  element('stop', { offset: '0%', 'stop-color': '#f4f9f7' }, gradient);
  element('stop', { offset: '100%', 'stop-color': '#317b76' }, gradient);
  element('rect', { x: x0 + n * cell + 10, y: y0 + 13, width: 80, height: 9, fill: `url(#${gradient.id})` }, svg);
  text(svg, '-1', x0 + n * cell + 10, y0 + 36, { anchor: 'start', size: 10, fill: MUTED });
  text(svg, '1', x0 + n * cell + 90, y0 + 36, { anchor: 'end', size: 10, fill: MUTED });
}

export function drawPca(container, pca, sampleIds = [], design = []) {
  const scores = pca?.scores;
  if (!Array.isArray(scores) || !scores.length) return empty(container, '分析结果未提供 PCA 分数。');
  const points = scores.map((row, i) => {
    const x = finite(Array.isArray(row) ? row[0] : row?.PC1 ?? row?.pc1);
    const y = finite(Array.isArray(row) ? row[1] : row?.PC2 ?? row?.pc2);
    return { x, y, sample: sampleIds[i] ?? row?.sample ?? row?.sampleId ?? `样本 ${i + 1}` };
  }).filter((point) => point.x != null && point.y != null);
  if (!points.length) return empty(container, 'PCA 分数没有可显示的 PC1 / PC2 数值。');
  const box = { left: 66, top: 24, width: 470, height: 265 };
  const lookup = groupLookup(design);
  const groups = [...new Set(points.map((point) => getGroup(point.sample, lookup)).filter(Boolean))];
  const legendX = box.left + box.width + 116;
  const legendWidth = Math.max(0, ...groups.map((group) => estimatedTextWidth(shortLabel(group, 20), 11)));
  const width = Math.max(620, legendX + 9 + legendWidth + 22);
  const height = Math.max(360, groups.length ? 35 + groups.length * 18 + 20 : 360);
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const padX = (maxX - minX || 1) * .1;
  const padY = (maxY - minY || 1) * .1;
  const xMin = minX - padX;
  const xMax = maxX + padX;
  const yMin = minY - padY;
  const yMax = maxY + padY;
  const xMap = (v) => box.left + (v - xMin) / (xMax - xMin) * box.width;
  const yMap = (v) => box.top + box.height - (v - yMin) / (yMax - yMin) * box.height;
  const svg = makeSvg(container, width, height, 'PCA 样本散点图');
  const tick = (min, max) => [min, min + (max - min) / 2, max];
  const variance = Array.isArray(pca.variance) ? pca.variance : [];
  const fmtVar = (v) => Number.isFinite(Number(v)) ? `${(Number(v) <= 1 ? Number(v) * 100 : Number(v)).toFixed(1)}%` : '';
  axes(svg, box, `PC1${fmtVar(variance[0]) ? ` (${fmtVar(variance[0])})` : ''}`, `PC2${fmtVar(variance[1]) ? ` (${fmtVar(variance[1])})` : ''}`, tick(xMin, xMax), tick(yMin, yMax), xMap, yMap, (v) => v.toPrecision(2), (v) => v.toPrecision(2));
  const colors = groupColors(design);
  for (const point of points) {
    const group = getGroup(point.sample, lookup);
    const circle = element('circle', { cx: xMap(point.x), cy: yMap(point.y), r: 6, fill: colors[group] || COLORS[0], stroke: '#fff', 'stroke-width': 1.5 }, svg);
    const title = element('title', {}, circle);
    title.textContent = `${point.sample}${group ? ` · ${group}` : ''}\nPC1: ${point.x.toPrecision(4)}\nPC2: ${point.y.toPrecision(4)}`;
    text(svg, shortLabel(point.sample, 14), xMap(point.x) + 8, yMap(point.y) - 7, { anchor: 'start', size: 10, fill: MUTED, title: point.sample });
  }
  if (groups.length) drawLegend(svg, groups.map((group) => [group, colors[group] || COLORS[0]]), legendX, 35);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

export function drawDistributions(container, sampleIds = [], distributions = [], design = []) {
  if (!Array.isArray(distributions) || !distributions.length) return empty(container, '分析结果未提供样本分布数据。');
  const rows = sampleIds.map((sample, i) => {
    const raw = Array.isArray(distributions[i]) ? distributions[i] : distributions?.[sample];
    const values = Array.isArray(raw) ? raw.map(finite).filter((v) => v != null).sort((a, b) => a - b) : [];
    if (!values.length) return { sample, values, stats: null };
    return { sample, values, stats: { min: values[0], q1: quantile(values, .25), median: quantile(values, .5), q3: quantile(values, .75), max: values.at(-1) } };
  });
  const valid = rows.filter((row) => row.stats);
  if (!valid.length) return empty(container, '分布数据中没有可显示的数值。');
  const lookup = groupLookup(design);
  const groups = [...new Set(rows.map((row) => getGroup(row.sample, lookup)).filter(Boolean))];
  const colors = groupColors(design);
  const left = 62;
  const plotWidth = Math.max(470, rows.length * 72);
  const legendX = left + plotWidth + 26;
  const legendTextWidth = Math.max(0, ...groups.map((group) => estimatedTextWidth(shortLabel(group, 20), 11)));
  const width = Math.max(660, legendX + 9 + legendTextWidth + 22);
  const height = Math.max(345, 55 + groups.length * 18);
  const box = { left, top: 25, width: plotWidth, height: 232 };
  const min = Math.min(...valid.map((r) => r.stats.min));
  const max = Math.max(...valid.map((r) => r.stats.max));
  const pad = (max - min || 1) * .06;
  const yMin = min - pad;
  const yMax = max + pad;
  const yMap = (v) => box.top + box.height - (v - yMin) / (yMax - yMin) * box.height;
  const svg = makeSvg(container, width, height, '各样本数据分布箱线图');
  axes(svg, box, '样本', '矩阵值', [], [yMin, (yMin + yMax) / 2, yMax], (v) => v, yMap, (v) => v, (v) => formatNumber(v));
  const slot = box.width / Math.max(1, rows.length);
  rows.forEach((row, i) => {
    const x = box.left + slot * (i + .5);
    text(svg, fitLabel(row.sample, Math.max(12, slot - 8), 10), x, box.top + box.height + 20, { size: 10, title: row.sample });
    if (!row.stats) return;
    const { min: lo, q1, median, q3, max: hi } = row.stats;
    const color = colors[getGroup(row.sample, lookup)] || COLORS[0];
    element('path', { d: 'M' + x + ' ' + yMap(lo) + 'V' + yMap(hi) + ' M' + (x - 8) + ' ' + yMap(lo) + 'H' + (x + 8) + ' M' + (x - 8) + ' ' + yMap(hi) + 'H' + (x + 8), fill: 'none', stroke: color, 'stroke-width': 1.5 }, svg);
    element('rect', { x: x - Math.min(16, slot * .28), y: yMap(q3), width: Math.min(32, slot * .56), height: Math.max(1, yMap(q1) - yMap(q3)), fill: color + '2b', stroke: color, 'stroke-width': 1.5 }, svg);
    element('path', { d: 'M' + (x - 16) + ' ' + yMap(median) + 'H' + (x + 16), fill: 'none', stroke: INK, 'stroke-width': 2 }, svg);
    const title = element('title', {}, svg.lastChild);
    title.textContent = String(row.sample) + '\nn=' + row.values.length + '\nmedian=' + median.toPrecision(4);
  });
  if (groups.length) drawLegend(svg, groups.map((group) => [group, colors[group] || COLORS[0]]), legendX, 38);
}

function matrixPayload(input) {
  if (Array.isArray(input)) {
    return { values: input, featureIds: Array.isArray(input.featureIds) ? input.featureIds : [], imputedMask: null, mode: '', usesObserved: false };
  }
  if (!input || typeof input !== 'object') return { values: null, featureIds: [], imputedMask: null, mode: '', usesObserved: false };
  const usesObserved = Array.isArray(input.observedMatrix);
  const values = usesObserved ? input.observedMatrix : Array.isArray(input.matrix) ? input.matrix : Array.isArray(input.values) ? input.values : null;
  return {
    values,
    featureIds: Array.isArray(input.featureIds) ? input.featureIds : [],
    imputedMask: Array.isArray(input.imputedMask) ? input.imputedMask : null,
    mode: String(input.mode || ''),
    usesObserved,
  };
}

function locateFeatureRow(payload, featureId) {
  if (!Array.isArray(payload.values)) return -1;
  if (payload.featureIds.length) return payload.featureIds.findIndex((id) => String(id) === String(featureId));
  if (typeof featureId === 'number' && Number.isInteger(featureId) && featureId >= 0 && featureId < payload.values.length) return featureId;
  if (payload.values.length === 1) return 0;
  return -1;
}

function groupsForSamples(sampleIds, design) {
  const lookup = groupLookup(design);
  return sampleIds.map((sample) => getGroup(sample, lookup) || '未分组');
}

function colorsForGroups(groups, design) {
  const palette = groupColors(design);
  const result = {};
  groups.forEach((group, index) => { result[group] = palette[group] || COLORS[index % COLORS.length]; });
  return result;
}

function drawGroupLegend(svg, groups, colors, x, y, maxTextWidth, includeMean = false) {
  let yy = y;
  for (const group of groups) {
    const color = colors[group] || COLORS[0];
    element('circle', { cx: x, cy: yy - 4, r: 4, fill: color }, svg);
    text(svg, fitLabel(group, maxTextWidth, 11), x + 10, yy, { anchor: 'start', size: 11, fill: MUTED, title: group });
    yy += 18;
  }
  if (includeMean) {
    const d = 'M' + x + ' ' + (yy - 9) + 'L' + (x + 5) + ' ' + (yy - 4) + 'L' + x + ' ' + (yy + 1) + 'L' + (x - 5) + ' ' + (yy - 4) + 'Z';
    element('path', { d, fill: INK, stroke: '#ffffff', 'stroke-width': 1, 'data-point-type': 'group-mean-legend' }, svg);
    text(svg, '组均值', x + 10, yy, { anchor: 'start', size: 11, fill: MUTED });
  }
}

function abundanceAxisLabel(mode) {
  if (mode === 'counts') return 'log2 CPM（prior count = 2）';
  if (mode === 'expression') return 'log2 表达值';
  if (mode === 'proteomics') return 'log2 蛋白丰度';
  return '结果矩阵值';
}

export function drawFeatureAbundance(container, featureId, matrix, sampleIds = [], design = []) {
  const payload = matrixPayload(matrix);
  const ids = Array.isArray(sampleIds) ? sampleIds : [];
  if (!Array.isArray(payload.values) || !payload.values.length || !ids.length) {
    return empty(container, '分析结果未提供可绘制的 feature × sample 矩阵。');
  }
  const rowIndex = locateFeatureRow(payload, featureId);
  if (rowIndex < 0) return empty(container, featureId ? '当前结果中找不到此 ID，请选择完整的蛋白组或基因 ID。' : '在上方选择一个蛋白组或基因，查看各样本的观测值。');
  const raw = payload.values[rowIndex];
  if (!Array.isArray(raw)) return empty(container, '所选 feature 没有可读取的样本矩阵行。');
  const sampleGroups = groupsForSamples(ids, design);
  const points = ids.map((sample, index) => {
    const isImputed = !payload.usesObserved && Boolean(payload.imputedMask?.[rowIndex]?.[index]);
    return { sample: String(sample), group: sampleGroups[index], value: isImputed ? null : finite(raw[index]) };
  });
  const observed = points.filter((point) => point.value != null);
  if (!observed.length) return empty(container, '所选 feature 在全部样本中均无可用观测值。');
  const groups = [...new Set(observed.map((point) => point.group))];
  const colors = colorsForGroups(groups, design);
  const means = groups.map((group) => {
    const values = observed.filter((point) => point.group === group).map((point) => point.value);
    return { group, value: values.reduce((sum, value) => sum + value, 0) / values.length, n: values.length, total: points.filter((point) => point.group === group).length };
  });
  const min = Math.min(...observed.map((point) => point.value));
  const max = Math.max(...observed.map((point) => point.value));
  const pad = (max - min) * .1 || Math.max(Math.abs(min) * .06, .5);
  const yMin = min - pad;
  const yMax = max + pad;
  const yMap = (value) => 28 + 250 - (value - yMin) / (yMax - yMin) * 250;
  const longestGroup = Math.max(0, ...groups.map((group) => estimatedTextWidth(group, 10)));
  const desiredSlot = Math.min(150, Math.max(82, longestGroup + 24));
  const plotWidth = Math.min(7000, Math.max(390, groups.length * desiredSlot));
  const slot = plotWidth / groups.length;
  const box = { left: 74, top: 28, width: plotWidth, height: 250 };
  const legendX = box.left + box.width + 28;
  const legendTextWidth = Math.min(230, Math.max(100, ...groups.map((group) => estimatedTextWidth(group, 11))));
  const width = legendX + 12 + legendTextWidth + 26;
  const height = Math.max(360, box.top + box.height + 78, 42 + (groups.length + 1) * 18 + 20);
  const svg = makeSvg(container, width, height, 'Feature ' + String(featureId) + ' 各样本丰度与组均值');
  const xMap = (value) => box.left + (value + .5) * slot;
  axes(
    svg, box, '组别', abundanceAxisLabel(payload.mode),
    groups.map((_, index) => index),
    linearTicks(yMin, yMax, 4),
    xMap, yMap,
    (value) => fitLabel(groups[Math.round(value)] || '', Math.max(24, slot - 6), groups.length > 35 ? 8 : 10),
    formatNumber,
  );
  const groupIndices = new Map(groups.map((group, index) => [group, index]));
  const positions = new Map(groups.map((group) => [group, 0]));
  const totals = new Map(groups.map((group) => [group, points.filter((point) => point.group === group).length]));
  for (const point of observed) {
    const index = groupIndices.get(point.group);
    const ordinal = positions.get(point.group);
    const total = totals.get(point.group);
    positions.set(point.group, ordinal + 1);
    const spread = Math.min(42, slot * .42);
    const offset = total > 1 ? ((ordinal / (total - 1)) - .5) * spread : 0;
    const x = xMap(index) + offset;
    const circle = element('circle', {
      cx: x, cy: yMap(point.value), r: 4.4, fill: colors[point.group] || COLORS[0],
      stroke: '#ffffff', 'stroke-width': 1.2, 'data-point-type': 'sample',
      'data-sample-id': point.sample, 'data-group': point.group, 'data-value': point.value,
    }, svg);
    const title = element('title', {}, circle);
    title.textContent = point.sample + ' · ' + point.group + '\n' + abundanceAxisLabel(payload.mode) + ': ' + formatNumber(point.value);
  }
  for (const mean of means) {
    const x = xMap(groupIndices.get(mean.group));
    const y = yMap(mean.value);
    const d = 'M' + x + ' ' + (y - 6) + 'L' + (x + 6) + ' ' + y + 'L' + x + ' ' + (y + 6) + 'L' + (x - 6) + ' ' + y + 'Z';
    const marker = element('path', { d, fill: INK, stroke: '#ffffff', 'stroke-width': 1.5, 'data-point-type': 'group-mean', 'data-group': mean.group, 'data-value': mean.value }, svg);
    const title = element('title', {}, marker);
    title.textContent = mean.group + ' 组均值: ' + formatNumber(mean.value) + '\nn=' + mean.n + '/' + mean.total + ' 个可用样本';
  }
  drawGroupLegend(svg, groups, colors, legendX, 43, legendTextWidth, true);
  text(svg, '圆点为各样本观测值；菱形为组均值；缺失值未插补，不显示误差线', box.left, height - 8, { anchor: 'start', size: 10, fill: MUTED });
}

export function drawMissingness(container, sampleIds = [], matrix, design = []) {
  const payload = matrixPayload(matrix);
  const ids = Array.isArray(sampleIds) ? sampleIds : [];
  if (!Array.isArray(payload.values) || !payload.values.length || !ids.length) {
    return empty(container, '分析结果未提供可绘制的 feature × sample 矩阵。');
  }
  const denominator = payload.values.length;
  const groups = groupsForSamples(ids, design);
  const groupNames = [...new Set(groups)];
  const colors = colorsForGroups(groupNames, design);
  const rows = ids.map((sample, column) => {
    let missing = 0;
    for (let row = 0; row < denominator; row += 1) {
      const values = payload.values[row];
      const imputed = !payload.usesObserved && Boolean(payload.imputedMask?.[row]?.[column]);
      if (imputed || !Array.isArray(values) || finite(values[column]) == null) missing += 1;
    }
    return { sample: String(sample), group: groups[column], missing, denominator, proportion: missing / denominator };
  });
  const left = 72;
  const plotWidth = Math.max(470, ids.length * 64);
  const slot = plotWidth / ids.length;
  const box = { left, top: 30, width: plotWidth, height: 242 };
  const yMap = (value) => box.top + box.height - value * box.height;
  const legendX = box.left + box.width + 26;
  const legendTextWidth = Math.min(220, Math.max(100, ...groupNames.map((group) => estimatedTextWidth(group, 11))));
  const width = legendX + 12 + legendTextWidth + 24;
  const height = Math.max(390, 45 + groupNames.length * 18);
  const svg = makeSvg(container, width, height, '各样本缺失比例');
  axes(svg, box, '', '缺失比例', [], [0, .25, .5, .75, 1], (value) => value, yMap, (value) => value, (value) => Math.round(value * 100) + '%');
  rows.forEach((row, index) => {
    const x = box.left + slot * (index + .5);
    const y = yMap(row.proportion);
    const barWidth = Math.min(34, slot * .58);
    const rect = element('rect', {
      x: x - barWidth / 2, y, width: barWidth, height: Math.max(0, box.top + box.height - y),
      fill: colors[row.group] || COLORS[0], opacity: .78, 'data-sample-id': row.sample,
      'data-group': row.group, 'data-missing-numerator': row.missing,
      'data-missing-denominator': row.denominator, 'data-missing-proportion': row.proportion,
    }, svg);
    const title = element('title', {}, rect);
    title.textContent = row.sample + ' · ' + row.group + '\n缺失: ' + row.missing + '/' + row.denominator + ' (' + (row.proportion * 100).toFixed(1) + '%)';
    element('circle', { cx: x, cy: y, r: 2.8, fill: colors[row.group] || COLORS[0], 'data-point-type': 'missingness' }, svg);
    element('path', { d: 'M' + x + ' ' + (box.top + box.height) + 'v5', fill: 'none', stroke: INK, 'stroke-width': 1 }, svg);
    const labelY = box.top + box.height + 23;
    const labelSize = ids.length > 30 ? 8 : 10;
    const labelWidth = Math.max(18, Math.min(slot - 5, 66));
    const transform = ids.length > 12 ? 'rotate(-45 ' + x + ' ' + labelY + ')' : undefined;
    text(svg, fitLabel(row.sample, labelWidth, labelSize), x, labelY, {
      anchor: ids.length > 12 ? 'end' : 'middle', size: labelSize, fill: MUTED, transform, title: row.sample,
    });
  });
  drawGroupLegend(svg, groupNames, colors, legendX, 43, legendTextWidth, false);
  text(svg, '比例按全部矩阵特征计算；缺失值未插补', box.left, height - 7, { anchor: 'start', size: 10, fill: MUTED });
  text(svg, '样本', box.left + box.width / 2, height - 7, { size: 11, weight: 650 });
}

function pointValue(row, key) {
  if (key === 'logFC') return finite(row.logFC ?? row.log2FC);
  if (key === 'PValue') return finite(row.PValue ?? row.pValue ?? row.pvalue);
  return finite(row.FDR ?? row.fdr ?? row.adjPValue);
}

function activeThreshold(row, metric, threshold, lfcThreshold) {
  const value = pointValue(row, metric);
  const lfc = pointValue(row, 'logFC');
  return value != null && value <= threshold && lfc != null && Math.abs(lfc) >= lfcThreshold;
}

export function drawVolcano(container, differential = [], options = {}) {
  const rows = Array.isArray(differential) ? differential : [];
  const metric = options.metric === 'PValue' ? 'PValue' : 'FDR';
  const valid = rows.map((row) => ({ row, x: pointValue(row, 'logFC'), p: pointValue(row, 'PValue'), fdr: pointValue(row, 'FDR') })).filter((p) => p.x != null && p[metric === 'PValue' ? 'p' : 'fdr'] != null);
  if (!valid.length) return empty(container, '没有可显示的 log2FC 与显著性数值。');
  const threshold = Math.max(1e-300, Number(options.threshold) || .05);
  const lfcThreshold = Math.max(0, Number(options.lfcThreshold) || 0);
  const minX = Math.min(...valid.map((p) => p.x));
  const maxX = Math.max(...valid.map((p) => p.x));
  const abs = Math.max(Math.abs(minX), Math.abs(maxX), 1);
  const xMax = abs * 1.06;
  const maxNegLog = Math.max(2, ...valid.map((p) => -Math.log10(Math.max(Number(p[metric === 'PValue' ? 'p' : 'fdr']) || 0, 1e-300))));
  const yMax = Math.min(300, maxNegLog * 1.05);
  const width = 800;
  const height = 390;
  const box = { left: 72, top: 24, width: 590, height: 292 };
  const xMap = (v) => box.left + (v + xMax) / (2 * xMax) * box.width;
  const yMap = (v) => box.top + box.height - v / yMax * box.height;
  const svg = makeSvg(container, width, height, '差异分析火山图');
  axes(svg, box, 'log2FC', `−log10(${metric === 'PValue' ? 'P value' : 'FDR'})`, [-xMax, 0, xMax], [0, yMax / 2, yMax], xMap, yMap, (v) => v.toPrecision(2), (v) => v.toFixed(1));
  const thresholdY = -Math.log10(threshold);
  if (thresholdY <= yMax) element('path', { d: `M${box.left} ${yMap(thresholdY)}H${box.left + box.width}`, fill: 'none', stroke: '#819b97', 'stroke-width': 1, 'stroke-dasharray': '5 4' }, svg);
  if (lfcThreshold > 0) {
    for (const lfc of [-lfcThreshold, lfcThreshold]) element('path', { d: `M${xMap(lfc)} ${box.top}V${box.top + box.height}`, fill: 'none', stroke: '#819b97', 'stroke-width': 1, 'stroke-dasharray': '5 4' }, svg);
  }
  const colors = { high: '#087e78', other: '#b9c9c6', target: '#c95744' };
  for (const point of valid) {
    const value = point[metric === 'PValue' ? 'p' : 'fdr'];
    const y = -Math.log10(Math.max(value || 0, 1e-300));
    const id = String(point.row.id ?? point.row.featureId ?? '');
    const isTarget = options.target && id === String(options.target);
    const isHigh = activeThreshold(point.row, metric, threshold, lfcThreshold);
    const circle = element('circle', {
      cx: xMap(point.x), cy: yMap(Math.min(y, yMax)), r: isTarget ? 5.4 : 3.2,
      fill: isTarget ? colors.target : isHigh ? colors.high : colors.other,
      stroke: isTarget ? INK : '#ffffff', 'stroke-width': isTarget ? 1.5 : .6,
      tabindex: 0, role: 'button', 'data-feature-id': id,
    }, svg);
    const title = element('title', {}, circle);
    title.textContent = `${id}\nlog2FC: ${point.x.toPrecision(4)}\nP value: ${point.p == null ? '—' : point.p.toExponential(3)}\nFDR: ${point.fdr == null ? '—' : point.fdr.toExponential(3)}`;
    circle.addEventListener('click', () => options.onSelect?.(id));
    circle.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') options.onSelect?.(id); });
  }
  drawLegend(svg, [['满足查看阈值', colors.high], ['其他结果', colors.other], ['目标 feature', colors.target]], 681, 46);
}

function matrixMean(row) {
  const values = Array.isArray(row) ? row.map(finite).filter((v) => v != null) : [];
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function drawMA(container, results, options = {}) {
  const metric = options.metric === "PValue" ? "PValue" : "FDR";
  const threshold = Math.max(1e-300, Number(options.threshold) || .05);
  const lfcThreshold = Math.max(0, Number(options.lfcThreshold) || 0);
  const differential = Array.isArray(results?.differential) ? results.differential : [];
  const featureIds = Array.isArray(results?.featureIds) ? results.featureIds : [];
  const matrix = results?.matrix;
  if (!Array.isArray(matrix) || !featureIds.length) return empty(container, '分析结果未提供 feature × sample 矩阵，无法计算平均丰度。');
  const index = new Map(featureIds.map((id, i) => [String(id), i]));
  const rows = differential.map((row) => {
    const id = String(row.id ?? row.featureId ?? '');
    const matrixRow = matrix[index.get(id)];
    return { row, id, mean: matrixMean(matrixRow), lfc: pointValue(row, 'logFC') };
  }).filter((item) => item.mean != null && item.lfc != null);
  if (!rows.length) return empty(container, '差异结果与表达矩阵没有可匹配的 feature。');
  const xMin = Math.min(...rows.map((r) => r.mean));
  const xMax = Math.max(...rows.map((r) => r.mean));
  const xPad = (xMax - xMin || Math.max(Math.abs(xMin), Math.abs(xMax), 1) * .1) * .08;
  const xDomainMin = xMin - xPad;
  const xDomainMax = xMax + xPad;
  const yAbs = Math.max(1, ...rows.map((r) => Math.abs(r.lfc))) * 1.08;
  const width = 700;
  const height = 365;
  const box = { left: 70, top: 22, width: 580, height: 272 };
  const xMap = (v) => box.left + (v - xDomainMin) / (xDomainMax - xDomainMin) * box.width;
  const yMap = (v) => box.top + box.height - (v + yAbs) / (2 * yAbs) * box.height;
  const svg = makeSvg(container, width, height, '平均丰度与 log2FC 图');
  const xLabel = results.mode === 'counts' ? '平均 log2 CPM' : results.mode === 'expression' ? '平均 log2 表达值' : '平均 log2 丰度';
  axes(svg, box, xLabel, 'log2FC', linearTicks(xDomainMin, xDomainMax, 4), [-yAbs, 0, yAbs], xMap, yMap, formatNumber, formatNumber);  for (const item of rows) {
    const value = pointValue(item.row, metric);
    const isTarget = options.target && item.id === String(options.target);
    const isHigh = value != null && value <= threshold && Math.abs(item.lfc) >= lfcThreshold;
    const circle = element('circle', { cx: xMap(item.mean), cy: yMap(item.lfc), r: isTarget ? 5 : 3, fill: isTarget ? '#c95744' : isHigh ? '#087e78' : '#b9c9c6', stroke: '#fff', 'stroke-width': 1, tabindex: 0, 'data-feature-id': item.id }, svg);
    const title = element('title', {}, circle);
    title.textContent = `${item.id}\n平均矩阵值: ${item.mean.toPrecision(4)}\nlog2FC: ${item.lfc.toPrecision(4)}`;
    circle.addEventListener('click', () => options.onSelect?.(item.id));
  }
}

function featureScore(row, metric) {
  const fdr = pointValue(row, 'FDR');
  const p = pointValue(row, 'PValue');
  const lfc = pointValue(row, 'logFC');
  const key = metric === 'PValue' ? p : fdr;
  return [key == null ? Number.POSITIVE_INFINITY : key, lfc == null ? 0 : -Math.abs(lfc)];
}

export function drawHeatmap(container, results, design = [], options = {}) {
  const featureIds = Array.isArray(results?.featureIds) ? results.featureIds : [];
  const sampleIds = Array.isArray(results?.sampleIds) ? results.sampleIds : [];
  const matrix = results?.matrix;
  if (!featureIds.length || !sampleIds.length || !Array.isArray(matrix)) return empty(container, '分析结果未提供可绘制的 feature × sample 矩阵。');
  const differential = Array.isArray(results.differential) ? results.differential : [];
  const byId = new Map(differential.map((row) => [String(row.id ?? row.featureId ?? ''), row]));
  const rows = featureIds.map((id, i) => {
    const values = Array.isArray(matrix[i]) ? matrix[i].map(finite) : [];
    return { id: String(id), values, diff: byId.get(String(id)) };
  });
  const sd = (row) => {
    const vals = row.values.filter((v) => v != null);
    if (vals.length < 2) return -Infinity;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1));
  };
  rows.sort((a, b) => {
    if (options.mode === 'expression') return sd(b) - sd(a);
    const sa = featureScore(a.diff || {}, options.metric);
    const sb = featureScore(b.diff || {}, options.metric);
    if (sa[0] !== sb[0]) return sa[0] - sb[0];
    if (sa[1] !== sb[1]) return sa[1] - sb[1];
    return sd(b) - sd(a);
  });
  const requestedFeatures = Number(options.maxFeatures);
  const maxFeatures = Number.isFinite(requestedFeatures) ? Math.min(80, Math.max(10, Math.round(requestedFeatures))) : 40;
  const chosen = rows.slice(0, maxFeatures);
  if (!chosen.length) return empty(container, '没有可显示的 feature。');
  const cellW = sampleIds.length > 18 ? 24 : 34;
  const cellH = chosen.length > 28 ? 15 : 19;
  const left = 205;
  const top = 100;
  const width = Math.max(570, left + sampleIds.length * cellW + 20);
  const height = top + chosen.length * cellH + 64;
  const expressionMode = options.mode === 'expression';
  const svg = makeSvg(container, width, height, expressionMode ? 'TPM/FPKM 表达模式热图；每行按样本进行 Z 标准化' : '差异 feature 表达热图；每行按样本进行 Z 标准化');
  const groups = groupLookup(design);
  const colors = groupColors(design);
  sampleIds.forEach((sample, j) => {
    const x = left + j * cellW + cellW / 2;
    const group = getGroup(sample, groups);
    element('rect', { x: left + j * cellW, y: 18, width: cellW, height: 5, fill: colors[group] || MISSING }, svg);
    text(svg, shortLabel(sample, sampleIds.length > 18 ? 7 : 9), x, top - 10, { size: sampleIds.length > 18 ? 8 : 9, fill: MUTED, anchor: 'start', transform: `rotate(-48 ${x} ${top - 10})`, title: sample });
  });
  const gradients = ['#3d75a5', '#f8faf9', '#b95043'];
  chosen.forEach((row, i) => {
    const values = row.values.slice(0, sampleIds.length).filter((v) => v != null);
    const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : 0;
    text(svg, shortLabel(row.id, 24), left - 8, top + i * cellH + cellH * .72, { anchor: 'end', size: chosen.length > 28 ? 8 : 9, fill: row.id === String(options.target || '') ? '#c95744' : INK, weight: row.id === String(options.target || '') ? 750 : 450, title: row.id });
    sampleIds.forEach((sample, j) => {
      const value = finite(row.values[j]);
      const zRaw = value == null || !sd ? null : (value - mean) / sd;
      const z = value == null ? null : zRaw == null ? 0 : clamp(zRaw, -2.5, 2.5) / 2.5;
      let fill = MISSING;
      if (z != null) {
        if (z < 0) {
          const t = z + 1;
          const rgb = [61, 117, 165].map((v, k) => Math.round(v + ([248, 250, 249][k] - v) * t));
          fill = `rgb(${rgb.join(',')})`;
        } else {
          const rgb = [248, 250, 249].map((v, k) => Math.round(v + ([185, 80, 67][k] - v) * z));
          fill = `rgb(${rgb.join(',')})`;
        }
      }
      const rect = element('rect', { x: left + j * cellW, y: top + i * cellH, width: cellW, height: cellH, fill, stroke: '#fff', 'stroke-width': .7, 'data-feature-id': row.id, tabindex: 0 }, svg);
      const title = element('title', {}, rect);
      title.textContent = String(row.id) + ' · ' + sample + ': ' + (value == null ? '缺失' : value.toPrecision(4));
      if (value != null) {
        if (zRaw == null) title.textContent += '\n行内 Z: 不可定义（该行无变异）';
        else {
          title.textContent += '\n行内 Z: ' + zRaw.toFixed(2);
          if (Math.abs(zRaw) > 2.5) title.textContent += '\n颜色按 ±2.5 截断';
        }
      }      rect.addEventListener('click', () => options.onSelect?.(row.id));
    });
  });
  text(svg, expressionMode ? 'TPM/FPKM 表达模式；行内 Z 标准化仅用于颜色显示；灰色表示缺失。颜色范围截断于 ±2.5 SD。' : '行内 Z 标准化仅用于颜色显示；灰色表示缺失。颜色范围截断于 ±2.5 SD。', left, height - 39, { anchor: 'start', size: 10, fill: MUTED });
  text(svg, '低', width - 108, height - 10, { anchor: 'start', size: 9, fill: MUTED });
  element('rect', { x: width - 82, y: height - 22, width: 18, height: 9, fill: gradients[0] }, svg);
  element('rect', { x: width - 63, y: height - 22, width: 18, height: 9, fill: gradients[1] }, svg);
  element('rect', { x: width - 44, y: height - 22, width: 18, height: 9, fill: gradients[2] }, svg);
  text(svg, '高', width - 13, height - 10, { anchor: 'end', size: 9, fill: MUTED });
}
