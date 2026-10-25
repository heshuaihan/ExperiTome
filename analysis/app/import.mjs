// SPDX-License-Identifier: MIT
import {BASIC_FILTERS,LIMITS,delimitedRows,parseTable,validateDataset} from './core.mjs';
export async function importFile(file,options={},onProgress=()=>{}){
  if(file.size>LIMITS.fileBytes)throw Error('单个输入文件超过 250 MiB；请改用较小的蛋白/基因矩阵。');
  if(!/\.(csv|tsv|txt|parquet)$/i.test(file.name))throw Error('请选择 CSV、TSV、TXT 或 Parquet。');
  if(typeof Worker==='undefined')return importLocal(file,options,onProgress);
  return new Promise((resolve,reject)=>{
    const w=new Worker(new URL('./import-worker.mjs',import.meta.url),{type:'module'});
    const timeout=setTimeout(()=>{w.terminate();reject(Error('读取超过 5 分钟，请使用更小的矩阵。'));},300000);
    const finish=(err,data)=>{clearTimeout(timeout);w.terminate();err?reject(err):resolve(data);};
    w.onmessage=({data})=>{if(data.type==='progress')onProgress(data.message);if(data.type==='result')finish(null,data.dataset);if(data.type==='error')finish(Error(data.message));};
    w.onerror=e=>finish(Error(e.message||'文件读取线程失败。'));
    w.postMessage({file,options});
  });
}
export async function importLocal(file,options={},onProgress=()=>{}){
  onProgress('正在本地读取文件与检查输入结构。');
  let d;
  if(file.name.toLowerCase().endsWith('.parquet') || file.size>16*1024**2)d=await readParquet(file,options,onProgress);
  else{
    const text=await file.text();const parsed=delimitedRows(text);
    d=parsed.header.includes('Run') && parsed.header.includes('PG.MaxLFQ')?reportToDataset(parsed,options):parseTable(text,options);
  }
  // Hash the original local input; neither its contents nor its name is sent out.
  const bytes=await file.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',bytes);
  d.metadata={...d.metadata,filename:file.name,inputBytes:file.size,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};
  return d;
}
function config(cfg=BASIC_FILTERS){
  const f=structuredClone(cfg);
  if(!Array.isArray(f.filters)||f.filters.some(x=>!Array.isArray(x)||x.length!==3||!['<','<=','>','>=','==','!='].includes(x[1])||!Number.isFinite(Number(x[2]))))throw Error('过滤条件格式错误。');
  if(!Number.isInteger(f.minimum_distinct_peptides??0)||(f.minimum_distinct_peptides??0)<0)throw Error('最少肽段数必须是非负整数。');
  if(!['protein_group','run_protein_group'].includes(f.peptide_count_scope??'protein_group'))throw Error('肽段计数范围无效。');
  f.exclude_protein_group_contains??=[];if(!Array.isArray(f.exclude_protein_group_contains)||f.exclude_protein_group_contains.some(x=>typeof x!=='string'||x===''))throw Error('污染标签必须是非空字面字符串。');
  return f;
}
const finiteValue=x=>{if(x===null||x===undefined||String(x).trim()==='')return null;const n=Number(x);return Number.isFinite(n)?n:null;};
export function reportToDataset({header,rows},{mode='proteomics',scale='linear',filters=BASIC_FILTERS}={}){
  if(mode!=='proteomics'||scale!=='linear')throw Error('DIA-NN 主报告按 LFQ 原始强度读取，请选择 LFQ 与线性尺度。');
  if(rows.length>LIMITS.reportRows)throw Error('主报告超过 500 万行。');
  const cfg=config(filters);const pos=Object.fromEntries(header.map((x,i)=>[x,i]));
  for(const key of ['Run','Protein.Group','PG.MaxLFQ',...cfg.filters.map(x=>x[0]),...(cfg.minimum_distinct_peptides?['Stripped.Sequence']:[]),...(cfg.require_proteotypic_group?['Proteotypic']:[])])if(!(key in pos))throw Error(`主报告缺少 ${key} 列；未跳过过滤条件。`);
  const runIds=[...new Set(rows.map(r=>String(r[pos.Run])))];
  if(runIds.some(x=>!x.trim()))throw Error('Run 不能为空。');
  let chosen=rows;const stages=[];
  const apply=(label,predicate,invalid=()=>false)=>{const before=chosen.length;const bad=chosen.filter(invalid).length;chosen=chosen.filter(predicate);stages.push({step:label,input_rows:before,removed_rows:before-chosen.length,output_rows:chosen.length,missing_nonnumeric_or_nonfinite_in_incoming_rows:bad});};
  const compare={'<':(a,b)=>a<b,'<=':(a,b)=>a<=b,'>':(a,b)=>a>b,'>=':(a,b)=>a>=b,'==':(a,b)=>a===b,'!=':(a,b)=>a!==b};
  for(const [key,op,value]of cfg.filters)apply(`${key} ${op} ${value}`,r=>{const v=finiteValue(r[pos[key]]);return v!==null&&compare[op](v,Number(value));},r=>finiteValue(r[pos[key]])===null);
  for(const tag of cfg.exclude_protein_group_contains)apply(`Protein.Group excludes literal ${JSON.stringify(tag)}`,r=>!String(r[pos['Protein.Group']]).includes(tag));
  if(cfg.minimum_distinct_peptides){
    const peptides=new Map();const key=r=>JSON.stringify(cfg.peptide_count_scope==='run_protein_group'?[r[pos.Run],r[pos['Protein.Group']]]:[r[pos['Protein.Group']]]);
    for(const r of chosen){const k=key(r);if(!peptides.has(k))peptides.set(k,new Set());const p=String(r[pos['Stripped.Sequence']]??'').trim();if(p)peptides.get(k).add(p);}
    apply(`distinct peptides >= ${cfg.minimum_distinct_peptides}; ${cfg.peptide_count_scope}`,r=>peptides.get(key(r)).size>=cfg.minimum_distinct_peptides);
  }
  if(cfg.require_proteotypic_group){const groups=new Set(chosen.filter(r=>finiteValue(r[pos.Proteotypic])===1).map(r=>String(r[pos['Protein.Group']])));apply('group has passing Proteotypic==1; retain shared rows',r=>groups.has(String(r[pos['Protein.Group']])));}
  const groupValues=new Map(),runCounts=Object.fromEntries(runIds.map(r=>[r,{input_rows:0,output_rows:0,groups:new Set()}]));
  for(const r of rows)runCounts[r[pos.Run]].input_rows++;
  for(const r of chosen){
    const id=String(r[pos['Protein.Group']]);if(!id.trim())throw Error('Protein.Group 不能为空。');
    const run=String(r[pos.Run]);const raw=r[pos['PG.MaxLFQ']];const val=finiteValue(raw);
    if(val===null && raw!==null && raw!==undefined && String(raw).trim()!=='' && !/^(NA|NaN|null)$/i.test(String(raw)))throw Error(`PG.MaxLFQ 含无效数值：${id}/${run}`);
    if(val!==null&&val<0)throw Error('PG.MaxLFQ 存在负数。');
    if(!groupValues.has(id))groupValues.set(id,new Map());const old=groupValues.get(id).get(run);
    if(old!==undefined&&old!==null&&val!==null&&old!==val)throw Error(`同一 Run/Protein.Group 有不一致的 PG.MaxLFQ：${run}/${id}；请核对上游，不能直接求和或平均。`);
    if(val!==null||old===undefined)groupValues.get(id).set(run,val);
    runCounts[run].output_rows++;runCounts[run].groups.add(id);
  }
  const ids=[...groupValues.keys()];
  const d={mode,scale,featureIds:ids,sampleIds:runIds,values:ids.map(id=>runIds.map(r=>groupValues.get(id).get(r)??null)),metadata:{inputType:'DIA-NN main report',quantification:'PG.MaxLFQ'},audit:{sourceRows:rows.length,retainedRows:chosen.length,precursorFiltersApplied:true,filters:cfg,stages,runCounts:runIds.map(run=>({run,...runCounts[run],groups:runCounts[run].groups.size})),notes:['保留上游 PG.MaxLFQ，不基于过滤后肽段重新定量；同 run/组重复值不相加。']}};
  return validateDataset(d);
}
async function readParquet(file,options,onProgress){
  const duckdb=await import('./vendor/duckdb/duckdb-browser.mjs');
  const worker=new Worker(new URL('./vendor/duckdb/duckdb-browser-mvp.worker.js',import.meta.url));
  const db=new duckdb.AsyncDuckDB(new duckdb.VoidLogger(),worker);let conn;
  try{
    await db.instantiate(new URL('./vendor/duckdb/duckdb-mvp.wasm',import.meta.url).href);
    const isParquet=file.name.toLowerCase().endsWith('.parquet');
    const filename=isParquet?'input.parquet':'input.txt';
    await db.registerFileHandle(filename,file,duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,true);
    const firstLine=isParquet?'':(await file.slice(0,65536).text()).split(/\r?\n/)[0];
    conn=await db.connect();const source=isParquet?"read_parquet('input.parquet')":`read_csv('input.txt',header=true,all_varchar=true,delim='${firstLine.includes('\t')?'\\t':','}',nullstr='')`;
    const describe=(await conn.query(`DESCRIBE SELECT * FROM ${source}`)).toArray();const header=describe.map(x=>x.column_name);
    const n=Number((await conn.query(`SELECT count(*) AS n FROM ${source}`)).toArray()[0].n);
    const report=header.includes('Run')&&header.includes('PG.MaxLFQ');
    if(n>(report?LIMITS.reportRows:LIMITS.features))throw Error('数据行数超过浏览器版上限。');
    onProgress(`正在读取 ${isParquet?'Parquet':'大表'}：${n.toLocaleString()} 行；仅提取需要的列。`);
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    const cfg=config(options.filters??BASIC_FILTERS);
    const selected=report?[...new Set(['Run','Protein.Group','PG.MaxLFQ',...cfg.filters.map(x=>x[0]),...(cfg.minimum_distinct_peptides?['Stripped.Sequence']:[]),...(cfg.require_proteotypic_group?['Proteotypic']:[])])]:header;
    for(const c of selected)if(!header.includes(c))throw Error('主报告缺少 '+c);
    if(report)return await reportSQL(conn,source,selected,n,{...options,filters:cfg},onProgress);
    // Column projection avoids copying the full precursor schema into JavaScript.
    const table=await conn.query(`SELECT ${selected.map(quote).join(',')} FROM ${source}`);
    const records=table.toArray();const rows=records.map(r=>selected.map(k=>{const v=r[k];if(typeof v==='bigint'){const n=Number(v);if(!Number.isSafeInteger(n))throw Error('整数超出浏览器安全范围。');return n;}return v;}));
    if(report)return reportToDataset({header:selected,rows},options);
    const cells=[selected,...rows].map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join('\t')).join('\n');
    return parseTable(cells,options);
  }finally{if(conn)await conn.close();await db.terminate();worker.terminate();}
}

async function reportSQL(conn,source,columns,n,options,onProgress){
  if((options.mode??'proteomics')!=='proteomics'||(options.scale??'linear')!=='linear')throw Error('DIA-NN 主报告按 LFQ 线性强度读取。');
  const cfg=options.filters;const q=s=>'"'+s.replaceAll('"','""')+'"';const literal=s=>"'"+s.replaceAll("'","''")+"'";
  const scalar=async sql=>Number((await conn.query(sql)).toArray()[0].n);
  const pg=q('Protein.Group'),run=q('Run'),quantity=q('PG.MaxLFQ');
  await conn.query(`CREATE VIEW ea_source AS SELECT row_number() OVER () AS ea_ordinal,${columns.map(q).join(',')} FROM ${source}`);
  const runRows=(await conn.query(`SELECT CAST(${run} AS VARCHAR) AS run,count(*) AS n,min(ea_ordinal) AS first FROM ea_source GROUP BY ${run} ORDER BY first`)).toArray();
  const samples=runRows.map(r=>r.run);if(samples.length>LIMITS.samples)throw Error('主报告超过 100 个 run。');if(samples.some(r=>r===null||!r.trim()))throw Error('Run 不能为空。');
  let current='ea_source',remaining=n;const stages=[];
  const apply=async(label,condition,invalid=null)=>{const next='ea_stage_'+stages.length;const bad=invalid?await scalar(`SELECT count(*) AS n FROM ${current} WHERE ${invalid}`):0;await conn.query(`CREATE VIEW ${next} AS SELECT * FROM ${current} WHERE ${condition}`);const after=await scalar(`SELECT count(*) AS n FROM ${next}`);stages.push({step:label,input_rows:remaining,removed_rows:remaining-after,output_rows:after,missing_nonnumeric_or_nonfinite_in_incoming_rows:bad});remaining=after;current=next;};
  for(const [column,op,value]of cfg.filters){
    const col=q(column),v=`try_cast(${col} AS DOUBLE)`,finite=`coalesce(isfinite(${v}),false)`;
    await apply(`${column} ${op} ${value}`,`${finite} AND ${v} ${op==='=='?'=':op==='!='?'<>':op} ${Number(value)}`,`NOT ${finite}`);
  }
  for(const tag of cfg.exclude_protein_group_contains)await apply(`Protein.Group excludes literal ${JSON.stringify(tag)}`,`strpos(CAST(${pg} AS VARCHAR),${literal(tag)})=0`);
  if(cfg.minimum_distinct_peptides){const keys=cfg.peptide_count_scope==='run_protein_group'?[run,pg]:[pg];const membership=keys.length===1?keys[0]:'('+keys.join(',')+')';await apply(`distinct peptides >= ${cfg.minimum_distinct_peptides}; ${cfg.peptide_count_scope}`,`${membership} IN (SELECT ${keys.join(',')} FROM ${current} GROUP BY ${keys.join(',')} HAVING count(DISTINCT nullif(trim(CAST(${q('Stripped.Sequence')} AS VARCHAR)),'')) >= ${cfg.minimum_distinct_peptides})`);}
  if(cfg.require_proteotypic_group)await apply('group has passing Proteotypic==1; retain shared rows',`${pg} IN (SELECT ${pg} FROM ${current} WHERE try_cast(${q('Proteotypic')} AS DOUBLE)=1)`);
  if(await scalar(`SELECT count(*) AS n FROM ${current} WHERE ${pg} IS NULL OR trim(CAST(${pg} AS VARCHAR))=''`))throw Error('Protein.Group 不能为空。');
  const val=`try_cast(${quantity} AS DOUBLE)`;
  if(await scalar(`SELECT count(*) AS n FROM ${current} WHERE ${quantity} IS NOT NULL AND lower(trim(CAST(${quantity} AS VARCHAR))) NOT IN ('','na','nan','null') AND (NOT coalesce(isfinite(${val}),false) OR ${val}<0)`))throw Error('PG.MaxLFQ 含负数或无效数值。');
  const conflicts=(await conn.query(`SELECT CAST(${run} AS VARCHAR) AS run,CAST(${pg} AS VARCHAR) AS id FROM ${current} GROUP BY ${run},${pg} HAVING count(DISTINCT CASE WHEN isfinite(${val}) THEN ${val} ELSE NULL END)>1 LIMIT 1`)).toArray();
  if(conflicts.length)throw Error(`同一 Run/Protein.Group 的 PG.MaxLFQ 不一致：${conflicts[0].run}/${conflicts[0].id}；不能直接求和或平均。`);
  const ids=(await conn.query(`SELECT CAST(${pg} AS VARCHAR) AS id,min(ea_ordinal) AS first FROM ${current} GROUP BY ${pg} ORDER BY first LIMIT ${LIMITS.features+1}`)).toArray().map(r=>r.id);
  if(ids.length>LIMITS.features||ids.length*samples.length>LIMITS.cells)throw Error('矩阵超过特征/数值单元上限。');
  const values=ids.map(()=>samples.map(()=>null));const fi=new Map(ids.map((id,i)=>[id,i])),sj=new Map(samples.map((s,i)=>[s,i]));
  onProgress('行过滤已完成，正在核对并提取每个 run/蛋白组的一致定量值。');
  const aggregated=await conn.query(`SELECT CAST(${run} AS VARCHAR) AS run,CAST(${pg} AS VARCHAR) AS id,min(CASE WHEN isfinite(${val}) THEN ${val} ELSE NULL END) AS value FROM ${current} GROUP BY ${run},${pg}`);
  for(const row of aggregated)values[fi.get(row.id)][sj.get(row.run)]=row.value??null;
  const retained=(await conn.query(`SELECT CAST(${run} AS VARCHAR) AS run,count(*) AS rows,count(DISTINCT ${pg}) AS groups FROM ${current} GROUP BY ${run}`)).toArray();const kept=new Map(retained.map(r=>[r.run,r]));
  return validateDataset({mode:'proteomics',scale:'linear',featureIds:ids,sampleIds:samples,values,metadata:{inputType:'DIA-NN main report',quantification:'PG.MaxLFQ'},audit:{sourceRows:n,retainedRows:remaining,precursorFiltersApplied:true,filters:cfg,stages,runCounts:runRows.map(r=>({run:r.run,input_rows:Number(r.n),output_rows:Number(kept.get(r.run)?.rows??0),groups:Number(kept.get(r.run)?.groups??0)})),notes:['主报告在 DuckDB 中投影/筛选/检查，未把全部前体行复制到 JavaScript。上游 PG.MaxLFQ 不重算，重复值不相加。']}});
}
