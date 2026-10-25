// SPDX-License-Identifier: MIT
import {WebR} from './vendor/webr/webr.mjs';
self.onmessage=async({data})=>{
  let r;
  try{
    const progress=message=>self.postMessage({type:'progress',message});
    r=new WebR({baseUrl:data.baseURL+'vendor/webr/',repoUrl:data.baseURL+'vendor/packages/',channelType:3,interactive:false});
    await r.init();progress('统计环境已启动；正在载入固定版本分析包。');
    await r.installPackages(data.dataset.mode==='counts'?['jsonlite','limma','edgeR']:['jsonlite','limma'],{repos:[data.baseURL+'vendor/packages/'],quiet:true});
    const code=await fetch(data.baseURL+'statistics.R');if(!code.ok)throw Error('统计脚本加载失败。');
    await r.FS.writeFile('/statistics.R',new TextEncoder().encode(await code.text()));
    await r.FS.writeFile('/input.json',new TextEncoder().encode(JSON.stringify({dataset:data.dataset,options:data.options})));
    progress('正在计算 QC、模型与多重检验校正。');
    await r.evalRVoid('source("/statistics.R",encoding="UTF-8"); run_experianalysis_file()');
    const result=JSON.parse(new TextDecoder().decode(await r.FS.readFile('/result.json')));
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
  finally{if(r)await r.close();}
};
