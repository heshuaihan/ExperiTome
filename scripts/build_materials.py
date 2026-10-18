"""Build the same detailed, source-bounded reagent index locally and publicly."""
from pathlib import Path
import csv

def cell(text):
    return (text or '—').replace('|','\\|').replace('\n',' ')

def build(root):
    with (root/'materials/reagent_catalog.csv').open(encoding='utf-8-sig',newline='') as f:
        rows=list(csv.DictReader(f))
    if len({r['entry_id'] for r in rows})!=len(rows):raise ValueError('Duplicate material IDs')
    lines=[f'共 **{len(rows)} 项**材料；其中 **{sum(r.get("core_protocol")=="yes" for r in rows)} 项**关联核心操作模块。',
           '', '## 核心制样与标记材料','',
           '点击材料名称查看配制、保存、来源位置与操作入口。未注明的等级、盐型与批次信息不推定。','',
           '| 材料 / 厂家与货号 | 规格、等级或形式 | 身份状态 |', '|---|---|---|']
    def name(r):
        label=r.get('display_name') or r['product_name']
        profile=r.get('profile_page','')
        if profile:
            if not (root/profile).is_file():raise FileNotFoundError(profile)
            label=f'[{label}](../{profile})'
        return f'{label}<br>{r["manufacturer"]} · **{r["catalog_number"]}**'
    for r in rows:
        if r.get('core_protocol')=='yes':
            lines.append('| '+' | '.join(cell(v) for v in [name(r),r.get('grade_or_form'),r.get('public_status')])+' |')
    categories=list(dict.fromkeys(r.get('category','其他材料') for r in rows if r.get('core_protocol')!='yes'))
    for category in categories:
        lines+=['',f'## {category}','','| 材料 / 厂家与货号 | 规格及来源 | 产品资料 / 状态 |','|---|---|---|']
        for r in rows:
            if r.get('core_protocol')=='yes' or r.get('category','其他材料')!=category:continue
            ref=f'[产品资料]({r["product_url"]})' if r.get('product_url') else '产品资料待关联'
            lines.append('| '+' | '.join(cell(v) for v in [name(r),r.get('grade_or_form','')+'<br>'+r.get('source_locator',''),ref+'<br>'+r.get('public_status','来源记录')])+' |')
    target=root/'materials/_catalog.md'
    text='\n'.join(lines)+'\n'
    if not target.exists() or target.read_text(encoding='utf-8')!=text:target.write_text(text,encoding='utf-8')
    return len(rows)
