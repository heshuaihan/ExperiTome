"""Verify the pinned Alliance method package before Pages publication."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def verify(directory, pin_path):
    directory = Path(directory).resolve()
    pin = json.loads(Path(pin_path).read_bytes())
    raw = (directory / 'manifest.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != pin['manifest_sha256']:
        raise ValueError('method manifest SHA-256 mismatch')
    manifest = json.loads(raw)
    if manifest['format'] != 'experiatlas-method-support-1' or manifest['source']['fms_datafile_id'] != pin['fms_datafile_id']:
        raise ValueError('unexpected method source')
    if manifest['snapshot']['file_version'] != pin['file_version'] or manifest['snapshot']['stable_url_probe']['sha256'] != pin['source_file_sha256']:
        raise ValueError('unexpected upstream file version or digest')
    if manifest['method_universe_complete'] is not True:
        raise ValueError('complete method catalogues required')
    for pair in ('worm/mouse','mouse/worm','worm/human','human/worm','mouse/human','human/mouse'):
        catalogue = manifest['method_universes'][pair]
        expected = 10 if set(pair.split('/')) == {'mouse','human'} else 9
        if catalogue['complete'] is not True or len(set(catalogue['methods'])) != expected or catalogue['available_method_count'] != expected:
            raise ValueError('incomplete species-pair catalogue')
    shards = manifest['shards']
    if len(shards) != pin['shard_count'] or set(shards) != {format(i,'02x') for i in range(256)}:
        raise ValueError('unexpected shard set')
    expected_files = {'manifest.json', 'NOTICE.txt'}
    total = 0
    for prefix, entry in shards.items():
        if entry['path'] != f'shards/{prefix}.json.gz' or not re.fullmatch('[a-f0-9]{64}',entry['sha256']):
            raise ValueError('unsafe shard path or invalid digest')
        path = directory / entry['path']
        if path.is_symlink() or not path.resolve().is_relative_to(directory):
            raise ValueError('shard escapes package')
        data = path.read_bytes()
        if len(data) != entry['bytes'] or len(data) > 8*1024*1024 or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('method shard integrity failure')
        with gzip.open(path, 'rb') as stream:
            decoded = stream.read(32*1024*1024 + 1)
        if len(decoded) > 32*1024*1024 or not isinstance(json.loads(decoded),dict):
            raise ValueError('invalid decoded method shard')
        expected_files.add(entry['path'])
        total += len(data)
    actual_files = {path.relative_to(directory).as_posix() for path in directory.rglob('*') if path.is_file()}
    if actual_files != expected_files or total != pin['compressed_bytes']:
        raise ValueError('unlisted or missing package files, or byte total mismatch')
    return {'status':'verified','shards':len(shards),'compressed_bytes':total,'manifest_sha256':pin['manifest_sha256']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=ROOT/'_site/atlas/method-support')
    parser.add_argument('--pin',type=Path,default=ROOT/'atlas/method-support-release.json')
    args = parser.parse_args()
    print(json.dumps(verify(args.directory,args.pin),indent=2))
