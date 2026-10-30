"""Build the PDF font from the pinned Kai source. Requires fonttools + brotli.

Usage: python scripts/build-finance-report-font.py /path/to/LXGWWenKai-Regular.ttf
The source URL/hash and OFL license are in public/assets/fonts/roles/manifest.json.
The renamed PDF-only subset does not change browser fonts or stylesheets.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    source = ROOT / 'public/assets/fonts/roles'
    manifest = json.loads((source / 'manifest.json').read_text())
    entry = next(x for x in manifest if x['family'] == 'NJU Annotation' and x['weight'] == 400)
    raw = Path(sys.argv[1]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError('Pinned source font checksum mismatch')
    characters = set(range(32, 256)) | set(range(0x2000, 0x2070)) | set(range(0x20A0, 0x20D0))
    for item in entry['files']:
        with TTFont(source / item['file']) as shard:
            characters.update(shard.getBestCmap())
    font = TTFont(sys.argv[1], recalcTimestamp=False)
    options = Options()
    options.layout_features = []
    worker = Subsetter(options=options)
    worker.populate(unicodes=characters)
    worker.subset(font)
    names = {1: 'NJU Finance Report', 2: 'Regular', 3: 'NJUFinanceReport-Regular',
             4: 'NJU Finance Report Regular', 6: 'NJUFinanceReport-Regular',
             16: 'NJU Finance Report', 17: 'Regular', 18: 'NJU Finance Report Regular'}
    for record in font['name'].names:
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    target = ROOT / 'public/assets/fonts/finance-report.ttf'
    font.save(target)
    print(json.dumps({'bytes': target.stat().st_size, 'characters': len(font.getBestCmap()),
                      'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
