// SPDX-License-Identifier: MIT
export const PIPELINE_VERSION = '1';
export const NODE_ORDER = Object.freeze(['input','filters','design','processing','statistics','enrichment','presentation']);
export function pipelineOptions(options={}) {
  const o={technicalAggregation:'mean',minimumObserved:2,statisticalMethod:'limma',pAdjust:'BH',normalization:options.medianNormalize?'median':'none',imputation:'none',imputationScope:'visualization',seed:417,...options};
  const choice=(k,values)=>{if(!values.includes(o[k]))throw Error(`Unsupported ${k}: ${o[k]}`);};
  choice('technicalAggregation',['mean','median']);choice('statisticalMethod',['limma','welch']);choice('pAdjust',['BH','BY']);choice('normalization',['none','median','quantile']);choice('imputation',['none','MinProb','knn']);choice('imputationScope',['visualization','model','both']);
  if(!Number.isInteger(Number(o.minimumObserved))||Number(o.minimumObserved)<1)throw Error('每组最少观测数必须为正整数。');
  if(!Number.isSafeInteger(Number(o.seed))||Number(o.seed)<0||Number(o.seed)>2147483647)throw Error('随机种子超出有效范围。');
  o.minimumObserved=Number(o.minimumObserved);o.seed=Number(o.seed);o.medianNormalize=o.normalization==='median';
  delete o.signal;
  return o;
}
export function nodeConfiguration(options={}) {
  const o=pipelineOptions(options);
  return {version:PIPELINE_VERSION,order:NODE_ORDER,nodes:{input:{scale:options.scale??'explicit at import'},filters:options.filters??null,design:{technicalAggregation:o.technicalAggregation},processing:{normalization:o.normalization,imputation:o.imputation,imputationScope:o.imputationScope,seed:o.seed},statistics:{method:o.statisticalMethod,minimumObserved:o.minimumObserved,pAdjust:o.pAdjust,caseGroup:o.caseGroup,controlGroup:o.controlGroup},enrichment:{method:options.enrichmentMethod??'ORA'},presentation:{alpha:o.alpha??.05,lfcThreshold:o.lfcThreshold??0}}};
}
