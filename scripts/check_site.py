"""Check rendered local links/anchors and accidental private files before publication."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import argparse, json, re, sys, posixpath

class Page(HTMLParser):
    def __init__(self,text):
        super().__init__();self.ids=set();self.refs=[];self.feed(text)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id' in a:self.ids.add(a['id'])
        for key in ('href','src'):
            if a.get(key):self.refs.append(a[key])

def main():
    cli=argparse.ArgumentParser();cli.add_argument('site');cli.add_argument('--public',action='store_true');args=cli.parse_args()
    root=Path(args.site).resolve();pages={p.resolve():Page(p.read_text(encoding='utf-8')) for p in root.rglob('*.html')}
    errors=[]
    for p,page in pages.items():
        for ref in page.refs:
            url=urlsplit(ref)
            if url.scheme or url.netloc:continue
            target=(root/unquote(url.path.lstrip('/')) if url.path.startswith('/') else p.parent/unquote(url.path)).resolve() if url.path else p
            if target.is_dir():target=target/'index.html'
            if not target.is_relative_to(root) or not target.exists():
                errors.append({'page':str(p.relative_to(root)),'reference':ref,'error':'missing local target'})
            elif url.fragment and target.suffix=='.html' and not url.fragment.startswith(('tabset-','cb')):
                anchor=unquote(url.fragment)
                if target in pages and anchor not in pages[target].ids:
                    errors.append({'page':str(p.relative_to(root)),'reference':ref,'error':'missing anchor'})
            if url.path and target.is_relative_to(root) and target.exists():
                logical=posixpath.normpath(unquote(url.path).lstrip('/') if url.path.startswith('/') else posixpath.join(p.relative_to(root).parent.as_posix(),unquote(url.path)))
                current=root
                for part in logical.split('/'):
                    if part in ('','.'):continue
                    if part=='..':break
                    if current.is_dir() and part not in {child.name for child in current.iterdir()}:
                        errors.append({'page':str(p.relative_to(root)),'reference':ref,'error':'filename case mismatch'})
                        break
                    current=current/part
    if args.public:
        forbidden_ext={'.pdf','.docx','.doc','.pptx','.xlsx'}
        for p in root.rglob('*'):
            if p.is_file() and (p.suffix.lower() in forbidden_ext or any(x in p.relative_to(root).parts for x in ('history','tmp','views','output'))):
                errors.append({'file':str(p.relative_to(root)),'error':'unapproved public file'})
            if p.is_file() and p.suffix=='.html':
                text=p.read_text(encoding='utf-8')
                if re.search(r'OneDrive|file:///[A-Z]:|[A-Z]:\\\\',text,re.I):
                    errors.append({'file':str(p.relative_to(root)),'error':'private identifier or local path'})
    print(json.dumps({'html_pages':len(pages),'files':sum(p.is_file() for p in root.rglob('*')),'errors':errors},ensure_ascii=False,indent=2))
    if errors:sys.exit(1)

if __name__=='__main__':main()
