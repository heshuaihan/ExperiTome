"""Generate display metadata from canonical Chinese module front matter."""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[1]

def scalar(text, key):
    match = re.search(r'^' + re.escape(key) + r':\s*(.*?)\s*$', text, re.M)
    return match.group(1).strip('"\'') if match else ''

def main():
    modules=[]
    for path in (ROOT / 'protocols/modules').glob('*.qmd'):
        head = path.read_text(encoding='utf-8').split('---', 2)[1]
        identity, version = scalar(head, 'protocol_id'), scalar(head, 'version')
        date = scalar(head, 'presentation_updated') or scalar(head, 'last_reviewed')
        content = f'::: {{.protocol-meta}}\n[{identity}]{{.badge-soft}} [草案]{{.badge-soft .badge-draft}} 方法 v{version} · 中文详细版 · 页面修订 {date}\n:::\n'
        target = path.parent / '_meta' / (identity + '.md')
        target.parent.mkdir(exist_ok=True)
        if not target.exists() or target.read_text(encoding='utf-8') != content:
            target.write_text(content, encoding='utf-8')
        modules.append((int(scalar(head,'order') or '100'),scalar(head,'title'),scalar(head,'description'),version,path))
    rows=['| 操作模块 | 用途与输出 | 方法版本 |','|---|---|---|']
    for _,title,desc,version,path in sorted(modules):
        rows.append(f'| [{title}]({path.relative_to(ROOT).as_posix()}) | {desc.replace(chr(124), chr(92)+chr(124))} | v{version} |')
    (ROOT/'_modules.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
    (ROOT/'protocols/_modules.md').write_text(('\n'.join(rows)+'\n').replace('](protocols/', ']('),encoding='utf-8')
    rows=['| 配液 | 用途 |','|---|---|']
    for path in sorted((ROOT/'materials/buffers').glob('BUF*.qmd')):
        head=path.read_text(encoding='utf-8').split('---',2)[1]
        rows.append(f'| [{scalar(head,"title")}]({path.name}) | {scalar(head,"description")} |')
    (ROOT/'materials/buffers/_index.md').write_text('\n'.join(rows)+'\n',encoding='utf-8')
    # Keep the version overview synchronized with canonical front matter.
    version_index=ROOT/'review/versions/index.qmd'
    if version_index.exists():
        text=version_index.read_text(encoding='utf-8')
        for _,_,_,version,path in modules:
            identity=scalar(path.read_text(encoding='utf-8').split('---',2)[1],'protocol_id')
            text=re.sub(r'(\| '+re.escape(identity)+r' \| )[^|\n]+(\|)',lambda m:m[1]+version+' '+m[2],text)
        version_index.write_text(text,encoding='utf-8')

if __name__ == '__main__':
    main()
