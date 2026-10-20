"""Build compact portal faces from the already licensed, tracked CJK fonts.

Requires fonttools and brotli. Other characters retain the system-font fallback;
the fixed activity title and running wordmark preserve their original typefaces.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def main():
    text = ''.join(p.read_text() for p in (ROOT / 'public/app/portal').rglob('*.js'))
    text += (ROOT / 'public/app/shared/activity-taxonomy.js').read_text()
    chars = {ord(c) for c in re.findall('[\u3400-\u9fff]', text)} | set(range(32, 127))
    rules, records = [], []
    for weight in (400, 700):
        source = ROOT / f'public/assets/fonts/roles/sans-{weight}-core.woff2'
        font = TTFont(source, recalcTimestamp=False)
        supported = chars & set().union(*(set(t.cmap) for t in font['cmap'].tables))
        options = subset.Options()
        options.layout_features = ['kern', 'liga']
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=supported)
        worker.subset(font)
        target = ROOT / f'public/assets/fonts/events/ui-{weight}.woff2'
        font.save(target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        ranges = ','.join(f'U+{c:X}' for c in sorted(supported))
        rules.append(f'@font-face{{font-family:"NJU Heading";font-style:normal;font-weight:{weight};font-display:swap;src:url("/assets/fonts/events/ui-{weight}.woff2?v={digest}") format("woff2");unicode-range:{ranges};}}')
        records.append(dict(weight=weight, characters=len(supported), bytes=target.stat().st_size, sha256=digest))
    for name, family, weight in [('title', 'Events Serif', '200 900'), ('wordmark', 'Events Running', '400')]:
        target = ROOT / f'public/assets/fonts/events/{name}.woff2'
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        rules.append(f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};font-display:swap;src:url("/assets/fonts/events/{name}.woff2?v={digest}") format("woff2");}}')
    (ROOT / 'public/styles/events-fonts.css').write_text('/* Compact portal UI subsets; licensed typefaces with system fallback for other characters. */\n' + '\n'.join(rules) + '\n')
    (ROOT / 'public/assets/fonts/events/ui-manifest.json').write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps(records))


if __name__ == '__main__':
    main()
