// SPDX-License-Identifier: MIT
export const VERSION = '0.2.0';
export const LIMITS = Object.freeze({fileBytes:250*1024**2,reportRows:5_000_000,features:50_000,samples:100,cells:5_000_000});
export const BASIC_FILTERS = Object.freeze({filters:[['Q.Value','<',.01],['Global.Q.Value','<',.01],['PG.Q.Value','<',.05],['Global.PG.Q.Value','<',.01]],exclude_protein_group_contains:[],minimum_distinct_peptides:0,peptide_count_scope:'protein_group'});
export function delimitedRows(text, limit=LIMITS.reportRows+1) {
  text=text.replace(/^\uFEFF/,'');
  const sep=text.slice(0,text.indexOf('\n')<0?text.length:text.indexOf('\n')).includes('\t')?'\t':',';
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;} else if(quoted || cell==='')quoted=!quoted; else cell+=c; }
    else if(!quoted && (c===sep || c==='\n' || c==='\r')) {
      row.push(cell);cell='';
      if(c!==sep){if(row.some(x=>x!==''))rows.push(row);row=[];if(c==='\r' && text[i+1]==='\n')i++;if(rows.length>limit)throw Error('数据行数超过浏览器版上限。');}
    } else cell+=c;
  }
  if(quoted)throw Error('表格存在未闭合的引号。');
  if(cell!=='' || row.length){row.push(cell);if(row.some(x=>x!==''))rows.push(row);}
  if(!rows.length)throw Error('文件为空。');
  const header=rows.shift();
  if(header.some(x=>!x.trim()) || new Set(header).size!==header.length)throw Error('列名不能为空或重复。');
  for(let i=0;i<rows.length;i++)if(rows[i].length!==header.length)throw Error(`第 ${i+2} 行列数不一致。`);
  return {header,rows,separator:sep};
}
export function numeric(value,{allowMissing=true,label='数值'}={}) {
  if(value===null || value===undefined || String(value).trim()==='' || /^(NA|NaN|null)$/i.test(String(value).trim())){
    if(allowMissing)return null;throw Error(`${label} 有缺失值；原始 counts 不允许缺失。`);
  }
  const s=String(value).trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) || !Number.isFinite(Number(s)))throw Error(`${label} 含无效数值：${s.slice(0,35)}`);
  return Number(s);
}
export function validateDataset(d) {
  if(!['proteomics','counts','expression'].includes(d.mode))throw Error('请选择数据类型。');
  if(!['linear','log2'].includes(d.scale))throw Error('请确认原始强度或 log2 数据尺度。');
  if(d.mode==='counts' && d.scale!=='linear')throw Error('counts 必须是原始计数，不能是 log2 值。');
  if(!d.featureIds?.length || !d.sampleIds?.length)throw Error('至少需要一个特征和一个样本。');
  if(d.featureIds.length>LIMITS.features || d.sampleIds.length>LIMITS.samples || d.featureIds.length*d.sampleIds.length>LIMITS.cells)throw Error('矩阵超过 5 万特征、100 样本或 500 万数值单元上限。');
  if(new Set(d.featureIds).size!==d.featureIds.length || d.featureIds.some(x=>!String(x).trim()))throw Error('特征 ID 为空或重复，请在导入前明确合并规则。');
  if(new Set(d.sampleIds).size!==d.sampleIds.length || d.sampleIds.some(x=>!String(x).trim()))throw Error('样本名为空或重复。');
  if(d.values.length!==d.featureIds.length)throw Error('特征与矩阵行数不一致。');
  d.values.forEach((r,i)=>{if(r.length!==d.sampleIds.length)throw Error('样本与矩阵列数不一致。');r.forEach(v=>{if(v===null){if(d.mode==='counts')throw Error('counts 不能含缺失值。');return;}if(!Number.isFinite(v))throw Error(`特征 ${d.featureIds[i]} 含非有限数值。`);if(d.mode==='counts' && (!Number.isSafeInteger(v)||v<0))throw Error('counts 必须为非负安全整数，不接受 TPM/FPKM 或小数。');if(d.scale==='linear' && v<0)throw Error('原始强度/表达量不接受负数；如为 log2 值请更改尺度。');});});
  return d;
}
const ANNOTATIONS=new Set(['Protein.Ids','Protein.Names','Genes','First.Protein.Description','Description','description','Chr','Start','End','Strand','Length','GeneLength','gene_name','gene_symbol','symbol','GeneSymbol','PG.Q.Value','Global.PG.Q.Value','PG.Q.value','Global.PG.Q.value']);
export function parseTable(text,{mode='proteomics',scale='linear'}={}){
  const {header,rows}=delimitedRows(text,LIMITS.features+1);
  const idIndex=['Protein.Group','gene_id','Geneid','GeneID','Gene','ID','id','feature_id'].map(x=>header.indexOf(x)).find(x=>x>=0)??0;
  const columns=header.map((name,i)=>({name,i})).filter(x=>x.i!==idIndex && !ANNOTATIONS.has(x.name));
  if(!columns.length)throw Error('没有识别到样本列；请保留 ID 和数值样本列。');
  const d={mode,scale,featureIds:rows.map(r=>r[idIndex]),sampleIds:columns.map(x=>x.name),values:rows.map((r,ri)=>columns.map(c=>numeric(r[c.i],{allowMissing:mode!=='counts',label:`第 ${ri+2} 行／${c.name}`}))),metadata:{inputType:'matrix',idColumn:header[idIndex],ignoredAnnotationColumns:header.filter((x,i)=>i!==idIndex&&ANNOTATIONS.has(x))},audit:{sourceRows:rows.length,precursorFiltersApplied:false,notes:['矩阵不具备完整前体证据，不能重建主报告行过滤。']}};
  return validateDataset(d);
}
export function validateDesign(d,design){
  if(!Array.isArray(design) || design.length!==d.sampleIds.length)throw Error('每个输入样本必须有且仅有一条分组记录。');
  const byRun=new Map(design.map(x=>[x.run,x]));
  if(byRun.size!==design.length || d.sampleIds.some(x=>!byRun.has(x)))throw Error('分组记录的 Run 与输入样本不一致。');
  const kept=design.filter(x=>!x.exclude), groups=new Map();
  if(!kept.length)throw Error('不能排除全部样本。');
  for(const x of kept){if(!String(x.sample??'').trim() || !String(x.group??'').trim())throw Error('请为每个保留样本填写生物样本 ID 和组别。');if(groups.has(x.sample)&&groups.get(x.sample)!==x.group)throw Error('同一个生物样本不能属于不同组别。');groups.set(x.sample,x.group);}
  return true;
}
export function aggregateSamples(d,design,options={}){
  validateDataset(d);validateDesign(d,design);
  const byRun=new Map(design.map(x=>[x.run,x])); const samples=[]; const members=new Map(); const groups=[];
  d.sampleIds.forEach((run,j)=>{const s=byRun.get(run);if(s.exclude)return;if(!members.has(s.sample)){samples.push(s.sample);members.set(s.sample,[]);groups.push(s.group);}members.get(s.sample).push(j);});
  const values=d.values.map(row=>samples.map(sample=>{
    const vals=members.get(sample).map(j=>row[j]).filter(x=>x!==null && !(d.mode==='proteomics'&&d.scale==='linear'&&x<=0));
    if(!vals.length)return null;
    if(d.mode==='counts'){const sum=vals.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(sum))throw Error('技术重复 counts 求和超过安全整数范围。');return sum;}
    const linear=d.scale==='log2'?vals.map(x=>2**x):vals;
    linear.sort((a,b)=>a-b);
    const mid=Math.floor(linear.length/2);
    const value=options.technicalAggregation==='median'?(linear.length%2?linear[mid]:(linear[mid-1]+linear[mid])/2):linear.reduce((a,b)=>a+b,0)/linear.length;
    if(!Number.isFinite(value))throw Error('数值超出可汇总范围。');
    return d.scale==='log2'?Math.log2(value):value;
  }));
  const technicalAvailable=d.values.map(row=>samples.map(sample=>members.get(sample).map(j=>row[j]).filter(x=>x!==null&&!(d.mode==='proteomics'&&d.scale==='linear'&&x<=0)).length));
  const technicalCV=d.values.map(row=>samples.map(sample=>{
    const vals=members.get(sample).map(j=>row[j]).filter(x=>x!==null&&!(d.mode==='proteomics'&&d.scale==='linear'&&x<=0)).map(x=>d.scale==='log2'?2**x:x);
    if(vals.length<2)return null;const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    return mean>0?Math.sqrt(vals.reduce((s,x)=>s+(x-mean)**2,0)/(vals.length-1))/mean:null;
  }));
  return {...d,sampleIds:samples,values,groups,technicalAvailable,technicalCV,technicalCounts:samples.map(s=>members.get(s).length),audit:{...d.audit,technicalCVDefinition:'sample SD / mean on positive linear technical-run quantities; unavailable for <2 observations',technicalAggregation:d.mode==='counts'?'sum raw counts':`${options.technicalAggregation==='median'?'median':'arithmetic mean'} on linear scale before log2`,nonpositiveLFQ:'retained in imported data; treated as missing before technical aggregation',technicalMembers:Object.fromEntries(samples.map(s=>[s,members.get(s).map(j=>d.sampleIds[j])])),excludedRuns:design.filter(x=>x.exclude).map(x=>x.run)}};
}
export function makeDemo(mode='proteomics'){
  let seed=417;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const featureIds=Array.from({length:240},(_,i)=>mode==='proteomics'?`DEMO_PROTEIN_${i+1}`:`DEMO_GENE_${i+1}`);
  const sampleIds=['Control_1','Control_2','Control_3','Treatment_1','Treatment_2','Treatment_3'];
  const values=featureIds.map((_,i)=>{const base=mode==='counts'?30+1000*random():2**(15+5*random());return sampleIds.map((s,j)=>{const fc=j>=3?(i<40?2.6:i<80?.4:1):1;const noise=.8+.4*random();return mode==='counts'?Math.round(base*fc*noise):base*fc*noise;});});
  if(mode==='proteomics'){values[200][0]=null;values[201]=[50,60,70,null,null,null];values[202]=[null,null,null,70,80,90];}
  return {mode,scale:'linear',featureIds,sampleIds,values,metadata:{inputType:'synthetic demonstration',synthetic:true,design:sampleIds.map((run,i)=>({run,sample:run,group:i<3?'Control':'Treatment',exclude:false}))},audit:{sourceRows:featureIds.length,notes:['人工合成演示数据，不代表实验观察。']}};
}
export function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function tableToTSV(rows){if(!rows.length)return '';const keys=Object.keys(rows[0]);const cell=v=>String(v??'').replace(/[\t\r\n]/g,' ');return keys.join('\t')+'\n'+rows.map(r=>keys.map(k=>cell(r[k])).join('\t')).join('\n')+'\n';}
export async function makeResultZip(...args){return (await import('./export.mjs')).makeResultZip(...args);}
