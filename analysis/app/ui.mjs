import * as core from './core.mjs';
import { runAnalysis, runEnrichment } from './compute.mjs';
import { importFile } from './import.mjs';
import { LocalHelperClient } from './local-helper-client.mjs';
import {
  drawCorrelation, drawDistributions, drawHeatmap, drawMA, drawPca, drawVolcano,
} from './charts.mjs';

const $ = (id) => document.getElementById(id);
const state = {
  dataset: null,
  file: null,
  dataSource: null,
  helperClient: new LocalHelperClient(),
  helperCapabilities: null,
  helperFile: null,
  helperCompareFile: null,
  helperFastaFile: null,
  helperBusy: false,
  helperController: null,
  design: [],
  results: null,
  analysisOptions: null,
  controller: null,
  running: false,
  selectedFeature: '',
  enrichBusy: false,
};

const CHART_IDS = {
  correlation: 'correlationChart', pca: 'pcaChart', distributions: 'distributionChart',
  volcano: 'volcanoChart', ma: 'maChart', heatmap: 'heatmapChart',
};

function show(id, visible = true) { $(id).classList.toggle('hidden', !visible); }
function setAlert(id, message = '', success = false) {
  const node = $(id);
  node.textContent = message;
  node.classList.toggle('is-success', success);
  show(id, Boolean(message));
}
function setStatus(text, tone = '') {
  const node = $('dataStatus');
  node.textContent = text;
  node.className = `status-pill${tone ? ` is-${tone}` : ''}`;
}
function formatNumber(value, digits = 3) {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (number !== 0 && Math.abs(number) < 0.001) return number.toExponential(digits);
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function plainText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join('\n');
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
function normalizeProgress(value) {
  if (typeof value === 'string') return { message: value, progress: null };
  if (!value || typeof value !== 'object') return { message: '处理中…', progress: null };
  const raw = Number(value.progress ?? value.percent ?? value.fraction);
  const progress = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw <= 1 ? raw * 100 : raw)) : null;
  return { message: value.message || value.status || value.stage || '处理中…', progress };
}
function activeMode() { return $('dataMode').value; }
function activeScale() { return $('dataScale').value; }

function buildFilters({ localHelper = false } = {}) {
  if (activeMode() !== 'proteomics') {
    return { filters: [], exclude_protein_group_contains: [], minimum_distinct_peptides: 0, peptide_count_scope: $('peptideScope').value };
  }
  const specs = [
    ['Q.Value', 'filterQValue'], ['Global.Q.Value', 'filterGlobalQValue'],
    ['PG.Q.Value', 'filterPgQValue'], ['Global.PG.Q.Value', 'filterGlobalPgQValue'],
  ];
  const filters = specs.flatMap(([column, id]) => {
    const raw = $(id).value.trim();
    if (!raw) return [];
    const threshold = Number(raw);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error(`${column} 阈值须为 0 到 1 之间的数。`);
    return [[column, '<', threshold]];
  });
  if (localHelper) {
    const optionalFilters = [
      ['Lib.Peptidoform.Q.Value', 'filterLibPeptidoformQValue', '<', true],
      ['Quantity.Quality', 'filterQuantityQuality', '>', false],
      ['PG.MaxLFQ.Quality', 'filterPgMaxLfqQuality', '>', false],
    ];
    for (const [column, id, operator, probability] of optionalFilters) {
      const raw = $(id).value.trim();
      if (!raw) continue;
      const threshold = Number(raw);
      if (!Number.isFinite(threshold) || (probability && (threshold < 0 || threshold > 1))) {
        throw new Error(`${column} 阈值无效${probability ? '；须在 0 到 1 之间' : ''}。`);
      }
      filters.push([column, operator, threshold]);
    }
  }
  const peptideRaw = $('minimumPeptides').value.trim();
  const peptides = peptideRaw ? Number(peptideRaw) : 0;
  if (!Number.isInteger(peptides) || peptides < 0) throw new Error('最少 distinct peptides 须为大于或等于 0 的整数。');
  const contaminant = $('contaminantText').value.trim();
  return {
    filters,
    exclude_protein_group_contains: contaminant ? [contaminant] : [],
    minimum_distinct_peptides: peptides,
    peptide_count_scope: $('peptideScope').value,
    require_proteotypic_group: localHelper && $('requireProteotypicGroup').checked,
  };
}

function hasHelperOnlyImportSettings() {
  if (activeMode() !== 'proteomics') return false;
  return ['filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality'].some((id) => $(id).value.trim())
    || $('requireProteotypicGroup').checked
    || $('featureColumn').value !== 'Protein.Group'
    || $('quantityColumn').value !== 'PG.MaxLFQ'
    || $('duplicatePolicy').value !== 'error';
}

function helperImportOptions() {
  if (activeMode() !== 'proteomics') throw new Error('本机报告导入目前用于 LFQ 蛋白组；RNA counts 与 TPM/FPKM 继续使用原有浏览器导入。');
  if (activeScale() !== 'linear') throw new Error('DIA-NN 本机报告需使用 LFQ 线性尺度；请将矩阵尺度设为线性。');
  const featureColumn = $('featureColumn').value;
  const quantityColumn = $('quantityColumn').value;
  const compatible = quantityColumn.startsWith('PG.') ? featureColumn === 'Protein.Group'
    : quantityColumn.startsWith('Genes.') ? featureColumn === 'Genes'
      : featureColumn === 'Precursor.Id';
  if (!compatible) throw new Error(`特征列 ${featureColumn} 与定量列 ${quantityColumn} 不匹配；请按定量层级选择特征列。`);
  return {
    mode: activeMode(), scale: activeScale(), filters: buildFilters({ localHelper: true }),
    featureColumn, quantityColumn, duplicatePolicy: $('duplicatePolicy').value,
  };
}

function metadataDesign(dataset) {
  const source = dataset?.metadata?.design;
  if (Array.isArray(source)) return new Map(source.map((row) => [String(row.run ?? row.sample ?? ''), row]));
  const samples = dataset?.metadata?.samples;
  if (Array.isArray(samples)) return new Map(samples.map((row) => [String(row.run ?? row.id ?? row.sample ?? ''), row]));
  return new Map();
}

function initializeDesign(dataset) {
  const metadata = metadataDesign(dataset);
  state.design = (dataset.sampleIds || []).map((sampleId) => {
    const details = metadata.get(String(sampleId)) || {};
    return {
      run: String(sampleId),
      sample: String(details.sample ?? details.biologicalSample ?? sampleId),
      group: String(details.group ?? ''),
      exclude: Boolean(details.exclude),
    };
  });
  renderDesign();
}

function currentDesign() {
  return [...$('designRows').querySelectorAll('tr')].map((row) => ({
    run: row.dataset.run,
    sample: row.querySelector('[data-field="sample"]').value.trim(),
    group: row.querySelector('[data-field="group"]').value.trim(),
    exclude: row.querySelector('[data-field="exclude"]').checked,
  }));
}

function renderDesign() {
  const body = $('designRows');
  body.replaceChildren();
  for (const item of state.design) {
    const row = document.createElement('tr');
    row.dataset.run = item.run;
    const run = document.createElement('td');
    run.textContent = item.run;
    const sampleCell = document.createElement('td');
    const sample = document.createElement('input');
    sample.type = 'text'; sample.value = item.sample; sample.dataset.field = 'sample';
    sample.setAttribute('aria-label', `${item.run} 生物样本名称`);
    sampleCell.append(sample);
    const groupCell = document.createElement('td');
    const group = document.createElement('input');
    group.type = 'text'; group.value = item.group; group.dataset.field = 'group';
    group.setAttribute('aria-label', `${item.run} 组别`);
    groupCell.append(group);
    const excludeCell = document.createElement('td');
    excludeCell.className = 'check-cell';
    const exclude = document.createElement('input');
    exclude.type = 'checkbox'; exclude.checked = item.exclude; exclude.dataset.field = 'exclude';
    exclude.setAttribute('aria-label', `排除 ${item.run}`);
    excludeCell.append(exclude);
    row.append(run, sampleCell, groupCell, excludeCell);
    body.append(row);
  }
  $('designCount').textContent = `${state.design.length} 个输入 run`;
  body.oninput = () => { syncDesignFromDom(); invalidateResults(); renderGroupChoices(); updateRunButton(); };
  body.onchange = () => { syncDesignFromDom(); invalidateResults(); renderGroupChoices(); updateRunButton(); };
  renderGroupChoices();
  show('design-stage', true);
  show('analysis-stage', true);
  updateDesignTools();
  updateRunButton();
}

function updateDesignTools() {
  const ready = Boolean(state.dataset) && !state.running && !state.helperBusy;
  $('importDesignButton').disabled = !ready || !$('designFile').files?.length;
  $('saveSessionButton').disabled = !ready;
  $('loadSessionButton').disabled = !ready;
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function designBoolean(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['', '0', 'false', 'no', 'n'].includes(text)) return false;
  if (['1', 'true', 'yes', 'y', 'x'].includes(text)) return true;
  throw new Error(`${label} 仅接受 yes/no、true/false、1/0 或空值。`);
}

async function importDesignTable() {
  const file = $('designFile').files?.[0];
  if (!state.dataset) { setAlert('designAlert', '请先导入数据，再匹配样本表。'); return; }
  if (!file) { $('designImportStatus').textContent = '请先选择 CSV / TSV 样本表。'; return; }
  try {
    const parsed = core.delimitedRows(await file.text());
    const normalized = parsed.header.map(normalizeHeader);
    const findColumn = (aliases) => normalized.findIndex((name) => aliases.includes(name));
    const runIndex = findColumn(['run']);
    const sampleIndex = findColumn(['sample', 'biologicalsample', 'biologicalsamplename']);
    const groupIndex = findColumn(['group', 'agegroup', 'day']);
    const excludeIndex = findColumn(['exclude', 'excluded']);
    if (runIndex < 0 || sampleIndex < 0 || groupIndex < 0) {
      throw new Error('样本表需包含 Run/run、sample/Sample 或 biologicalsample，以及 group/age_group/Day 列。');
    }
    const expectedRuns = (state.dataset.sampleIds || []).map(String);
    const expected = new Set(expectedRuns);
    const rows = new Map();
    for (let i = 0; i < parsed.rows.length; i += 1) {
      const raw = parsed.rows[i];
      const run = String(raw[runIndex] ?? '').trim();
      const sample = String(raw[sampleIndex] ?? '').trim();
      const group = String(raw[groupIndex] ?? '').trim();
      if (!run) throw new Error(`样本表第 ${i + 2} 行的 Run 为空。`);
      if (!sample) throw new Error(`样本表第 ${i + 2} 行的 sample 为空。`);
      if (!group) throw new Error(`样本表第 ${i + 2} 行的 group 为空。`);
      if (!expected.has(run)) throw new Error(`样本表包含数据中不存在的 Run：${run}`);
      if (rows.has(run)) throw new Error(`样本表中的 Run 重复：${run}`);
      rows.set(run, { run, sample, group, exclude: excludeIndex < 0 ? false : designBoolean(raw[excludeIndex], `Run ${run} 的 exclude`) });
    }
    const missing = expectedRuns.filter((run) => !rows.has(run));
    if (missing.length) throw new Error(`样本表未覆盖全部输入 Run；缺少 ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    state.design = expectedRuns.map((run) => rows.get(run));
    renderDesign();
    $('designImportStatus').textContent = `已导入 ${file.name}，精确匹配 ${expectedRuns.length} 个输入 Run。`;
    setAlert('designAlert', '');
  } catch (error) {
    $('designImportStatus').textContent = '样本表未导入。';
    setAlert('designAlert', error?.message || String(error));
  }
}

function sessionControls() {
  const ids = [
    'dataMode', 'dataScale', 'expressionUnit', 'filterQValue', 'filterGlobalQValue', 'filterPgQValue',
    'filterGlobalPgQValue', 'minimumPeptides', 'peptideScope', 'contaminantText',
    'filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality',
    'featureColumn', 'quantityColumn', 'duplicatePolicy', 'analysisAlpha', 'analysisLfc',
    'technicalAggregation', 'minimumObserved', 'statisticalMethod', 'pAdjust', 'normalization',
    'imputation', 'imputationScope', 'seed',
  ];
  const values = Object.fromEntries(ids.map((id) => [id, $(id).value]));
  values.requireProteotypicGroup = $('requireProteotypicGroup').checked;
  values.upstreamConfirmed = $('upstreamConfirmed').checked;
  values.caseGroup = $('caseGroup').value;
  values.controlGroup = $('controlGroup').value;
  return values;
}

function saveSessionSettings() {
  if (!state.dataset) return;
  const hash = state.dataset.metadata?.sha256 || null;
  const syntheticSeed = state.dataset.metadata?.synthetic ? 417 : null;
  if (!hash && syntheticSeed == null) {
    $('sessionStatus').textContent = '当前输入没有可核对的来源指纹，无法生成可验证的设置文件。';
    return;
  }
  const session = {
    format: 'ExperiAnalysisSettings', version: 1,
    input: { sha256: hash, syntheticSeed, mode: state.dataset.mode, scale: state.dataset.scale },
    settings: { controls: sessionControls(), design: currentDesign() },
  };
  saveBlob(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json;charset=utf-8' }), 'experianalysis_settings.json');
  $('sessionStatus').textContent = '设置已保存；文件不包含原始数据或本机路径。';
}

async function loadSessionSettings() {
  const file = $('sessionFile').files?.[0];
  if (!state.dataset) { $('sessionStatus').textContent = '请先导入与设置文件匹配的数据。'; return; }
  if (!file) { $('sessionStatus').textContent = '请选择 ExperiAnalysis 设置 JSON。'; return; }
  try {
    const saved = JSON.parse(await file.text());
    if (saved?.format !== 'ExperiAnalysisSettings' || saved?.version !== 1 || !saved.settings?.controls || !Array.isArray(saved.settings.design)) {
      throw new Error('设置文件格式或版本不受支持。');
    }
    const input = saved.input || {};
    const currentHash = state.dataset.metadata?.sha256 || null;
    const hashMatches = Boolean(input.sha256 && currentHash && String(input.sha256).toLowerCase() === String(currentHash).toLowerCase());
    const syntheticMatches = Boolean(input.syntheticSeed === 417 && state.dataset.metadata?.synthetic);
    if (!hashMatches && !syntheticMatches) throw new Error('设置文件与当前输入的 SHA-256 不匹配；请先载入原始输入文件。');
    if (input.mode !== state.dataset.mode || input.scale !== state.dataset.scale) throw new Error('设置文件的数据类型或尺度与当前输入不一致。');
    const controls = saved.settings.controls;
    const expectedRuns = (state.dataset.sampleIds || []).map(String);
    const expected = new Set(expectedRuns);
    if (saved.settings.design.length !== expectedRuns.length) throw new Error('设置文件中的样本设计未覆盖全部输入 Run。');
    const designByRun = new Map();
    for (const row of saved.settings.design) {
      const run = String(row?.run ?? '').trim();
      const sample = String(row?.sample ?? '').trim();
      const group = String(row?.group ?? '').trim();
      if (!run || !expected.has(run) || designByRun.has(run)) throw new Error(`设置文件中的 Run 无效或重复：${run || '空'}`);
      if (!sample || !group) throw new Error(`设置文件中的 Run ${run} 缺少 sample 或 group。`);
      designByRun.set(run, { run, sample, group, exclude: Boolean(row.exclude) });
    }
    if (expectedRuns.some((run) => !designByRun.has(run))) throw new Error('设置文件中的 Run 名称与当前输入不完全匹配。');
    const design = expectedRuns.map((run) => designByRun.get(run));
    const groups = new Set(design.filter((row) => !row.exclude).map((row) => row.group));
    if (state.dataset.mode !== 'expression' && (!groups.has(String(controls.caseGroup)) || !groups.has(String(controls.controlGroup)) || controls.caseGroup === controls.controlGroup)) {
      throw new Error('设置文件中的处理组/对照组与当前样本设计不匹配。');
    }
    const selectIds = ['dataMode', 'dataScale', 'expressionUnit', 'peptideScope', 'featureColumn', 'quantityColumn', 'duplicatePolicy', 'technicalAggregation', 'statisticalMethod', 'pAdjust', 'normalization', 'imputation', 'imputationScope'];
    for (const id of selectIds) {
      const select = $(id); const value = String(controls[id] ?? '');
      if (![...select.options].some((option) => option.value === value)) throw new Error(`设置文件中的 ${id} 选项不受支持。`);
    }
    if (controls.dataMode !== state.dataset.mode || controls.dataScale !== state.dataset.scale) throw new Error('设置文件的类型/尺度与当前输入不一致。');
    for (const id of ['filterQValue', 'filterGlobalQValue', 'filterPgQValue', 'filterGlobalPgQValue', 'minimumPeptides', 'contaminantText', 'filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality', 'analysisAlpha', 'analysisLfc', 'minimumObserved', 'seed']) {
      if (controls[id] == null) throw new Error(`设置文件缺少 ${id} 参数。`);
    }
    state.design = design;
    for (const id of [...selectIds, 'filterQValue', 'filterGlobalQValue', 'filterPgQValue', 'filterGlobalPgQValue', 'minimumPeptides', 'contaminantText', 'filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality', 'analysisAlpha', 'analysisLfc', 'minimumObserved', 'seed']) {
      $(id).value = String(controls[id]);
    }
    $('requireProteotypicGroup').checked = Boolean(controls.requireProteotypicGroup);
    $('upstreamConfirmed').checked = Boolean(controls.upstreamConfirmed);
    renderDesign();
    renderGroupChoices();
    $('caseGroup').value = String(controls.caseGroup ?? '');
    $('controlGroup').value = String(controls.controlGroup ?? '');
    if (state.dataset.metadata && state.dataset.mode === 'expression') state.dataset.metadata.expressionUnit = controls.expressionUnit;
    invalidateResults('已载入设置；请检查分组和参数后运行分析。');
    updateHelperControls();
    updateRunButton();
    $('sessionStatus').textContent = `已载入 ${file.name}；数据指纹与 Run 设计匹配。`;
  } catch (error) {
    $('sessionStatus').textContent = error?.message || String(error);
  } finally {
    $('sessionFile').value = '';
    updateDesignTools();
  }
}

function syncDesignFromDom() { state.design = currentDesign(); }

function renderGroupChoices() {
  const included = currentDesign().filter((row) => !row.exclude && row.group);
  const groups = [...new Set(included.map((row) => row.group))];
  const caseSelect = $('caseGroup');
  const controlSelect = $('controlGroup');
  const previousCase = caseSelect.value;
  const previousControl = controlSelect.value;
  for (const [select, previous, placeholder] of [[caseSelect, previousCase, '选择处理组'], [controlSelect, previousControl, '选择对照组']]) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const group of groups) select.add(new Option(group, group));
    select.value = groups.includes(previous) ? previous : '';
  }
  if (groups.length === 2) {
    if (!caseSelect.value) caseSelect.value = groups[1];
    if (!controlSelect.value) controlSelect.value = groups[0];
  }
  $('caseGroup').onchange = () => { invalidateResults(); updateRunButton(); };
  $('controlGroup').onchange = () => { invalidateResults(); updateRunButton(); };
}

function designValidationMessage(dataset, design) {
  if (typeof core.validateDesign !== 'function') return '';
  let validation;
  try { validation = core.validateDesign(dataset, design); }
  catch (error) { return error?.message || String(error); }
  if (validation === true || validation == null) return '';
  if (validation === false) return '样本设计未通过检查。';
  if (typeof validation === 'string') return validation;
  if (Array.isArray(validation)) return validation.map((v) => typeof v === 'string' ? v : plainText(v)).filter(Boolean).join('\n');
  if (validation.ok === false || validation.valid === false) {
    const errors = validation.errors || validation.issues || validation.messages;
    return Array.isArray(errors) ? errors.map(plainText).join('\n') : String(errors || validation.message || '样本设计未通过检查。');
  }
  if (Array.isArray(validation.errors) && validation.errors.length) return validation.errors.map(plainText).join('\n');
  return '';
}

function updateRunButton() {
  const dataReady = Boolean(state.dataset);
  const caseGroup = $('caseGroup').value;
  const controlGroup = $('controlGroup').value;
  const exploration = activeMode() === 'expression';
  const validGroups = exploration || Boolean(caseGroup && controlGroup && caseGroup !== controlGroup);
  const confirmed = $('upstreamConfirmed').checked;
  const design = currentDesign();
  const validation = dataReady ? designValidationMessage(state.dataset, design) : '';
  const ready = dataReady && validGroups && confirmed && !state.running && !validation;
  $('runButton').disabled = !ready;
  $('runProgress').textContent = !dataReady ? '请先导入数据或载入合成示例。' : state.running ? '正在运行分析…' : !confirmed ? '请确认上游处理状态。' : !validGroups ? '请填写至少两个有效组别，并选择处理组和对照组。' : validation || (exploration ? '表达探索已就绪；仍需为保留样本填写生物样本与组别。' : '样本设计与主要参数已就绪。');
  setAlert('designAlert', validation);
  if (dataReady) $('enrichButton').disabled = activeMode() === 'expression' || state.enrichBusy || state.running || !state.results;
}

function renderDatasetSummary(dataset, sourceLabel) {
  const samples = Array.isArray(dataset.sampleIds) ? dataset.sampleIds.length : 0;
  const features = Array.isArray(dataset.featureIds) ? dataset.featureIds.length : 0;
  let values = 0;
  let missing = 0;
  for (const row of Array.isArray(dataset.values) ? dataset.values : []) {
    for (const value of Array.isArray(row) ? row : []) {
      if (value == null || !Number.isFinite(Number(value))) missing += 1;
      else values += 1;
    }
  }
  const summary = $('datasetSummary');
  summary.replaceChildren();
  const chips = [
    sourceLabel,
    `${features.toLocaleString()} 个${dataset.mode === 'proteomics' ? '蛋白组' : '基因'}`,
    `${samples.toLocaleString()} 个样本 run`,
    `尺度：${dataset.scale || activeScale()}`,
    `${values.toLocaleString()} 个可测数值`,
    `${missing.toLocaleString()} 个缺失值`,
  ];
  const audit = dataset.audit || {};
  if (Number.isFinite(Number(audit.sourceRows))) chips.push(`来源行数：${Number(audit.sourceRows).toLocaleString()}`);
  if (Number.isFinite(Number(audit.retainedRows))) chips.push(`筛选保留行数：${Number(audit.retainedRows).toLocaleString()}`);
  if (typeof audit.precursorFiltersApplied === 'boolean') chips.push(`上游前体过滤：${audit.precursorFiltersApplied ? '已应用' : '未应用'}`);
  if (dataset.metadata?.demo || dataset.audit?.demo) chips.push('合成示例数据');
  for (const label of chips) {
    const chip = document.createElement('span');
    chip.className = 'summary-chip'; chip.textContent = label; summary.append(chip);
  }
  if (audit && (Array.isArray(audit.stages) || audit.notes)) {
    const details = document.createElement('details');
    details.className = 'audit-details';
    const heading = document.createElement('summary'); heading.textContent = '查看导入筛选与行数记录';
    details.append(heading);
    if (Array.isArray(audit.stages) && audit.stages.length) {
      const wrap = document.createElement('div'); wrap.className = 'table-wrap audit-table-wrap';
      const table = document.createElement('table');
      const thead = document.createElement('thead'); const header = document.createElement('tr');
      for (const label of ['筛选步骤', '输入行', '排除行', '保留行', '无效值行']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
      thead.append(header); table.append(thead);
      const tbody = document.createElement('tbody');
      for (const stage of audit.stages) {
        const row = document.createElement('tr');
        const values = [auditStepLabel(stage.step), stage.input_rows, stage.removed_rows, stage.output_rows, stage.missing_nonnumeric_or_nonfinite_in_incoming_rows];
        for (let index = 0; index < values.length; index += 1) {
          const cell = document.createElement('td'); cell.textContent = values[index] == null ? '—' : String(values[index]);
          if (index === 0 && stage.step) cell.title = String(stage.step);
          row.append(cell);
        }
        tbody.append(row);
      }
      table.append(tbody); wrap.append(table); details.append(wrap);
    }
    if (Array.isArray(audit.runCounts) && audit.runCounts.length) {
      const wrap = document.createElement('div'); wrap.className = 'table-wrap audit-table-wrap';
      const table = document.createElement('table');
      const thead = document.createElement('thead'); const header = document.createElement('tr');
      for (const label of ['输入 run', '来源行', '筛选后行', '保留特征数']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
      thead.append(header); table.append(thead);
      const tbody = document.createElement('tbody');
      for (const run of audit.runCounts) {
        const row = document.createElement('tr');
        for (const value of [run.run, run.input_rows, run.output_rows, run.groups]) { const cell = document.createElement('td'); cell.textContent = value == null ? '—' : String(value); row.append(cell); }
        tbody.append(row);
      }
      table.append(tbody); wrap.append(table); details.append(wrap);
    }
    if (Array.isArray(audit.runMetrics) && audit.runMetrics.length) {
      const wrap = document.createElement('div'); wrap.className = 'table-wrap audit-table-wrap';
      const table = document.createElement('table');
      const thead = document.createElement('thead'); const header = document.createElement('tr');
      for (const label of ['输入 run', '指标', '有效数值 n', 'Q05', '中位数', 'Q95']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
      thead.append(header); table.append(thead);
      const tbody = document.createElement('tbody');
      for (const metric of audit.runMetrics) {
        const row = document.createElement('tr');
        for (const value of [metric.run, metric.metric, metric.n, metric.q05, metric.median, metric.q95]) {
          const cell = document.createElement('td'); cell.textContent = value == null ? '—' : typeof value === 'number' ? formatNumber(value, 4) : String(value); row.append(cell);
        }
        tbody.append(row);
      }
      table.append(tbody); wrap.append(table); details.append(wrap);
    }    for (const note of Array.isArray(audit.notes) ? audit.notes : audit.notes ? [audit.notes] : []) {
      const p = document.createElement('p'); p.className = 'audit-note'; p.textContent = String(note); details.append(p);
    }
    summary.append(details);
  }
  show('datasetSummary', true);
}

function auditStepLabel(value) {
  const step = String(value ?? '').trim();
  if (!step) return '筛选步骤';
  if (step.startsWith('Global.PG.Q.Value')) return '全局蛋白组 PG.Q.Value 筛选';
  if (step.startsWith('PG.Q.Value')) return '蛋白组 PG.Q.Value 筛选';
  if (step.startsWith('Global.Q.Value')) return '全局前体 Q.Value 筛选';
  if (step.startsWith('Q.Value')) return '前体 Q.Value 筛选';
  if (step.startsWith('Protein.Group excludes literal')) return '按指定文本排除 Protein.Group';
  if (step.startsWith('distinct peptides >=')) return 'distinct peptide 数目筛选';
  return step;
}

function updateProcessingRuntimeNote() {
  const method = $('imputation').value;
  const note = $('processingRuntimeNote');
  if (activeMode() !== 'proteomics' || method === 'none') { note.textContent = ''; show('processingRuntimeNote', false); return; }
  if (!state.helperCapabilities?.rAvailable) {
    note.textContent = `${method} 插补需要正在运行且提供 Rscript 的本机分析助手；当前不会自动回退到浏览器模式。`;
  } else if (method === 'MinProb') {
    note.textContent = 'MinProb 需要本机 R 与相应软件包；若环境未安装，helper 会返回明确错误。';
  } else {
    note.textContent = 'KNN 插补将由本机 R 环境执行；结果与插补用途会写入方法记录。';
  }
  show('processingRuntimeNote', true);
}

function updateModeControls() {
  const mode = activeMode();
  const exploration = mode === 'expression';
  const proteomics = mode === 'proteomics';
  show('proteomicsFilters', proteomics);
  show('helperReportOptions', proteomics);
  show('normalizationWrap', proteomics);
  show('imputationWrap', proteomics);
  show('imputationAdvanced', proteomics);
  show('statisticalMethodWrap', proteomics);
  show('pAdjustWrap', !exploration);
  show('minimumObservedWrap', !exploration);
  show('technicalAggregationWrap', mode !== 'counts');
  show('aggregationNode', true);
  show('statisticsNode', !exploration);
  show('expressionUnitWrap', exploration);
  show('contrastGrid', !exploration);
  show('analysisAlphaWrap', !exploration);
  show('analysisLfcWrap', !exploration);
  show('expressionModeNote', exploration);
  show('enrichmentOptions', !exploration);
  $('analysisOptionsHelp').textContent = exploration
    ? '表达探索按所选单位与矩阵尺度处理数据；此模式不进行差异显著性分析。'
    : mode === 'counts'
      ? 'RNA counts 保留原有 edgeR 计数流程；LFQ 专属归一化、插补与统计方法不会应用于 RNA counts。'
      : 'limma、Welch 与 BH/BY 选项会写入方法记录；阈值只控制结果判定。查看阈值仅改变展示。';
  $('designHelp').textContent = exploration
    ? 'TPM/FPKM 探索无需选择 case/control 对比；每行仍需填写生物样本与组别，用于合并技术重复和标注样本 QC。'
    : '每行对应一个输入 run。相同生物学样本的技术重复可填写相同“生物样本”名称；排除样本请勾选对应行。分组标签由你填写。';
  $('aggregationHelp').textContent = mode === 'counts'
    ? 'RNA counts 的技术重复继续按原始计数求和；均值/中位数选项不改变现有 RNA 流程。'
    : '技术重复在原始线性尺度上按所选方式合并，再按矩阵尺度进行后续分析。';
  if (exploration) $('enrichButton').disabled = true;
  updateProcessingRuntimeNote();
  updateHelperControls();
  if (state.dataset) clearLoadedData('数据类型已更改，请重新导入。');
}

function clearLoadedData(message = '请先导入或载入合成示例数据。') {
  if (state.running) state.controller?.abort();
  state.dataset = null; state.file = null; state.dataSource = null; state.results = null; state.analysisOptions = null; state.design = []; state.selectedFeature = '';
  $('upstreamConfirmed').checked = false;
  $('normalization').value = 'none';
  $('technicalAggregation').value = 'mean';
  $('minimumObserved').value = '2';
  $('imputation').value = 'none';
  $('imputationScope').value = 'visualization';
  $('seed').value = '417';
  $('statisticalMethod').value = 'limma';
  $('pAdjust').value = 'BH';
  $('designRows').replaceChildren();
  $('caseGroup').replaceChildren(new Option('先填写组别', ''));
  $('controlGroup').replaceChildren(new Option('先填写组别', ''));
  $('datasetSummary').replaceChildren();
  $('targetSummary').replaceChildren();
  show('targetSummary', false);
  updateAtlasLink();
  $('results-stage').classList.add('hidden');
  $('design-stage').classList.add('hidden');
  $('analysis-stage').classList.add('hidden');
  $('runProgress').textContent = message;
  setStatus('等待导入');
  setAlert('dataAlert', '');
  updateProcessingRuntimeNote();
  updateHelperControls();
  updateRunButton();
}

function invalidateResults(message = '分析设置已更改，请重新运行。') {
  if (state.running) state.controller?.abort();
  if (!state.results && !state.running) return;
  state.results = null;
  state.analysisOptions = null;
  show('results-stage', false);
  $('enrichButton').disabled = true;
  $('runProgress').textContent = message;
}

function onImportProgress(value) {
  const progress = normalizeProgress(value);
  $('loadProgress').textContent = progress.message;
}

function setHelperStatus(message, tone = '') {
  const node = $('helperStatus');
  node.textContent = message;
  node.className = `status-pill${tone ? ` is-${tone}` : ''}`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024; let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}

function renderHelperFileSummary(file, elementId = 'helperFileSummary') {
  const root = $(elementId);
  root.replaceChildren();
  if (!file) { show(elementId, false); return; }
  const title = document.createElement('strong');
  title.textContent = `${file.name || '本机文件'} · ${file.type || '类型未知'}`;
  const facts = document.createElement('p');
  facts.textContent = `${formatBytes(file.bytes)} · ${Number(file.rows ?? 0).toLocaleString()} 行 · ${Array.isArray(file.columns) ? file.columns.length.toLocaleString() : '未知'} 列`;
  root.append(title, facts);
  if (Array.isArray(file.columns) && file.columns.length) {
    const preview = document.createElement('p');
    const visible = file.columns.slice(0, 12).map(String);
    preview.textContent = `字段预览：${visible.join(' · ')}${file.columns.length > visible.length ? ` · …另有 ${file.columns.length - visible.length} 列` : ''}`;
    root.append(preview);
  }
  show(elementId, true);
}

function helperReportType(file) { return file?.type === 'report'; }
function helperXicType(file) { return file?.type === 'xic'; }

function updateHelperControls() {
  const client = state.helperClient;
  const connected = Boolean(client?.available);
  const canInspect = connected && client.supports('inspect');
  const mainReport = helperReportType(state.helperFile);
  const mainXic = helperXicType(state.helperFile);
  const compareReport = helperReportType(state.helperCompareFile);
  const canSequence = connected && client.supports('sequence');
  const reportConfigActive = connected && mainReport && activeMode() === 'proteomics';
  const busy = state.helperBusy;
  $('helperRefreshButton').disabled = busy;
  $('helperPickButton').disabled = !canInspect || busy;
  $('helperRegisterButton').disabled = !canInspect || busy || !$('helperPath').value.trim();
  $('helperComparePath').disabled = !reportConfigActive || busy;
  $('helperComparePickButton').disabled = !canInspect || busy || !mainReport;
  $('helperCompareRegisterButton').disabled = !canInspect || busy || !mainReport || !$('helperComparePath').value.trim();
  $('helperImportButton').disabled = !connected || !client.supports('import') || !mainReport || activeMode() !== 'proteomics' || activeScale() !== 'linear' || busy;
  for (const id of ['filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality', 'requireProteotypicGroup', 'featureColumn', 'quantityColumn', 'duplicatePolicy']) {
    $(id).disabled = !reportConfigActive || busy;
  }
  show('helperFileSummary', Boolean(state.helperFile));
  show('helperCompareSummary', Boolean(state.helperCompareFile));
  show('helperInspectControls', (mainReport && client.supports('target')) || (mainXic && client.supports('xic')));
  show('helperTargetWrap', mainReport && client.supports('target'));
  show('helperTargetButton', mainReport && client.supports('target'));
  show('helperXicWrap', mainXic && client.supports('xic'));
  show('helperXicButton', mainXic && client.supports('xic'));
  show('helperCompareRegistration', mainReport && client.supports('compare'));
  show('helperReportOptions', activeMode() === 'proteomics' && mainReport);
  $('helperTargetButton').disabled = !mainReport || !client.supports('target') || busy;
  $('helperXicButton').disabled = !mainXic || !client.supports('xic') || busy;
  $('helperCompareButton').disabled = !mainReport || !compareReport || !client.supports('compare') || busy;
  show('helperSequenceTools', canInspect && canSequence);
  $('helperFastaPath').disabled = !canSequence || busy;
  $('helperFastaPickButton').disabled = !canInspect || !canSequence || busy;
  $('helperFastaRegisterButton').disabled = !canInspect || !canSequence || busy || !$('helperFastaPath').value.trim();
  $('helperProteinId').disabled = !state.helperFastaFile || busy;
  $('helperPeptides').disabled = !state.helperFastaFile || busy;
  $('helperSequenceButton').disabled = !state.helperFastaFile || !canSequence || busy || !$('helperProteinId').value.trim();
  show('helperFastaSummary', Boolean(state.helperFastaFile));
  show('helperCancelButton', busy);
  $('helperCancelButton').disabled = !busy;
  $('importDesignButton').disabled = !state.dataset || !$('designFile').files?.length || busy;
  $('saveSessionButton').disabled = !state.dataset || busy;
  $('loadSessionButton').disabled = !state.dataset || busy;
  updateEnrichmentControls();
}

function updateEnrichmentControls() {
  const supported = Boolean(state.helperClient?.available && state.helperClient.supports('enrichment'));
  const ranked = $('enrichmentMethod').value === 'ranked';
  $('rankedEnrichmentOption').disabled = !supported;
  $('rankedEnrichmentOption').textContent = supported ? '排序富集（本机 R）' : '排序富集（需连接本机 R）';
  show('rankedEnrichmentOptions', ranked);
  show('enrichmentSpeciesWrap', !ranked);
  const noResults = !state.results || !Array.isArray(state.results.differential) || !state.results.differential.length;
  $('enrichButton').disabled = activeMode() === 'expression' || noResults || state.enrichBusy || (ranked && !supported);
  if (ranked && !supported && state.results) $('enrichmentStatus').textContent = '排序富集需要连接支持该方法的本机分析助手。';
}

async function refreshHelperStatus() {
  setHelperStatus('正在检查本机分析助手');
  try {
    const previousToken = state.helperCapabilities?.token;
    const capabilities = await state.helperClient.connect();
    if (previousToken && previousToken !== capabilities.token) {
      state.helperFile = null;
      state.helperCompareFile = null;
      state.helperFastaFile = null;
      renderHelperFileSummary(null);
      renderHelperFileSummary(null, 'helperCompareSummary');
      renderHelperFileSummary(null, 'helperFastaSummary');
      $('helperProgress').textContent = '本机分析助手已重新启动，请重新登记文件。';
    }
    state.helperCapabilities = capabilities;
    setHelperStatus(`已连接 · ${capabilities.version}${capabilities.rAvailable ? ' · 本机 R 可用' : ''}`, 'ready');
    updateHelperControls();
    updateProcessingRuntimeNote();
    return capabilities;
  } catch {
    state.helperCapabilities = null;
    setHelperStatus('本机分析助手未连接');
    updateHelperControls();
    updateProcessingRuntimeNote();
    return null;
  }
}

function helperProgress(value) {
  const progress = normalizeProgress(value);
  $('helperProgress').textContent = progress.message;
}

async function runHelperTask(label, operation) {
  if (state.helperBusy) return null;
  const controller = new AbortController();
  state.helperController = controller;
  state.helperBusy = true;
  $('helperProgress').textContent = label;
  setAlert('helperAlert', '');
  updateHelperControls();
  try {
    return await operation(helperProgress, controller.signal);
  } catch (error) {
    if (error?.name === 'AbortError') $('helperProgress').textContent = '本机任务已取消。';
    else setAlert('helperAlert', error?.message || String(error));
    return null;
  } finally {
    state.helperController = null;
    state.helperBusy = false;
    updateHelperControls();
  }
}

function registerHelperResult(file, slot = 'main') {
  if (!file || file.cancelled) {
    $('helperProgress').textContent = '已取消文件选择。';
    return;
  }
  if (!file.id || !file.name || !file.type) throw new Error('本机分析助手未返回有效的文件登记信息。');
  if (slot === 'compare') {
    state.helperCompareFile = file;
    renderHelperFileSummary(file, 'helperCompareSummary');
    $('helperProgress').textContent = `已登记对比文件：${file.name}`;
  } else if (slot === 'fasta') {
    if (file.type !== 'fasta') throw new Error('请选择 FASTA 格式文件（.fasta、.fa 或 .faa）。');
    state.helperFastaFile = file;
    renderHelperFileSummary(file, 'helperFastaSummary');
    $('helperProgress').textContent = `已登记 FASTA：${file.name}`;
  } else {
    if (state.dataSource === 'helper') clearLoadedData('本机输入已更改，请重新导入。');
    state.helperFile = file;
    renderHelperFileSummary(file);
    $('helperProgress').textContent = `已登记：${file.name}（${file.type}）`;
  }
  setAlert('helperAlert', '');
  updateHelperControls();
}

async function refreshOrRegisterHelperFile(slot = 'main', usePicker = false) {
  if (!state.helperClient.available) { await refreshHelperStatus(); if (!state.helperClient.available) return; }
  const pathId = slot === 'compare' ? 'helperComparePath' : slot === 'fasta' ? 'helperFastaPath' : 'helperPath';
  const path = $(pathId).value.trim();
  if (!usePicker && !path) { setAlert('helperAlert', '请输入本机文件路径，或使用本机文件选择器。'); return; }
  const registered = await runHelperTask(usePicker ? '正在打开本机文件选择器…' : '正在登记并检查本机文件…', (progress, signal) => (
    usePicker ? state.helperClient.pickFile() : state.helperClient.registerPath(path, signal)
  ));
  if (!registered) return;
  try { registerHelperResult(registered, slot); }
  catch (error) { setAlert('helperAlert', error?.message || String(error)); }
}

async function importHelperReport() {
  if (!state.helperFile || !helperReportType(state.helperFile)) { setAlert('helperAlert', '请先登记类型为 report 的 DIA-NN 主报告。'); return; }
  let options;
  try { options = helperImportOptions(); }
  catch (error) { setAlert('helperAlert', error?.message || String(error)); return; }
  clearLoadedData('正在通过本机分析助手导入报告…');
  const dataset = await runHelperTask('正在本机读取报告并应用筛选…', (progress, signal) => (
    state.helperClient.importFile(state.helperFile.id, options, progress, signal)
  ));
  if (!dataset) return;
  try {
    if (!Array.isArray(dataset.sampleIds) || !Array.isArray(dataset.featureIds) || !Array.isArray(dataset.values)) {
      throw new Error('本机分析助手未返回有效的数据矩阵。');
    }
    state.dataset = dataset;
    state.file = { name: state.helperFile.name, size: state.helperFile.bytes, helper: true };
    state.dataSource = 'helper';
    state.results = null;
    $('dataScale').value = dataset.scale || 'linear';
    $('upstreamConfirmed').checked = false;
    renderDatasetSummary(dataset, `本机报告：${state.helperFile.name}`);
    initializeDesign(dataset);
    setStatus('本机报告已就绪', 'ready');
    $('helperProgress').textContent = '报告导入完成；请检查样本、筛选记录与分组。';
    setAlert('dataAlert', '');
  } catch (error) {
    clearLoadedData();
    setAlert('helperAlert', error?.message || String(error));
    setStatus('导入失败', 'warning');
  }
}

function renderHelperRows(containerId, result, defaultNote = '') {
  const root = $(containerId);
  root.replaceChildren();
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const summary = document.createElement('p');
  const items = Object.entries(result && typeof result === 'object' ? result : {}).filter(([key]) => key !== 'rows').slice(0, 14);
  summary.textContent = items.map(([key, value]) => `${key}: ${plainText(value).replace(/\s+/g, ' ').slice(0, 240)}`).join(' · ') || defaultNote;
  root.append(summary);
  const note = result?.note || result?.scope || defaultNote;
  if (note) {
    const p = document.createElement('p'); p.className = 'audit-note'; p.textContent = String(note); root.append(p);
  }
  if (rows.length) {
    const displayed = rows.slice(0, 50);
    const columns = Object.keys(displayed[0]).slice(0, 14);
    const wrap = document.createElement('div'); wrap.className = 'table-wrap helper-table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('thead'); const headerRow = document.createElement('tr');
    for (const key of columns) { const th = document.createElement('th'); th.textContent = key; headerRow.append(th); }
    head.append(headerRow); table.append(head);
    const body = document.createElement('tbody');
    for (const row of displayed) {
      const tr = document.createElement('tr');
      for (const key of columns) { const td = document.createElement('td'); td.textContent = plainText(row[key]); tr.append(td); }
      body.append(tr);
    }
    table.append(body); wrap.append(table); root.append(wrap);
    if (rows.length > displayed.length || result?.truncated) {
      const p = document.createElement('p'); p.className = 'audit-note';
      p.textContent = `本机查询返回 ${rows.length.toLocaleString()} 行；页面仅显示前 ${displayed.length} 行。${result?.truncated ? '查询结果最多返回 2,000 行。' : ''}`;
      root.append(p);
    }
  }
  show(containerId, true);
}

async function queryHelperTarget() {
  const target = $('helperTarget').value.trim();
  if (!state.helperFile || !helperReportType(state.helperFile)) { setAlert('helperAlert', '请先登记类型为 report 的本机文件。'); return; }
  if (!target) { setAlert('helperAlert', '请输入蛋白组或基因 ID，再运行目标查询。'); return; }
  let filters;
  try { filters = buildFilters({ localHelper: true }); }
  catch (error) { setAlert('helperAlert', error?.message || String(error)); return; }
  const result = await runHelperTask('正在检查报告目标…', (progress, signal) => (
    state.helperClient.queryTarget(state.helperFile.id, target, { filters, limit: 50 }, progress, signal)
  ));
  if (result) renderHelperRows('helperTargetResult', result, '没有匹配行。');
}

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function renderHelperXic(result) {
  const root = $('helperXicResult'); root.replaceChildren();
  const traces = Array.isArray(result?.traces) ? result.traces : [];
  const usable = traces.map((trace) => ({ ...trace, points: (trace.points || []).filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) })).filter((trace) => trace.points.length);
  if (!usable.length) {
    const p = document.createElement('p'); p.textContent = '没有返回可绘制的 XIC 轨迹。'; root.append(p); show('helperXicResult', true); return;
  }
  const plotted = usable.slice(0, 20);
  const allPoints = plotted.flatMap((trace) => trace.points.slice(0, 3000).map((point) => [Number(point[0]), Number(point[1])]));
  let minX = Math.min(...allPoints.map((p) => p[0])); let maxX = Math.max(...allPoints.map((p) => p[0]));
  let minY = Math.min(...allPoints.map((p) => p[1])); let maxY = Math.max(...allPoints.map((p) => p[1]));
  if (minX === maxX) maxX = minX + 1; if (minY === maxY) maxY = minY + 1;
  const svg = svgElement('svg', { viewBox: '0 0 860 360', role: 'img', 'aria-label': '本机 XIC 轨迹' });
  svg.append(svgElement('line', { x1: 62, y1: 300, x2: 830, y2: 300, stroke: '#718785', 'stroke-width': 1 }));
  svg.append(svgElement('line', { x1: 62, y1: 36, x2: 62, y2: 300, stroke: '#718785', 'stroke-width': 1 }));
  const xMap = (x) => 62 + ((x - minX) / (maxX - minX)) * 768;
  const yMap = (y) => 300 - ((y - minY) / (maxY - minY)) * 264;
  const colors = ['#087e78', '#c95744', '#4779a8', '#91631c', '#7856a6', '#30916c', '#b4497a', '#566c7f'];
  plotted.forEach((trace, index) => {
    const points = trace.points.slice(0, 3000);
    const d = points.map((point, i) => `${i ? 'L' : 'M'}${xMap(Number(point[0])).toFixed(2)},${yMap(Number(point[1])).toFixed(2)}`).join(' ');
    svg.append(svgElement('path', { d, fill: 'none', stroke: colors[index % colors.length], 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
  });
  const label = (text, x, y, anchor = 'middle') => {
    const node = svgElement('text', { x, y, 'text-anchor': anchor, fill: '#486867', 'font-size': 12 }); node.textContent = text; svg.append(node);
  };
  label(String(minX), 62, 320, 'start'); label(String(maxX), 830, 320, 'end');
  label(String(maxY), 54, 42, 'end'); label(String(minY), 54, 300, 'end');
  label('RT（原始单位）', 446, 345); label('强度', 18, 24, 'start');
  const legend = document.createElement('p'); legend.className = 'helper-xic-legend';
  legend.textContent = `轨迹：${plotted.map((trace) => trace.feature || '未命名').join(' · ')}${usable.length > plotted.length ? ` · 另有 ${usable.length - plotted.length} 条未绘制` : ''}`;
  const summary = document.createElement('p');
  summary.textContent = `${result.precursor || ''} · ${usable.length} 条轨迹 · RT 单位不作推断。`;
  root.append(summary, svg, legend); show('helperXicResult', true);
}

async function queryHelperXic() {
  const precursor = $('helperPrecursor').value.trim();
  if (!state.helperFile || !helperXicType(state.helperFile)) { setAlert('helperAlert', '请先登记类型为 xic 的本机文件。'); return; }
  if (!precursor) { setAlert('helperAlert', '请输入精确 precursor ID。'); return; }
  const result = await runHelperTask('正在提取 XIC…', (progress, signal) => (
    state.helperClient.extractXic(state.helperFile.id, precursor, 1500, progress, signal)
  ));
  if (result) renderHelperXic(result);
}

async function compareHelperReports() {
  if (!helperReportType(state.helperFile) || !helperReportType(state.helperCompareFile)) {
    setAlert('helperAlert', '覆盖比较需要先登记两份类型为 report 的 DIA-NN 主报告。'); return;
  }
  const result = await runHelperTask('正在比较两份报告的 Run 覆盖…', (progress, signal) => (
    state.helperClient.runJobRequest({ action: 'compare', fileId: state.helperFile.id, otherFileId: state.helperCompareFile.id }, progress, signal)
  ));
  if (result) renderHelperRows('helperCompareResult', result, '没有可比较的 Run。');
}

function renderSequenceEvidence(result) {
  const root = $('helperSequenceResult');
  root.replaceChildren();
  if (!result || typeof result !== 'object') {
    const message = document.createElement('p'); message.textContent = '本机分析助手未返回序列核对结果。'; root.append(message); show('helperSequenceResult', true); return;
  }
  const title = document.createElement('strong');
  title.textContent = `${String(result.proteinId || '目标蛋白')} · ${Number(result.length || 0).toLocaleString()} aa`;
  const summary = document.createElement('p');
  const coverage = Number(result.coverage);
  summary.textContent = `覆盖 ${Number(result.coveredResidues || 0).toLocaleString()} 个残基${Number.isFinite(coverage) ? `（${formatNumber(coverage * 100, 1)}%）` : ''} · ${Number(result.matchingProteinRecords || 1).toLocaleString()} 条匹配记录`;
  root.append(title, summary);
  if (result.ambiguous) {
    const note = document.createElement('p'); note.className = 'audit-note';
    note.textContent = typeof result.ambiguous === 'string' ? result.ambiguous : '匹配到多条记录；请核对返回的蛋白 ID 与序列。'; root.append(note);
  }
  if (typeof result.sequence === 'string' && result.sequence) {
    const sequence = document.createElement('pre'); sequence.className = 'helper-sequence'; sequence.textContent = result.sequence; root.append(sequence);
  }
  if (Array.isArray(result.peptides) && result.peptides.length) {
    const rows = result.peptides.map((item) => ({
      peptide: String(item?.peptide ?? ''),
      starts: Array.isArray(item?.starts) ? item.starts.map((value) => Number(value)).filter(Number.isFinite) : [],
    }));
    const wrapper = document.createElement('div'); wrapper.className = 'table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('thead'); const headerRow = document.createElement('tr');
    for (const label of ['肽段', '序列起始位置']) { const th = document.createElement('th'); th.textContent = label; headerRow.append(th); }
    head.append(headerRow); table.append(head);
    const body = document.createElement('tbody');
    for (const item of rows) {
      const row = document.createElement('tr');
      const peptideCell = document.createElement('td'); peptideCell.textContent = item.peptide;
      const startsCell = document.createElement('td'); startsCell.textContent = item.starts.length ? item.starts.join(', ') : '未匹配';
      row.append(peptideCell, startsCell); body.append(row);
    }
    table.append(body); wrapper.append(table); root.append(wrapper);
  }
  show('helperSequenceResult', true);
}

async function queryHelperSequence() {
  const proteinId = $('helperProteinId').value.trim();
  if (!state.helperFastaFile || state.helperFastaFile.type !== 'fasta') { setAlert('helperAlert', '请先登记 FASTA 文件。'); return; }
  if (!proteinId) { setAlert('helperAlert', '请输入精确蛋白 ID。'); return; }
  const peptides = $('helperPeptides').value.split(/[\r\n,;]+/).map((value) => value.trim()).filter(Boolean);
  const result = await runHelperTask('正在核对 FASTA 序列…', (progress, signal) => (
    state.helperClient.runJobRequest({ action: 'sequence', fileId: state.helperFastaFile.id, proteinId, peptides }, progress, signal)
  ));
  if (result) renderSequenceEvidence(result);
}

async function cancelHelperTask() {
  state.helperController?.abort();
}

async function loadSelectedFile() {
  const file = $('dataFile').files?.[0];
  if (!file) { setAlert('dataAlert', '请选择 CSV、TSV、TXT 或 Parquet 文件。'); return; }
  if (hasHelperOnlyImportSettings()) { setAlert('dataAlert', '当前已设置本机报告专用列、过滤或重复行规则；请登记本机 DIA-NN 报告后再导入，避免设置被忽略。'); return; }
  let filters;
  try { filters = buildFilters(); }
  catch (error) { setAlert('dataAlert', error?.message || String(error)); return; }
  setAlert('dataAlert', '');
  clearLoadedData('正在导入所选文件…');
  $('loadButton').disabled = true;
  $('demoButton').disabled = true;
  for (const id of ['dataMode', 'dataScale', 'dataFile', 'expressionUnit', 'filterQValue', 'filterGlobalQValue', 'filterPgQValue', 'filterGlobalPgQValue', 'minimumPeptides', 'peptideScope', 'contaminantText']) $(id).disabled = true;
  $('loadProgress').textContent = '正在本机读取文件…';
  setStatus('正在导入');
  try {
    const dataset = await importFile(file, { mode: activeMode(), scale: activeScale(), filters }, onImportProgress);
    if (!dataset || !Array.isArray(dataset.sampleIds) || !Array.isArray(dataset.featureIds) || !Array.isArray(dataset.values)) {
      throw new Error('导入器未返回有效的 feature × sample 数据矩阵。');
    }
    if (activeMode() === 'expression') {
      dataset.metadata = { ...(dataset.metadata || {}), expressionUnit: $('expressionUnit').value };
    }
    state.dataset = dataset;
    state.file = file;
    state.dataSource = 'browser';
    state.results = null;
    $('upstreamConfirmed').checked = false;
    renderDatasetSummary(dataset, file.name);
    initializeDesign(dataset);
    setStatus('数据已就绪', 'ready');
    $('loadProgress').textContent = '导入完成；请检查尺度、样本设计与筛选规则。';
  } catch (error) {
    clearLoadedData();
    setAlert('dataAlert', error?.message || String(error));
    $('loadProgress').textContent = '导入未完成。';
    setStatus('导入失败', 'warning');
  } finally {
    $('loadButton').disabled = false;
    $('demoButton').disabled = false;
    for (const id of ['dataMode', 'dataScale', 'dataFile', 'expressionUnit', 'filterQValue', 'filterGlobalQValue', 'filterPgQValue', 'filterGlobalPgQValue', 'minimumPeptides', 'peptideScope', 'contaminantText']) $(id).disabled = false;
  }
}

function loadDemo() {
  clearLoadedData('正在载入合成示例…');
  setAlert('dataAlert', '');
  try {
    if (typeof core.makeDemo !== 'function') throw new Error('合成示例数据暂不可用。');
    const dataset = core.makeDemo(activeMode());
    if (!dataset || !Array.isArray(dataset.sampleIds) || !Array.isArray(dataset.featureIds) || !Array.isArray(dataset.values)) {
      throw new Error('合成示例未返回有效的数据矩阵。');
    }
    state.dataset = dataset;
    state.file = null;
    state.dataSource = 'demo';
    state.results = null;
    $('upstreamConfirmed').checked = false;
    if (dataset.scale) $('dataScale').value = dataset.scale;
    renderDatasetSummary(dataset, '本地合成数据');
    initializeDesign(dataset);
    setStatus('示例已就绪', 'ready');
    $('loadProgress').textContent = '示例由程序生成，仅用于检查工作流，不代表真实实验结果。';
  } catch (error) {
    setAlert('dataAlert', error?.message || String(error));
  }
}

function currentRunOptions() {
  const mode = activeMode();
  const exploration = mode === 'expression';
  const alpha = Number($('analysisAlpha').value);
  const lfcThreshold = Number($('analysisLfc').value);
  const minimumObservedRaw = $('minimumObserved').value.trim();
  const minimumObserved = Number(minimumObservedRaw);
  const seedRaw = $('seed').value.trim();
  const seed = Number(seedRaw);
  if (!exploration && (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1)) throw new Error('FDR 分析阈值须大于 0 且不超过 1。');
  if (!exploration && (!Number.isFinite(lfcThreshold) || lfcThreshold < 0)) throw new Error('|log2FC| 分析阈值须为大于或等于 0 的数。');
  if (!Number.isInteger(minimumObserved) || minimumObserved < 1) throw new Error('最低观测样本数须为正整数。');
  if (!seedRaw || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw new Error('随机种子须为 0 至 2147483647 的整数。');
  const normalization = mode === 'proteomics' ? $('normalization').value : 'none';
  const imputation = mode === 'proteomics' ? $('imputation').value : 'none';
  return {
    mode,
    scale: activeScale(),
    caseGroup: $('caseGroup').value,
    controlGroup: $('controlGroup').value,
    alpha: exploration ? .05 : alpha,
    lfcThreshold: exploration ? 0 : lfcThreshold,
    technicalAggregation: $('technicalAggregation').value,
    minimumObserved,
    statisticalMethod: mode === 'proteomics' ? $('statisticalMethod').value : 'limma',
    pAdjust: exploration ? 'BH' : $('pAdjust').value,
    normalization,
    medianNormalize: normalization === 'median',
    imputation,
    imputationScope: $('imputationScope').value,
    seed,
    upstreamNormalizationConfirmed: $('upstreamConfirmed').checked,
    filters: buildFilters({ localHelper: state.dataSource === 'helper' }),
    signal: state.controller?.signal,
  };
}

function runProgress(value) {
  const progress = normalizeProgress(value);
  $('runProgress').textContent = progress.message;
  show('progressTrack', true);
  $('progressBar').style.width = progress.progress == null ? '18%' : `${progress.progress}%`;
}

async function run() {
  if (!state.dataset) return;
  syncDesignFromDom();
  const validation = designValidationMessage(state.dataset, state.design);
  if (validation) { setAlert('runAlert', validation); return; }
  let options;
  try { options = currentRunOptions(); }
  catch (error) { setAlert('runAlert', error?.message || String(error)); return; }
  setAlert('runAlert', '');
  setAlert('resultAlert', '');
  state.results = null;
  state.controller = new AbortController();
  options.signal = state.controller.signal;
  state.analysisOptions = { ...options, signal: undefined };
  state.running = true;
  show('results-stage', false);
  show('cancelButton', true);
  $('runButton').disabled = true;
  $('cancelButton').disabled = false;
  $('progressBar').style.width = '5%';
  show('progressTrack', true);
  runProgress('准备运行分析…');
  try {
    const results = await runAnalysis(state.dataset, state.design, options, runProgress);
    if (state.controller.signal.aborted) throw new DOMException('分析已取消。', 'AbortError');
    if (!results || !Array.isArray(results.differential)) throw new Error('分析未返回差异结果表。');
    state.results = results;
    $('progressBar').style.width = '100%';
    $('runProgress').textContent = activeMode() === 'expression'
      ? '分析完成。请检查样本 QC、表达模式图和方法记录。'
      : '分析完成。请检查 QC、差异结果和方法记录。';
    show('results-stage', true);
    $('enrichButton').disabled = activeMode() === 'expression';
    renderResults();
    $('results-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (state.controller.signal.aborted || error?.name === 'AbortError') {
      $('runProgress').textContent = '分析已取消；可以修改设计后重新运行。';
      setAlert('runAlert', '分析已取消。');
    } else {
      $('runProgress').textContent = '分析未完成。';
      setAlert('runAlert', error?.message || String(error));
    }
  } finally {
    state.running = false;
    state.controller = null;
    show('cancelButton', false);
    show('progressTrack', false);
    updateRunButton();
    $('enrichButton').disabled = !state.results || state.enrichBusy || activeMode() === 'expression';
  }
}

function cancelRun() { state.controller?.abort(); }

function resultSamples() {
  return Array.isArray(state.results?.sampleIds) ? state.results.sampleIds : (state.dataset?.sampleIds || []);
}

function metricArray(value, samples) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return samples.map((sample) => value[sample]);
  return [];
}

function designGroupBySample() {
  const groups = new Map();
  for (const item of state.design) {
    if (!item.exclude) {
      groups.set(String(item.run), item.group);
      groups.set(String(item.sample), item.group);
    }
  }
  return groups;
}

function renderQcTable() {
  const samples = resultSamples();
  const qc = state.results.qc || {};
  const counts = metricArray(qc.counts, samples);
  const missing = metricArray(qc.missing, samples);
  const medians = metricArray(qc.medians, samples);
  const technicalCV = Array.isArray(state.results.technicalCV) ? state.results.technicalCV : [];
  const cvMedians = samples.map((_, sampleIndex) => {
    const values = technicalCV.map((row) => row?.[sampleIndex]).filter((value) => value != null && Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
  const groups = designGroupBySample();
  const body = $('qcRows'); body.replaceChildren();
  samples.forEach((sample, i) => {
    const row = document.createElement('tr');
    const values = [sample, groups.get(String(sample)) || '—', formatNumber(counts[i], 0), (Number.isFinite(missing[i]) ? formatNumber(missing[i] * 100, 1) + '%' : '—'), formatNumber(medians[i], 4), Number.isFinite(cvMedians[i]) ? `${formatNumber(cvMedians[i] * 100, 1)}%` : '—'];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    body.append(row);
  });
}

function analysisAuditText(audit = {}, exploration = false, options = {}) {
  const lines = [];
  const resultMode = options.mode || audit.mode;
  const technicalAggregation = resultMode === 'counts' ? (audit.technicalAggregation || options.technicalAggregation) : (options.technicalAggregation || audit.technicalAggregation);
  if (technicalAggregation) {
    const aggregation = technicalAggregation === 'sum raw counts'
      ? '原始 counts 求和'
      : technicalAggregation === 'mean' || technicalAggregation === 'arithmetic mean on linear scale before log2'
        ? '在线性尺度取算术均值'
        : technicalAggregation === 'median' || technicalAggregation === 'median on linear scale before log2'
          ? '在线性尺度取中位数'
          : String(technicalAggregation);
    lines.push(`技术重复合并：${aggregation}`);
  }
  const normalization = options.normalization ?? audit.normalization ?? (typeof options.medianNormalize === 'boolean' ? (options.medianNormalize ? 'median' : 'none') : null);
  if (normalization != null) {
    const labels = { none: '未额外归一化', median: '中位数归一化', quantile: '分位数归一化' };
    lines.push(`额外归一化：${labels[normalization] || normalization}`);
  } else if (typeof audit.extraNormalization === 'boolean') {
    lines.push(`额外中位数归一化：${audit.extraNormalization ? '已应用' : '未应用'}`);
  }
  const imputation = options.imputation ?? audit.imputation;
  if (imputation) {
    lines.push(`缺失值处理：${imputation === 'none' ? '不插补' : imputation}`);
    const scopes = { visualization: '仅用于可视化', model: '用于统计模型', both: '用于可视化与统计模型' };
    const imputationScope = options.imputationScope ?? audit.imputationScope;
    if (imputation !== 'none' && imputationScope) lines.push(`插补用途：${scopes[imputationScope] || imputationScope}`);
  }
  const statisticalMethod = resultMode === 'counts' ? 'edgeR' : (options.statisticalMethod ?? audit.statisticalMethod);
  const methodLabels = { limma: 'limma', welch: 'Welch t 检验', edgeR: 'edgeR（RNA counts）' };
  if (!exploration && statisticalMethod) lines.push(`统计方法：${methodLabels[statisticalMethod] || statisticalMethod}`);
  if (Number.isFinite(Number(audit.pcaFeatureCount))) lines.push(`PCA 使用特征数：${Number(audit.pcaFeatureCount).toLocaleString()}`);
  if (!exploration && Number.isFinite(Number(audit.testedFeatures))) lines.push(`进入差异检验的特征数：${Number(audit.testedFeatures).toLocaleString()}`);
  if (!exploration) {
    const pAdjustLabels = { BH: 'Benjamini–Hochberg（BH）', BY: 'Benjamini–Yekutieli（BY）' };
    const pAdjust = options.pAdjust ?? audit.pAdjust;
    const family = String(audit.testFamily || '');
    const adjustment = pAdjust
      ? (pAdjustLabels[pAdjust] || pAdjust)
      : /^BY\b/.test(family)
        ? pAdjustLabels.BY
        : /^(BH|Benjamini.Hochberg)\b/.test(family)
          ? pAdjustLabels.BH
          : audit.testFamily;
    if (adjustment) lines.push(`多重检验校正：${adjustment}`);
  }
  if (!exploration && audit.effectDirection) lines.push(`效应方向：${audit.effectDirection}`);
  if (audit.technicalCVDefinition) lines.push(`技术重复 CV 汇总：每个样本对至少有两个有效技术重复的特征计算 CV 后取中位数。${audit.technicalCVDefinition}`);
  return lines.length ? lines.join('\n') : plainText(audit);
}

function methodSummary() {
  const results = state.results || {};
  const parts = [];
  const inputAudit = state.dataset?.audit;
  if (inputAudit) {
    const sourceRows = inputAudit.sourceRows;
    const retainedRows = inputAudit.retainedRows;
    const rowLabel = sourceRows == null ? '' : `来源行 ${Number(sourceRows).toLocaleString()}`;
    const retainedLabel = retainedRows == null ? '' : `保留行 ${Number(retainedRows).toLocaleString()}`;
    const filterLabel = typeof inputAudit.precursorFiltersApplied === 'boolean' ? `上游前体过滤${inputAudit.precursorFiltersApplied ? '已应用' : '未应用'}` : '';
    const summary = [rowLabel, retainedLabel, filterLabel].filter(Boolean).join('；');
    if (summary) parts.push(`输入行记录\n${summary}`);
    if (Array.isArray(inputAudit.stages)) {
      for (const stage of inputAudit.stages) parts.push(`导入步骤：${auditStepLabel(stage.step)}；输入 ${stage.input_rows ?? '—'} 行，排除 ${stage.removed_rows ?? '—'} 行，保留 ${stage.output_rows ?? '—'} 行`);
    }
    if (Array.isArray(inputAudit.runCounts)) {
      for (const run of inputAudit.runCounts) parts.push(`Run 记录：${run.run ?? '—'}；输入 ${run.input_rows ?? '—'} 行，筛选后 ${run.output_rows ?? '—'} 行，保留 ${run.groups ?? '—'} 个蛋白组`);
    }
    if (inputAudit.notes) parts.push(`导入说明\n${plainText(inputAudit.notes)}`);
  }
  if (results.method) parts.push(`方法\n${plainText(results.method)}`);
  if (results.versions) parts.push(`软件版本\n${plainText(results.versions)}`);
  const options = results.options || state.analysisOptions;
  if (results.audit) parts.push(`分析记录\n${analysisAuditText(results.audit, activeMode() === 'expression', options || {})}`);
  if (results.enrichmentAudit) parts.push(`富集审计\n${plainText(results.enrichmentAudit)}`);
  if (!parts.length) parts.push('分析结果未提供方法或版本说明。');
  if (options) {
    if (options.mode !== 'expression') parts.push(`比较：${options.caseGroup} vs ${options.controlGroup} · FDR ${options.alpha} · |log2FC| ${options.lfcThreshold}`);
    const modeLabel = options.mode === 'proteomics' ? 'LFQ 蛋白组' : options.mode === 'counts' ? 'RNA counts' : 'TPM/FPKM 表达探索';
    parts.push(`输入模式与尺度：${modeLabel} · ${options.scale}\n输入筛选：${plainText(options.filters)}`);
  }
  if (state.dataset?.mode === 'expression' && state.dataset?.metadata?.expressionUnit) parts.push(`输入表达量单位：${state.dataset.metadata.expressionUnit}`);
  return parts.join('\n\n');
}

function updateAtlasLink() {
  const link = $('atlasLink');
  const species = $('atlasSpecies').value;
  const exactId = String(state.selectedFeature ?? '').trim();
  const resultFeatures = Array.isArray(state.results?.featureIds) ? state.results.featureIds : [];
  const knownFeatures = resultFeatures.length ? resultFeatures.map(String) : differentialRecords().map(featureId);
  const exactFeatureSelected = Boolean(exactId && knownFeatures.includes(exactId));
  const ready = Boolean(species && exactFeatureSelected);
  link.removeAttribute('href');
  link.setAttribute('aria-disabled', String(!ready));
  link.tabIndex = ready ? 0 : -1;
  $('atlasPreviewLabel').textContent = '公开参考快照';
  if (!ready) {
    $('atlasLinkNote').textContent = !species
      ? '请选择注释物种，并从当前结果中选择完整目标 ID。ID 按原样传递，分号连接的 ID 不会拆分。'
      : '请从当前结果中选择完整目标 ID。ID 按原样传递，分号连接的 ID 不会拆分。';
    return;
  }
  const target = species === 'worm' ? 'mouse' : 'worm';
  const base = 'https://heshuaihan.github.io/ExperiTome/atlas/';
  link.href = `${base}#species=${encodeURIComponent(species)}&target=${target}&query=${encodeURIComponent(exactId)}`;
  $('atlasLinkNote').textContent = '打开公开 ExperiAtlas 注释页，并传入所选物种和完整目标 ID；分号连接的 ID 会作为单个目标传递。';
}

function currentView() {
  return { metric: $('viewMetric').value, threshold: Number($('viewThreshold').value), lfcThreshold: Number(state.analysisOptions?.lfcThreshold) || 0, target: state.selectedFeature };
}

function renderCharts() {
  if (!state.results) return;
  const exploration = activeMode() === 'expression';
  show('volcanoPanel', !exploration);
  show('maPanel', !exploration);
  show('viewMetricWrap', !exploration);
  show('viewThresholdWrap', !exploration);
  show('onlyAboveThresholdWrap', !exploration);
  show('diffLogFCHead', !exploration);
  show('diffPValueHead', !exploration);
  show('diffFdrHead', !exploration);
  show('diffCaseNHead', !exploration);
  show('diffControlNHead', !exploration);
  const featureLabel = activeMode() === 'proteomics' ? '蛋白组 ID' : '基因 ID';
  $('diffFeatureHead').textContent = featureLabel;
  $('targetFeatureLabel').textContent = `查找${activeMode() === 'proteomics' ? '蛋白组' : '基因'}`;
  $('tableSearchLabel').textContent = '搜索结果表';
  $('tableSearch').placeholder = `按${activeMode() === 'proteomics' ? '蛋白组' : '基因'} ID 搜索`;
  $('onlyAboveThresholdLabel').textContent = `结果表仅显示达到查看阈值的${activeMode() === 'proteomics' ? '蛋白组' : '基因'}`;
  $('diffStatusHead').textContent = exploration ? '分析说明' : '状态';
  $('diffKicker').textContent = exploration ? '表达探索' : '差异分析';
  $('diff-heading').textContent = exploration ? '表达模式与目标基因' : `比较与目标${activeMode() === 'proteomics' ? '蛋白组' : '基因'}`;
  $('results-heading').textContent = exploration ? '质量检查与表达探索' : '质量检查与差异结果';
  $('heatmapCaption').textContent = exploration ? 'TPM/FPKM 基因表达模式热图 · 最多 40 个' : activeMode() === 'proteomics' ? '差异蛋白组热图 · 最多 40 个' : '差异基因热图 · 最多 40 个';
  $('heatmapHelp').textContent = exploration
    ? '按行标准化后的 TPM/FPKM 表达模式图，仅用于颜色展示；不表示差异检验结果；灰色单元格表示缺失。'
    : '热图按 feature 行标准化后显示相对模式，仅用于颜色展示；灰色单元格表示缺失。';
  show('enrichmentResultsBlock', !exploration && Boolean(state.results.enrichment?.length));
  $('enrichButton').disabled = exploration || !state.results?.differential?.length || state.enrichBusy;
  const samples = resultSamples();
  const qc = state.results.qc || {};
  const view = currentView();
  const selectFeature = (id) => {
    if (!id) return;
    state.selectedFeature = id;
    $('targetFeature').value = id;
    renderCharts();
    renderDifferentialTable();
  };
  drawCorrelation($('correlationChart'), samples, qc.correlation);
  drawPca($('pcaChart'), qc.pca, samples, state.design);
  drawDistributions($('distributionChart'), samples, qc.distributions, state.design);
  if (!exploration) {
    drawVolcano($('volcanoChart'), state.results.differential, { ...view, onSelect: selectFeature });
    drawMA($('maChart'), state.results, { ...view, onSelect: selectFeature });
  }
  drawHeatmap($('heatmapChart'), state.results, state.design, { ...view, mode: activeMode(), onSelect: selectFeature });
  renderTargetSummary();
  updateAtlasLink();
}

function renderTargetSummary() {
  const id = state.selectedFeature.trim();
  const container = $('targetSummary');
  container.replaceChildren();
  if (!id || !state.results) { show('targetSummary', false); return; }
  const diff = (state.results.differential || []).find((row) => featureId(row) === id);
  const ids = Array.isArray(state.results.featureIds) ? state.results.featureIds : [];
  const matrixIndex = ids.findIndex((feature) => String(feature) === id);
  const matrixRow = matrixIndex >= 0 && Array.isArray(state.results.matrix?.[matrixIndex]) ? state.results.matrix[matrixIndex] : null;
  const title = document.createElement('h4');
  title.textContent = `目标${activeMode() === 'proteomics' ? '蛋白组' : '基因'} · ${id}`;
  container.append(title);
  const note = document.createElement('p');
  note.className = 'field-help';
  const exploration = activeMode() === 'expression';
  note.textContent = exploration
    ? 'TPM/FPKM 表达探索；不计算差异 P 值或 FDR。下表显示各样本的分析矩阵值。'
    : diff ? '差异统计与各样本矩阵值。矩阵值采用分析结果给出的尺度。' : matrixRow ? '该条目有矩阵值，但差异表中没有对应记录。' : '当前结果中未找到该条目。';
  container.append(note);
  if (diff && !exploration) {
    const chips = [
      `log2FC：${formatNumber(diff.logFC ?? diff.log2FC, 5)}`,
      `P value：${formatNumber(diff.PValue ?? diff.pValue ?? diff.pvalue, 5)}`,
      `FDR：${formatNumber(diff.FDR ?? diff.fdr ?? diff.adjPValue, 5)}`,
      `状态：${diff.status ?? '—'}`,
      `Case n：${formatNumber(diff.nCase, 0)}`,
      `Control n：${formatNumber(diff.nControl, 0)}`,
    ];
    for (const value of chips) { const chip = document.createElement('span'); chip.className = 'summary-chip'; chip.textContent = value; container.append(chip); }
  }
  if (matrixRow) {
    const samples = resultSamples();
    const groups = designGroupBySample();
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = document.createElement('thead'); const headRow = document.createElement('tr');
    for (const label of ['样本', '组别', '分析矩阵值']) { const th = document.createElement('th'); th.textContent = label; headRow.append(th); }
    head.append(headRow); table.append(head);
    const body = document.createElement('tbody');
    samples.forEach((sample, index) => {
      const row = document.createElement('tr');
      for (const value of [sample, groups.get(String(sample)) || '—', formatNumber(matrixRow[index], 5)]) { const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell); }
      body.append(row);
    });
    table.append(body); wrap.append(table); container.append(wrap);
  }
  show('targetSummary', true);
}

function featureId(row) { return String(row.id ?? row.featureId ?? ''); }
function significanceValue(row, metric) {
  const raw = metric === 'PValue' ? row.PValue ?? row.pValue ?? row.pvalue : row.FDR ?? row.fdr ?? row.adjPValue;
  if (raw == null || raw === '') return null;
  return Number.isFinite(Number(raw)) ? Number(raw) : null;
}
function renderDifferentialTable() {
  if (!state.results) return;
  const exploration = activeMode() === 'expression';
  document.querySelector('.result-table').classList.toggle('is-exploration', exploration);
  const rows = Array.isArray(state.results.differential) ? state.results.differential : [];
  const metric = $('viewMetric').value;
  const threshold = Number($('viewThreshold').value);
  const search = $('tableSearch').value.trim().toLowerCase();
  const onlyAbove = !exploration && $('onlyAboveThreshold').checked;
  const matches = rows.filter((row) => {
    const id = featureId(row);
    const matchesSearch = !search || id.toLowerCase().includes(search);
    const value = significanceValue(row, metric);
    const above = value != null && value <= threshold;
    return matchesSearch && (!onlyAbove || above);
  });
  const shown = matches.slice(0, 1000);
  const body = $('differentialRows'); body.replaceChildren();
  for (const item of shown) {
    const id = featureId(item);
    const row = document.createElement('tr');
    if (id === state.selectedFeature) row.classList.add('is-target');
    const idCell = document.createElement('td');
    const targetButton = document.createElement('button');
    targetButton.type = 'button'; targetButton.className = 'feature-button'; targetButton.textContent = id;
    targetButton.addEventListener('click', () => { state.selectedFeature = id; $('targetFeature').value = id; renderCharts(); renderDifferentialTable(); updateAtlasLink(); });
    idCell.append(targetButton); row.append(idCell);
    const values = [
      formatNumber(item.logFC ?? item.log2FC, 4),
      formatNumber(item.PValue ?? item.pValue ?? item.pvalue, 5),
      formatNumber(item.FDR ?? item.fdr ?? item.adjPValue, 5),
      exploration ? '仅表达探索；未运行差异检验' : item.status ?? '—',
      formatNumber(item.nCase, 0),
      formatNumber(item.nControl, 0),
    ];
    for (let index = 0; index < values.length; index += 1) {
      const cell = document.createElement('td'); cell.textContent = String(values[index]);
      if (exploration && [0, 1, 2, 4, 5].includes(index)) cell.classList.add('hidden');
      row.append(cell);
    }
    body.append(row);
  }
  const tableCap = matches.length > shown.length ? '；表格最多显示 1,000 行，缩小搜索可定位其余条目，下载文件包含完整结果' : '';
  const matchLabel = activeMode() === 'proteomics' ? '个蛋白组' : '个基因';
  $('tableCount').textContent = onlyAbove
    ? `显示 ${shown.length.toLocaleString()} / ${matches.length.toLocaleString()} ${matchLabel}（${metric} ≤ ${formatNumber(threshold, 4)}）${tableCap}`
    : `显示 ${shown.length.toLocaleString()} / ${matches.length.toLocaleString()} ${matchLabel}${tableCap}`;
  const ids = Array.isArray(state.results.featureIds) ? state.results.featureIds : rows.map(featureId);
  const datalist = $('featureOptions'); datalist.replaceChildren();
  for (const id of ids.slice(0, 3000)) { const option = document.createElement('option'); option.value = String(id); datalist.append(option); }
}

function renderEnrichment() {
  const expressionMode = activeMode() === 'expression';
  const enrichment = Array.isArray(state.results?.enrichment) ? state.results.enrichment : [];
  const ranked = state.results?.enrichmentAudit?.method === 'ranked' || enrichment.some((item) => item && typeof item === 'object' && ('NES' in item || 'leadingEdge' in item));
  $('enrichmentSetHead').textContent = ranked ? '基因集' : '集合';
  $('enrichmentDescriptionHead').textContent = ranked ? '大小' : '描述';
  $('enrichmentOverlapHead').textContent = ranked ? 'NES' : '命中数';
  $('enrichmentScoreHead').textContent = ranked ? 'P value' : '富集分数';
  show('enrichmentLeadingEdgeHead', ranked);
  const body = $('enrichmentRows'); body.replaceChildren();
  for (const item of enrichment) {
    const row = document.createElement('tr');
    const leading = Array.isArray(item.leadingEdge) ? `${item.leadingEdge.slice(0, 30).join(', ')}${item.leadingEdge.length > 30 ? ` …（另有 ${item.leadingEdge.length - 30}）` : ''}` : item.leadingEdge ?? '—';
    const values = ranked
      ? [item.name ?? item.id ?? item.pathway ?? '—', item.size ?? '—', item.NES ?? '—', item.PValue ?? item.pvalue ?? '—', item.FDR ?? item.fdr ?? item.padj ?? '—', leading]
      : [item.name ?? item.id ?? item.pathway ?? '—', item.description ?? '—', item.overlap ?? item.hitCount ?? item.n ?? '—', item.score ?? item.enrichmentScore ?? '—', item.FDR ?? item.fdr ?? item.padj ?? '—'];
    for (const value of values) { const cell = document.createElement('td'); cell.textContent = typeof value === 'number' ? formatNumber(value, 5) : String(value); row.append(cell); }
    body.append(row);
  }
  show('enrichmentResultsBlock', !expressionMode && enrichment.length > 0);
}

function warningMessage(value) {
  const source = typeof value === 'string' ? value : value?.message ?? value?.warning ?? value?.code ?? plainText(value);
  const message = String(source || '').trim();
  if (!message) return '';
  if (/fewer than 3|less than 3|<\s*3|replicates?/i.test(message) && !/[\u3400-\u9fff]/.test(message)) {
    return '每组不足三个生物重复，方差及效应估计可能不稳定。';
  }
  return /[\u3400-\u9fff]/.test(message) ? message : `分析提醒：${message}`;
}

function renderResultWarnings() {
  const container = $('resultWarnings');
  container.replaceChildren();
  const warnings = Array.isArray(state.results?.warnings) ? state.results.warnings : state.results?.warnings ? [state.results.warnings] : [];
  const messages = [...new Set(warnings.map(warningMessage).filter(Boolean))];
  if (!messages.length) { show('resultWarnings', false); return; }
  const heading = document.createElement('strong'); heading.textContent = '分析提醒'; container.append(heading);
  const list = document.createElement('ul');
  for (const message of messages) { const item = document.createElement('li'); item.textContent = message; list.append(item); }
  container.append(list);
  show('resultWarnings', true);
}

function renderResults() {
  const result = state.results;
  const tested = result?.audit?.testedFeatures ?? 0;
  $('resultOverview').textContent = `${result.sampleIds.length} 个生物样本 · ${result.featureIds.length.toLocaleString()} 个特征${result.mode === 'expression' ? ' · 仅表达探索' : ` · ${tested.toLocaleString()} 个有效检验`}。技术重复已按样本汇总，原始观测与插补标记随结果包保留。`;
  $('methodSummary').textContent = methodSummary();
  renderResultWarnings();
  renderQcTable();
  renderCharts();
  renderDifferentialTable();
  renderEnrichment();
  updateEnrichmentControls();
  updateAtlasLink();
}

async function readGmtFile() {
  const file = $('gmtFile').files?.[0];
  if (!file) return;
  $('enrichmentStatus').textContent = `读取 ${file.name}…`;
  try {
    $('gmtText').value = await file.text();
    $('enrichmentStatus').textContent = `已读取 ${file.name}；内容保留在本页。`;
  } catch (error) {
    $('enrichmentStatus').textContent = error?.message || String(error);
  }
}

async function enrich() {
  if (activeMode() === 'expression') { $('enrichmentStatus').textContent = 'TPM/FPKM 模式仅作表达探索，不能运行差异富集分析。'; return; }
  if (!state.results || !Array.isArray(state.results.differential)) return;
  if (typeof runEnrichment !== 'function') { $('enrichmentStatus').textContent = '当前分析版本未提供富集分析实现。'; return; }
  const gmtText = $('gmtText').value.trim();
  const method = $('enrichmentMethod').value;
  const minSize = Number($('enrichmentMinSize').value);
  const maxSize = Number($('enrichmentMaxSize').value);
  const seed = Number($('enrichmentSeed').value);
  if (method === 'ranked') {
    if (!state.helperClient.available || !state.helperClient.supports('enrichment')) {
      $('enrichmentStatus').textContent = '排序富集需要连接支持该方法的本机分析助手。';
      updateEnrichmentControls(); return;
    }
    if (!gmtText) { $('enrichmentStatus').textContent = '排序富集需要提供 GMT 基因集文件或粘贴 GMT 内容。'; return; }
    if (!Number.isInteger(minSize) || minSize < 5 || !Number.isInteger(maxSize) || maxSize < minSize || maxSize > 10000) {
      $('enrichmentStatus').textContent = '基因集大小需为整数：最小值至少 5，最大值不小于最小值且不超过 10,000。'; return;
    }
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) {
      $('enrichmentStatus').textContent = '随机种子须为 0 至 2147483647 的整数。'; return;
    }
  }
  const options = {
    method,
    species: $('enrichmentSpecies').value,
    gmtText,
    alpha: Number(state.analysisOptions?.alpha) || .05,
    lfcThreshold: Number(state.analysisOptions?.lfcThreshold) || 0,
    minSize, maxSize, seed,
  };
  state.enrichBusy = true;
  $('enrichButton').disabled = true;
  $('enrichmentStatus').textContent = method === 'ranked' ? '正在本机运行排序富集…' : '正在本地计算过度表示富集…';
  try {
    const updated = await runEnrichment(state.results, options, (value) => {
      $('enrichmentStatus').textContent = normalizeProgress(value).message;
    });
    if (updated) state.results = updated;
    renderEnrichment();
    $('methodSummary').textContent = methodSummary();
    const count = state.results?.enrichment?.length || 0;
    $('enrichmentStatus').textContent = `${method === 'ranked' ? '排序富集' : '过度表示富集'}完成；返回 ${count.toLocaleString()} 个集合。`;
  } catch (error) {
    $('enrichmentStatus').textContent = error?.message || String(error);
  } finally {
    state.enrichBusy = false;
    updateEnrichmentControls();
  }
}

function differentialRecords() {
  return Array.isArray(state.results?.differential) ? state.results.differential : [];
}
function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function serializeTable(rows, delimiter) {
  if (activeMode() === 'expression') {
    const columns = ['id', 'analysis_note'];
    const lines = [columns.map(csvCell).join(delimiter)];
    for (const row of rows) {
      const output = { id: row.id ?? row.featureId, analysis_note: '仅表达探索；未运行差异检验' };
      lines.push(columns.map((key) => csvCell(output[key])).join(delimiter));
    }
    return `\uFEFF${lines.join('\r\n')}`;
  }
  const columns = ['id', 'logFC', 'PValue', 'FDR', 'status', 'nCase', 'nControl'];
  const lines = [columns.map(csvCell).join(delimiter)];
  for (const row of rows) {
    const output = {
      id: row.id ?? row.featureId,
      logFC: row.logFC ?? row.log2FC,
      PValue: row.PValue ?? row.pValue ?? row.pvalue,
      FDR: row.FDR ?? row.fdr ?? row.adjPValue,
      status: row.status,
      nCase: row.nCase,
      nControl: row.nControl,
    };
    lines.push(columns.map((key) => csvCell(output[key])).join(delimiter));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function downloadTable(delimiter, extension, mime) {
  const content = serializeTable(differentialRecords(), delimiter);
  const stem = activeMode() === 'expression' ? 'expression_summary' : 'differential';
  saveBlob(new Blob([content], { type: `${mime};charset=utf-8` }), `experianalysis_${stem}.${extension}`);
}

function chartSvgMarkup(id) {
  const svg = $(CHART_IDS[id])?.querySelector('svg');
  if (!svg) throw new Error('此图当前没有可导出的 SVG。');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', svg.viewBox.baseVal.width);
  clone.setAttribute('height', svg.viewBox.baseVal.height);
  clone.removeAttribute('role');
  clone.querySelectorAll('[tabindex]').forEach((node) => node.removeAttribute('tabindex'));
  return new XMLSerializer().serializeToString(clone);
}

async function downloadChart(id, format) {
  try {
    const markup = chartSvgMarkup(id);
    if (format === 'svg') {
      saveBlob(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), `experianalysis_${id}.svg`);
      return;
    }
    const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
    const loadSvgImage = () => new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(blob);
        const timer = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error('图形转换超时，请重试或导出 SVG。')); }, 10000);
        image.onload = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); reject(new Error('无法将 SVG 转为 PNG。')); };
        image.src = url;
      });
    let bitmap;
    try { bitmap = 'createImageBitmap' in window ? await createImageBitmap(blob) : await loadSvgImage(); }
    catch { bitmap = await loadSvgImage(); }
    const vb = $(CHART_IDS[id]).querySelector('svg').viewBox.baseVal;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vb.width * 2); canvas.height = Math.ceil(vb.height * 2);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const png = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 导出失败。')), 'image/png'));
    saveBlob(png, `experianalysis_${id}.png`);
    setAlert('resultAlert', 'PNG 图形已生成。', true);
  } catch (error) {
    setAlert('resultAlert', error?.message || String(error));
  }
}

function reportHtml() {
  const exploration = activeMode() === 'expression';
  const method = escapeHtml(methodSummary());
  const chartIds = Object.keys(CHART_IDS).filter((id) => !exploration || !['volcano', 'ma'].includes(id));
  const chartLabels = { correlation: '样本相关性', pca: 'PCA', distributions: '样本分布', volcano: 'Volcano plot', ma: 'MA plot', heatmap: exploration ? 'TPM/FPKM 表达模式热图' : '差异 feature 热图' };
  const charts = chartIds.map((id) => {
    let markup = '';
    try { markup = chartSvgMarkup(id); } catch { /* This chart is unavailable for the current result. */ }
    return markup ? `<figure><figcaption>${escapeHtml(chartLabels[id] || id)}</figcaption>${markup}</figure>` : '';
  }).filter(Boolean).join('\n');
  const rows = differentialRecords().map((row) => exploration
    ? `<tr><td>${escapeHtml(featureId(row))}</td><td>仅表达探索；未运行差异检验</td></tr>`
    : `<tr><td>${escapeHtml(featureId(row))}</td><td>${escapeHtml(row.logFC ?? row.log2FC ?? '')}</td><td>${escapeHtml(row.PValue ?? row.pValue ?? '')}</td><td>${escapeHtml(row.FDR ?? row.fdr ?? '')}</td><td>${escapeHtml(row.status ?? '')}</td><td>${escapeHtml(row.nCase ?? '')}</td><td>${escapeHtml(row.nControl ?? '')}</td></tr>`).join('\n');
  const design = state.design.map((row) => `<tr><td>${escapeHtml(row.run)}</td><td>${escapeHtml(row.sample)}</td><td>${escapeHtml(row.group)}</td><td>${row.exclude ? '是' : '否'}</td></tr>`).join('\n');
  const qc = state.results?.qc || {};
  const samples = resultSamples();
  const counts = metricArray(qc.counts, samples);
  const missing = metricArray(qc.missing, samples);
  const medians = metricArray(qc.medians, samples);
  const technicalCV = Array.isArray(state.results?.technicalCV) ? state.results.technicalCV : [];
  const cvMedians = samples.map((_, sampleIndex) => {
    const values = technicalCV.map((row) => row?.[sampleIndex]).filter((value) => value != null && Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
    if (!values.length) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
  const groups = designGroupBySample();
  const qcRows = samples.map((sample, i) => `<tr><td>${escapeHtml(sample)}</td><td>${escapeHtml(groups.get(String(sample)) || '—')}</td><td>${escapeHtml(formatNumber(counts[i], 0))}</td><td>${escapeHtml((Number.isFinite(missing[i]) ? formatNumber(missing[i] * 100, 1) + '%' : '—'))}</td><td>${escapeHtml(formatNumber(medians[i], 4))}</td><td>${escapeHtml(Number.isFinite(cvMedians[i]) ? `${formatNumber(cvMedians[i] * 100, 1)}%` : '—')}</td></tr>`).join('\n');
  const enrichment = Array.isArray(state.results?.enrichment) ? state.results.enrichment : [];
  const rankedEnrichment = state.results?.enrichmentAudit?.method === 'ranked' || enrichment.some((item) => item && typeof item === 'object' && ('NES' in item || 'leadingEdge' in item));
  const enrichmentColumns = rankedEnrichment
    ? '<th>基因集</th><th>大小</th><th>NES</th><th>P value</th><th>FDR</th><th>Leading edge</th>'
    : '<th>集合</th><th>描述</th><th>命中数</th><th>分数</th><th>FDR</th>';
  const enrichmentRows = enrichment.map((item) => {
    const leading = Array.isArray(item.leadingEdge) ? item.leadingEdge.join(', ') : item.leadingEdge ?? '';
    const values = rankedEnrichment
      ? [item.name ?? item.id ?? item.pathway ?? '', item.size ?? '', item.NES ?? '', item.PValue ?? item.pvalue ?? '', item.FDR ?? item.fdr ?? item.padj ?? '', leading]
      : [item.name ?? item.id ?? item.pathway ?? '', item.description ?? '', item.overlap ?? item.hitCount ?? item.n ?? '', item.score ?? item.enrichmentScore ?? '', item.FDR ?? item.fdr ?? item.padj ?? ''];
    return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`;
  }).join('\n');
  const enrichmentReport = enrichmentRows && !exploration ? `<h2>富集结果</h2><table><thead><tr>${enrichmentColumns}</tr></thead><tbody>${enrichmentRows}</tbody></table>` : '';
  const warnings = (Array.isArray(state.results?.warnings) ? state.results.warnings : state.results?.warnings ? [state.results.warnings] : []).map(warningMessage).filter(Boolean);
  const warningReport = warnings.length ? `<h2>分析提醒</h2><ul>${[...new Set(warnings)].map((message) => `<li>${escapeHtml(message)}</li>`).join('')}</ul>` : '';
  const resultTableTitle = exploration ? '表达探索结果（完整表）' : '差异结果（完整表）';
  const resultColumns = exploration
    ? '<th>基因 ID</th><th>分析说明</th>'
    : '<th>蛋白组 / 基因 ID</th><th>log2FC</th><th>P value</th><th>FDR</th><th>状态</th><th>Case n</th><th>Control n</th>';
  const generated = new Date().toLocaleString();
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ExperiAnalysis 结果报告</title><style>
body{margin:28px auto;padding:0 20px;max-width:1180px;color:#173c3c;background:#fff;font:15px/1.55 Inter,"Segoe UI","Microsoft YaHei UI",sans-serif}h1{font-size:32px}h2{margin-top:34px;border-top:1px solid #d8e4e1;padding-top:18px}pre{white-space:pre-wrap;font:inherit;font-size:14px;background:#f5faf9;border-left:3px solid #087e78;padding:14px;color:#486867}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px 10px;border-bottom:1px solid #d8e4e1;text-align:left}th{background:#f5f9f8;position:sticky;top:0}.chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}figure{margin:0;padding:12px;border:1px solid #d8e4e1;border-radius:9px;overflow:auto}figure:last-child:nth-child(odd){grid-column:1/-1}figcaption{font-weight:700;margin-bottom:8px}svg{display:block;width:100%;height:auto;min-width:340px}small{color:#607b79}@media(max-width:700px){.chart-grid{grid-template-columns:1fr}}</style></head><body>
<p><a href="https://heshuaihan.github.io/ExperiTome/">ExperiAnalysis · by ExperiTome</a></p><h1>分析结果报告</h1><small>报告生成时间：${escapeHtml(generated)} · 本地处理 · 结果需结合实验设计与原始记录复核</small>
<h2>方法与审计</h2><pre>${method}</pre>${warningReport}<h2>样本设计</h2><table><thead><tr><th>输入 run</th><th>生物样本</th><th>组别</th><th>排除</th></tr></thead><tbody>${design}</tbody></table>
<h2>质量检查汇总</h2><table><thead><tr><th>样本</th><th>组别</th><th>检测特征数</th><th>缺失比例</th><th>中位数</th><th>技术重复 CV 中位数</th></tr></thead><tbody>${qcRows}</tbody></table><h2>${exploration ? '质量检查与表达模式图' : '质量检查与差异图表'}</h2><div class="chart-grid">${charts}</div><h2>${resultTableTitle}</h2><table><thead><tr>${resultColumns}</tr></thead><tbody>${rows}</tbody></table>
${enrichmentReport}
</body></html>`;
}

function downloadHtml() {
  saveBlob(new Blob([reportHtml()], { type: 'text/html;charset=utf-8' }), 'experianalysis_report.html');
}

async function downloadZip() {
  if (typeof core.makeResultZip !== 'function') { setAlert('resultAlert', '完整结果包导出功能暂不可用。'); return; }
  $('downloadZipButton').disabled = true;
  $('downloadZipButton').textContent = '正在打包…';
  try {
    const blob = await core.makeResultZip(state.results, state.dataset, state.design, state.analysisOptions || {});
    if (!(blob instanceof Blob)) throw new Error('结果打包器未返回可下载文件。');
    saveBlob(blob, 'experianalysis_results.zip');
    setAlert('resultAlert', '完整结果包已生成。', true);
  } catch (error) {
    setAlert('resultAlert', error?.message || String(error));
  } finally {
    $('downloadZipButton').disabled = false;
    $('downloadZipButton').textContent = '下载完整结果包';
  }
}

function updateView() {
  const value = Number($('viewThreshold').value);
  $('viewThresholdLabel').textContent = `≤ ${value.toFixed(value < .01 ? 4 : 3)}`;
  renderCharts();
  renderDifferentialTable();
}

function bindEvents() {
  $('dataMode').addEventListener('change', updateModeControls);
  $('dataScale').addEventListener('change', () => { if (state.dataset) clearLoadedData('矩阵尺度已更改，请重新导入。'); });
  $('expressionUnit').addEventListener('change', () => { if (state.dataset) clearLoadedData('表达量单位已更改，请重新导入。'); });
  $('dataFile').addEventListener('change', () => { if (state.dataset) clearLoadedData('所选文件已更改，请重新导入。'); });
  for (const id of ['filterQValue', 'filterGlobalQValue', 'filterPgQValue', 'filterGlobalPgQValue', 'minimumPeptides', 'peptideScope', 'contaminantText', 'filterLibPeptidoformQValue', 'filterQuantityQuality', 'filterPgMaxLfqQuality', 'requireProteotypicGroup', 'featureColumn', 'quantityColumn', 'duplicatePolicy']) {
    $(id).addEventListener('change', () => {
      if (state.dataset && (state.file || state.dataSource === 'helper') && activeMode() === 'proteomics') clearLoadedData('蛋白组筛选或报告列规则已更改，请重新导入。');
    });
  }
  $('loadButton').addEventListener('click', loadSelectedFile);
  $('demoButton').addEventListener('click', loadDemo);
  $('helperRefreshButton').addEventListener('click', refreshHelperStatus);
  $('helperPath').addEventListener('input', updateHelperControls);
  $('helperComparePath').addEventListener('input', updateHelperControls);
  $('helperPickButton').addEventListener('click', () => refreshOrRegisterHelperFile('main', true));
  $('helperRegisterButton').addEventListener('click', () => refreshOrRegisterHelperFile('main', false));
  $('helperComparePickButton').addEventListener('click', () => refreshOrRegisterHelperFile('compare', true));
  $('helperCompareRegisterButton').addEventListener('click', () => refreshOrRegisterHelperFile('compare', false));
  $('helperImportButton').addEventListener('click', importHelperReport);
  $('helperTargetButton').addEventListener('click', queryHelperTarget);
  $('helperXicButton').addEventListener('click', queryHelperXic);
  $('helperCompareButton').addEventListener('click', compareHelperReports);
  $('helperFastaPath').addEventListener('input', updateHelperControls);
  $('helperFastaPickButton').addEventListener('click', () => refreshOrRegisterHelperFile('fasta', true));
  $('helperFastaRegisterButton').addEventListener('click', () => refreshOrRegisterHelperFile('fasta', false));
  $('helperProteinId').addEventListener('input', updateHelperControls);
  $('helperSequenceButton').addEventListener('click', queryHelperSequence);
  $('helperCancelButton').addEventListener('click', cancelHelperTask);
  $('designFile').addEventListener('change', updateDesignTools);
  $('importDesignButton').addEventListener('click', importDesignTable);
  $('saveSessionButton').addEventListener('click', saveSessionSettings);
  $('loadSessionButton').addEventListener('click', () => $('sessionFile').click());
  $('sessionFile').addEventListener('change', loadSessionSettings);
  $('upstreamConfirmed').addEventListener('change', () => { invalidateResults(); updateRunButton(); });
  for (const id of ['analysisAlpha', 'analysisLfc', 'minimumObserved', 'seed']) {
    $(id).addEventListener('input', () => { invalidateResults(); updateRunButton(); });
  }
  for (const id of ['technicalAggregation', 'statisticalMethod', 'pAdjust', 'normalization', 'imputation', 'imputationScope']) {
    $(id).addEventListener('change', () => {
      invalidateResults();
      updateProcessingRuntimeNote();
      updateRunButton();
    });
  }
  $('runButton').addEventListener('click', run);
  $('cancelButton').addEventListener('click', cancelRun);
  $('viewMetric').addEventListener('change', updateView);
  $('viewThreshold').addEventListener('input', updateView);
  $('onlyAboveThreshold').addEventListener('change', renderDifferentialTable);
  $('tableSearch').addEventListener('input', renderDifferentialTable);
  $('targetFeature').addEventListener('input', () => {
    state.selectedFeature = $('targetFeature').value.trim();
    renderCharts(); renderDifferentialTable(); updateAtlasLink();
  });
  $('atlasSpecies').addEventListener('change', updateAtlasLink);
  $('gmtFile').addEventListener('change', readGmtFile);
  $('enrichmentMethod').addEventListener('change', updateEnrichmentControls);
  $('enrichButton').addEventListener('click', enrich);
  $('downloadCsvButton').addEventListener('click', () => downloadTable(',', 'csv', 'text/csv'));
  $('downloadTsvButton').addEventListener('click', () => downloadTable('\t', 'tsv', 'text/tab-separated-values'));
  $('downloadHtmlButton').addEventListener('click', downloadHtml);
  $('downloadZipButton').addEventListener('click', downloadZip);
  document.querySelectorAll('[data-chart][data-format]').forEach((button) => button.addEventListener('click', () => downloadChart(button.dataset.chart, button.dataset.format)));
  document.querySelectorAll('[data-field="sample"], [data-field="group"], [data-field="exclude"]').forEach((input) => input.addEventListener('change', () => { syncDesignFromDom(); invalidateResults(); renderGroupChoices(); updateRunButton(); }));
}

bindEvents();
updateModeControls();
updateRunButton();
updateHelperControls();
updateDesignTools();
updateAtlasLink();
void refreshHelperStatus();
