// SPDX-License-Identifier: MIT
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const logfact=[0];function lf(n){for(let i=logfact.length;i<=n;i++)logfact[i]=logfact[i-1]+Math.log(i);return logfact[n];}
function choose(n,k){return k<0||k>n?-Infinity:lf(n)-lf(k)-lf(n-k);}
export function hypergeomUpper(N,K,n,k){if(k<=0)return 1;const end=Math.min(K,n);if(k>end)return 0;let max=-Infinity,terms=[];for(let j=k;j<=end;j++){const t=choose(K,j)+choose(N-K,n-j)-choose(N,n);terms.push(t);max=Math.max(max,t);}if(!finite(max))return 0;return Math.min(1,Math.exp(max)*terms.reduce((s,x)=>s+Math.exp(x-max),0));}
export function adjustBH(values){const order=values.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);const out=values.map(()=>1);let next=1;for(let j=order.length-1;j>=0;j--){next=Math.min(next,order[j].v*order.length/(j+1));out[order[j].i]=Math.min(1,next);}return out;}
export function parseGMT(text){if(new TextEncoder().encode(text).length>5*1024**2)throw Error('GMT 超过 5 MiB。');const seen=new Set();return text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim()).map((line,i)=>{const [id,name,...members]=line.split('\t');if(!id||members.length<1)throw Error(`GMT 第 ${i+1} 行需要集合名、描述和至少一个 ID。`);if(seen.has(id))throw Error('GMT 集合名重复：'+id);seen.add(id);return {id,name:name||id,members:[...new Set(members.filter(x=>x))]};});}
export async function enrich(result,{species='human',gmtText='',alpha=.05,lfcThreshold=0}={}){
  if(result.mode==='expression')throw Error('表达探索没有正式差异检验，不能生成显著基因富集。');
  if(!finite(Number(alpha))||alpha<=0||alpha>1||!finite(Number(lfcThreshold))||lfcThreshold<0)throw Error('富集阈值无效。');
  let sets,aliases=null,source;
  if(gmtText.trim()){sets=parseGMT(gmtText);source={type:'user GMT',mapping:'exact feature IDs'};}
  else{
    const tax={worm:6239,mouse:10090,human:9606}[species];if(!tax)throw Error('请选择物种。');
    const response=await fetch(new URL(`./data/reactome-${species}-${tax}-v97.json.gz`,import.meta.url));if(!response.ok)throw Error('本地 Reactome 基因集不可用。');
    const text=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();const data=JSON.parse(text);
    sets=data.pathways;aliases=data.aliases;source={species,version:data.version,...data.source};
  }
  const mappings=[],background=new Set(),foreground=new Set();
  const known=new Set(sets.flatMap(s=>s.members));
  for(const row of result.differential){
    if(row.status!=='tested'||!finite(row.PValue)||!finite(row.FDR)||!finite(row.logFC))continue;
    let gene=null,reason='unmapped';
    if(!aliases){if(known.has(row.id)){gene=row.id;reason='exact';}}
    else{
      const members=String(row.id).split(';').map(x=>x.trim()).filter(Boolean);const candidates=members.map(id=>aliases[id]??(known.has(id)?[id]:[]));
      if(candidates.length && candidates.every(c=>c.length===1) && new Set(candidates.map(c=>c[0])).size===1){gene=candidates[0][0];reason='unique';}
      else if(candidates.some(c=>c.length>1)||new Set(candidates.flat()).size>1)reason='ambiguous';
    }
    const hit=row.FDR<alpha&&Math.abs(row.logFC)>=lfcThreshold;
    mappings.push({feature:row.id,gene,reason,hit});if(gene&&known.has(gene)){background.add(gene);if(hit)foreground.add(gene);}
  }
  const audit={source,alpha,lfcThreshold,mapping:mappings,background:[...background],foreground:[...foreground],backgroundSize:background.size,foregroundSize:foreground.size,minSetSize:10,maxSetSize:500,test:'one-sided hypergeometric; BH over all tested sets including zero-overlap sets',notes:['多蛋白/多基因候选不展开为独立观测。内置快照映射覆盖范围有限，未映射和歧义逐项保留。']};
  if(!foreground.size)return {rows:[],audit:{...audit,status:'没有满足阈值且可唯一映射的候选。'}};
  const rows=[];
  for(const set of sets){const members=[...new Set(set.members)].filter(x=>background.has(x));if(members.length<10||members.length>500)continue;const hits=members.filter(x=>foreground.has(x));rows.push({id:set.id,name:set.name,overlap:hits.length,setSize:members.length,backgroundSize:background.size,foregroundSize:foreground.size,PValue:hypergeomUpper(background.size,members.length,foreground.size,hits.length),genes:hits.join(';'),score:(hits.length/foreground.size)/(members.length/background.size)});}
  const adj=adjustBH(rows.map(x=>x.PValue));rows.forEach((r,i)=>r.FDR=adj[i]);rows.sort((a,b)=>a.FDR-b.FDR||a.PValue-b.PValue);return {rows,audit:{...audit,testedSets:rows.length,status:rows.length?'completed':'实际背景中没有满足集合大小要求的通路。'}};
}
