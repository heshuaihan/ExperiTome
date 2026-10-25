// SPDX-License-Identifier: MIT
import {aggregateSamples,VERSION} from './core.mjs';
import {pipelineOptions,nodeConfiguration} from './pipeline.mjs';
import {capabilities,runLocalJob} from './local-helper-client.mjs';
let active=null;
export async function runAnalysis(dataset,design,options={},onProgress=()=>{}){
  if(active)throw Error('已有分析正在运行；请先取消或等待。');
  const clean=pipelineOptions({caseGroup:options.caseGroup,controlGroup:options.controlGroup,alpha:Number(options.alpha??.05),lfcThreshold:Number(options.lfcThreshold??0),upstreamNormalizationConfirmed:options.upstreamNormalizationConfirmed??'unknown',...options});
  const d=aggregateSamples(dataset,design,clean);
  if(d.mode!=='expression'){
    const n=g=>d.groups.filter(x=>x===g).length;
    if(options.caseGroup===options.controlGroup || n(options.caseGroup)<2 || n(options.controlGroup)<2)throw Error('请选择不同的处理/对照组，每组至少两个独立生物样本。');
  }
  if(!Number.isFinite(Number(options.alpha??.05)) || Number(options.alpha??.05)<=0 || Number(options.alpha??.05)>1)throw Error('FDR 阈值应在 0 到 1 之间。');
  if(!Number.isFinite(Number(options.lfcThreshold??0)) || Number(options.lfcThreshold??0)<0)throw Error('效应量阈值必须是非负数。');
  const finalize=result=>{result.audit={...d.audit,...result.audit,input:dataset.metadata??{},inputSHA256:dataset.metadata?.sha256??null,upstreamNormalizationConfirmed:clean.upstreamNormalizationConfirmed,synthetic:!!dataset.metadata?.synthetic,pipeline:nodeConfiguration({...clean,filters:dataset.audit?.filters})};result.technicalAvailable=d.technicalAvailable;result.technicalCV=d.technicalCV;result.versions={...result.versions,ExperiAnalysis:VERSION};result.design=design;result.options=clean;return result;};
  const local=await capabilities();
  if(local?.rAvailable){
    active=true;
    try{return finalize(await runLocalJob({action:'analysis',dataset:d,options:clean},onProgress,options.signal));}finally{active=null;}
  }
  if(clean.imputation!=='none')throw Error('所选插补方法需要启动本机分析助手。');
  onProgress('正在启动本地统计环境；首次加载可能需要稍候。');
  const worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});active=worker;
  return new Promise((resolve,reject)=>{
    let finished=false; const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);worker.terminate();active=null;if(error)reject(error);else resolve(value);};
    const abort=()=>finish(new DOMException('分析已取消；可以重新开始。','AbortError'));
    const timer=setTimeout(()=>finish(Error('计算超过 10 分钟上限；请减少样本或使用更小的矩阵。')),600_000);
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted){abort();return;}
    worker.onmessage=({data})=>{if(data.type==='progress')onProgress(data.message);if(data.type==='error')finish(Error(data.message));if(data.type==='result'){
      const result=finalize(data.result);result.versions.WebR='0.6.0';finish(null,result);
    }};
    worker.onerror=e=>finish(Error(e.message||'本地统计线程启动失败。'));
    worker.postMessage({dataset:d,options:clean,baseURL:new URL('./',import.meta.url).href});
  });
}
export async function runEnrichment(result,options={},onProgress=()=>{}){
  onProgress('正在准备本地基因集与实际检验背景。');
  if(options.method==='ranked'){
    const response=await runLocalJob({action:'enrichment',result,options},onProgress,options.signal);
    return {...result,enrichment:response.rows,enrichmentAudit:response.audit};
  }
  const {enrich}=await import('./enrichment.mjs');
  const {rows,audit}=await enrich(result,options);
  return {...result,enrichment:rows,enrichmentAudit:audit};
}
