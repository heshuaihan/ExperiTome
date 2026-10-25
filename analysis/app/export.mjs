// SPDX-License-Identifier: MIT
import {escapeHTML as h,tableToTSV,VERSION} from './core.mjs';
import {aggregateSamples} from './core.mjs';
import {nodeConfiguration} from './pipeline.mjs';
const encoder=new TextEncoder();
const crcTable=Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function zipStore(files){
  const chunks=[],central=[];let offset=0;
  const header=(size,write)=>{const b=new Uint8Array(size);write(new DataView(b.buffer));return b;};
  for(const [name,value] of Object.entries(files)){
    const filename=encoder.encode(name);const bytes=typeof value==='string'?encoder.encode(value):value;const crc=crc32(bytes);const start=offset;
    const local=header(30,v=>{v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,filename.length,true);});
    chunks.push(local,filename,bytes);offset+=local.length+filename.length+bytes.length;
    central.push(header(46,v=>{v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,filename.length,true);v.setUint32(42,start,true);}),filename);
  }
  const size=central.reduce((n,b)=>n+b.length,0);const n=Object.keys(files).length;
  const end=header(22,v=>{v.setUint32(0,0x06054b50,true);v.setUint16(8,n,true);v.setUint16(10,n,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);});
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
export function matrixTSV(ids,samples,matrix){
  const cell=x=>String(x??'').replace(/[\t\r\n]/g,' ');
  return ['feature_id\t'+samples.map(cell).join('\t'),...ids.map((id,i)=>[cell(id),...(matrix[i]??[]).map(cell)].join('\t'))].join('\n')+'\n';
}
export function standaloneReport(result,svgs=[]){
  const rows=result.differential??[];const statistical=result.mode!=='expression';
  const headers=statistical?['ID','log2FC','P','BH-FDR','状态','n处理','n对照']:['ID','状态'];
  const cells=r=>statistical?[r.id,r.logFC,r.PValue,r.FDR,r.status,r.nCase,r.nControl]:[r.id,r.status];
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ExperiAnalysis 结果报告</title><style>body{font:16px system-ui,sans-serif;line-height:1.65;max-width:1150px;margin:40px auto;padding:0 24px;color:#173c3c}h1,h2{color:#087e78}table{border-collapse:collapse;font-size:13px;display:block;overflow:auto}td,th{padding:7px 12px;border-bottom:1px solid #dce7e4;text-align:left}pre{white-space:pre-wrap;background:#f5f9f7;padding:16px}svg{max-width:100%;height:auto}details{margin:12px 0}.note{padding:12px;background:#fff6de}@media print{table{display:table}details{display:block}}</style><h1>ExperiAnalysis 分析报告</h1><p>v${VERSION} · ${h(result.mode)} · ${result.sampleIds.length} 个生物样本 · ${result.featureIds.length} 个输入特征</p>${result.audit?.synthetic?'<p class="note">人工合成演示数据，不代表实验结果。</p>':''}<h2>方法与处理范围</h2><p>${h(result.method)}</p><pre>${h((result.warnings??[]).join('\n'))}</pre><h2>结果图</h2>${svgs.join('\n')||'<p>本次未附图；结构化结果表及方法记录完整保留。</p>'}<h2>${statistical?'全量差异结果':'表达探索特征记录'}</h2><p>效应方向：${h(result.audit?.effectDirection??'不适用')}。缺失与不可检验条目保留，未赋予虚构 P 值。</p><table><thead><tr>${headers.map(x=>'<th>'+x+'</th>').join('')}</tr></thead><tbody>${rows.map(r=>'<tr>'+cells(r).map(x=>'<td>'+h(x)+'</td>').join('')+'</tr>').join('')}</tbody></table>${result.enrichment?'<h2>功能富集</h2><p>实际背景 '+h(result.enrichmentAudit?.backgroundSize)+'；候选 '+h(result.enrichmentAudit?.foregroundSize)+'；检验集合 '+h(result.enrichmentAudit?.testedSets??0)+'</p><table><tr><th>集合</th><th>命中数</th><th>P</th><th>BH-FDR</th></tr>'+result.enrichment.map(r=>'<tr>'+[r.name,r.overlap,r.PValue,r.FDR].map(v=>'<td>'+h(v)+'</td>').join('')+'</tr>').join('')+'</table>':''}<details><summary>版本</summary><pre>${h(JSON.stringify(result.versions,null,2))}</pre></details><details><summary>审计记录</summary><pre>${h(JSON.stringify(result.audit,null,2))}</pre></details></html>`;
}
export async function makeResultZip(result,dataset,design,options){
  const clean=Object.fromEntries(Object.entries(options??{}).filter(([k,v])=>k!=='signal'&&typeof v!=='function'&&!(typeof File!=='undefined'&&v instanceof File)));
  const svgs=typeof document!=='undefined'?[...document.querySelectorAll('.chart-container svg, .chart-host svg, .chart-card svg')].map(s=>new XMLSerializer().serializeToString(s)):[];
  const reproductionInput={dataset:aggregateSamples(dataset,design,clean),options:result.options??clean};
  const files={
    'pipeline.json':JSON.stringify(nodeConfiguration({...clean,filters:dataset.audit?.filters}),null,2),
    'input.json':JSON.stringify(reproductionInput),
    'reproduce.R':'source("statistics.R",encoding="UTF-8")\nrun_experianalysis_file("input.json","reproduced-result.json")\n',
    'reproduce.py':'"""Run the exact saved R analysis. Requires R and packages named in versions.json. Import/filter audit is in audit.json; input.json is the exact post-aggregation input."""\nimport shutil, subprocess\nfrom pathlib import Path\nroot=Path(__file__).resolve().parent\nr=shutil.which("Rscript")\nif not r: raise SystemExit("Rscript is required; run reproduce.R with your R installation")\nsubprocess.run([r,"--vanilla","reproduce.R"],cwd=root,check=True)\n',
    'README.txt':'ExperiAnalysis '+VERSION+'\n原始输入文件留在使用者本机，不随本结果包复制。raw_matrix 是技术重复汇总后的输入尺度矩阵；display_matrix 是 QC/显示矩阵；model_matrix 是实际模型输入，可能有不同的样本/特征范围。\n数值结果不能视为实验验证或因果证据。\n',
    'differential.tsv':tableToTSV(result.mode==='expression'?(result.differential??[]).map(({id,status})=>({id,status})):(result.differential??[])),'design.tsv':tableToTSV(design),
    'raw_matrix.tsv':matrixTSV(result.featureIds,result.sampleIds,result.rawMatrix),
    'display_matrix.tsv':matrixTSV(result.featureIds,result.sampleIds,result.matrix),
    'technical_available.tsv':matrixTSV(result.featureIds,result.sampleIds,result.technicalAvailable??result.rawMatrix.map(row=>row.map(x=>x===null?0:1))),
    'config.used.json':JSON.stringify(clean,null,2),'audit.json':JSON.stringify(result.audit,null,2),'versions.json':JSON.stringify(result.versions,null,2),
    'methods.txt':result.method+'\n'+(result.warnings??[]).join('\n'),'report.html':standaloneReport(result,svgs),
    'qc.json':JSON.stringify(result.qc),'input-provenance.json':JSON.stringify(dataset.metadata??{},null,2),
    'qc-summary.tsv':tableToTSV(result.sampleIds.map((sample,i)=>({sample,detected:result.qc.counts[i],missingFraction:result.qc.missing[i],median:result.qc.medians[i]})))
  };
  if(result.observedMatrix)files['observed_matrix.tsv']=matrixTSV(result.featureIds,result.sampleIds,result.observedMatrix);
  if(result.technicalCV)files['technical_cv.tsv']=matrixTSV(result.featureIds,result.sampleIds,result.technicalCV);
  if(result.imputedMask)files['imputed_mask.tsv']=matrixTSV(result.featureIds,result.sampleIds,result.imputedMask.map(row=>row.map(v=>v?1:0)));
  if(typeof fetch==='function'&&typeof location!=='undefined'){
    const code=await fetch(new URL('./statistics.R',import.meta.url));
    if(!code.ok)throw Error('无法读取复现脚本，未生成不完整结果包。');
    files['statistics.R']=await code.text();
  }
  if(result.modelMatrix)files['model_matrix.tsv']=matrixTSV(result.modelFeatureIds,result.modelSampleIds,result.modelMatrix);
  if(result.enrichment){files['enrichment.tsv']=tableToTSV(result.enrichment);files['enrichment-audit.json']=JSON.stringify(result.enrichmentAudit,null,2);}
  svgs.forEach((s,i)=>files[`figures/figure-${i+1}.svg`]=s);
  return zipStore(files);
}
