"""Split complete OFL fonts into a preloaded core and disjoint Unicode shards.

Requires fonttools[woff]. Sources are cached outside public/; all original
Unicode characters and variable weight axes remain available in the shards.
"""
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
import hashlib
import io
import json
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / 'public/assets/fonts'
OUTPUT = FONTS / 'plaza'
CACHE = ROOT / '.cache/plaza-font-sources'
SPECS = [
    ('sans', 'Plaza Sans', 'Noto Sans SC', 'noto-sans-sc-full.woff2', '100 900', 'notosanssc/NotoSansSC%5Bwght%5D.ttf', 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'),
    ('serif', 'Plaza Serif', 'Noto Serif SC', 'noto-serif-sc-full.woff2', '200 900', 'notoserifsc/NotoSerifSC%5Bwght%5D.ttf', '050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9'),
    ('running', 'Plaza Running', 'Zhi Mang Xing', 'zhi-mang-xing-full.woff2', '400', 'zhimangxing/ZhiMangXing-Regular.ttf', '644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969'),
]


def ranges(points):
    groups = []
    for point in sorted(points):
        if groups and groups[-1][1] + 1 == point:
            groups[-1][1] = point
        else:
            groups.append([point, point])
    return ','.join(f'U+{a:X}' + (f'-{b:X}' if a != b else '') for a, b in groups)


def points_from_ranges(value):
    points = set()
    for group in value.split(','):
        ends = group.removeprefix('U+').split('-')
        first, last = int(ends[0], 16), int(ends[-1], 16)
        points.update(range(first, last + 1))
    return points


def prepare_source(spec):
    _, _, _, filename, _, upstream, expected = spec
    cached = CACHE / filename
    if not cached.exists():
        existing = FONTS / filename
        if existing.exists():
            cached.write_bytes(existing.read_bytes())
        else:
            url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/' + upstream
            with urllib.request.urlopen(url, timeout=60) as response:
                content = response.read()
            if hashlib.sha256(content).hexdigest() != expected:
                raise ValueError('Upstream font hash changed: ' + filename)
            font = TTFont(io.BytesIO(content), recalcTimestamp=False)
            font.flavor = 'woff2'
            font.save(cached)
    return str(cached)


def build_font(job):
    spec, source_path, requested = job
    key, family, original, _, weight, upstream, source_sha = spec
    original_font = TTFont(source_path, recalcTimestamp=False)
    coverage = set(original_font.getBestCmap())
    units = original_font['head'].unitsPerEm
    metrics = dict(ascent=original_font['hhea'].ascent / units * 100,
                   descent=-original_font['hhea'].descent / units * 100,
                   lineGap=original_font['hhea'].lineGap / units * 100)
    axes = {axis.axisTag: [axis.minValue, axis.maxValue] for axis in original_font['fvar'].axes} if 'fvar' in original_font else {}
    raw = None
    core = coverage & set(requested)
    manifest = FONTS / 'plaza-manifest.json'
    previous = next((entry for entry in json.loads(manifest.read_text(encoding='utf-8')) if entry.get('family') == family and entry.get('sourceSha256') == source_sha), {}) if manifest.exists() else {}
    cached_files = {entry['file']: entry for entry in previous.get('files', [])}
    # Stable shard boundaries avoid rebuilding every file when one UI word changes.
    chunks, covered = [('core', core)], set(core)
    for entry in previous.get('files', []):
        if entry['file'] == f'{key}-core.woff2':
            continue
        points = (points_from_ranges(entry['unicodeRange']) & coverage) - core
        if points:
            chunks.append((Path(entry['file']).stem.removeprefix(key + '-'), points))
            covered |= points
    remaining = sorted(coverage - covered)
    next_index = 1 + max((int(name) for name, _ in chunks if name != 'core'), default=-1)
    chunks += [(f'{next_index + index // 1024:03d}', set(remaining[index:index + 1024])) for index in range(0, len(remaining), 1024)]
    files, css, seen = [], [], set()
    for name, points in chunks:
        assert not seen & points
        seen |= points
        path = OUTPUT / f'{key}-{name}.woff2'
        span = ranges(points)
        cached = cached_files.get(path.name, {})
        if not (cached.get('unicodeRange') == span and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == cached.get('sha256')):
            if raw is None:
                original_font.flavor = None
                buffer = io.BytesIO()
                original_font.save(buffer)
                raw = buffer.getvalue()
            font = TTFont(io.BytesIO(raw), recalcTimestamp=False)
            options = subset.Options()
            options.layout_features = ['*']
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=points)
            subsetter.subset(font)
            assert set(font.getBestCmap()) == points
            assert ({axis.axisTag: [axis.minValue, axis.maxValue] for axis in font['fvar'].axes} if 'fvar' in font else {}) == axes
            font.flavor = 'woff2'
            temporary = path.with_suffix('.woff2.tmp')
            font.save(temporary)
            temporary.replace(path)
        files.append(dict(file=path.name, characters=len(points), bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), unicodeRange=span))
        css.append(f"@font-face{{font-family:'{family}';src:url('/assets/fonts/plaza/{path.name}') format('woff2');font-style:normal;font-weight:{weight};font-display:optional;unicode-range:{span};}}")
    assert seen == coverage, 'Incomplete Unicode coverage'
    print(f'{family}: core {len(core)} characters, {files[0]["bytes"]} bytes; retained {len(coverage)} characters in {len(files)} files', flush=True)
    return dict(font=original, family=family, sourceUrl='https://raw.githubusercontent.com/google/fonts/main/ofl/' + upstream,
                sourceSha256=source_sha, license='SIL Open Font License 1.1', characters=len(coverage), axes=axes, metrics=metrics, files=files), css


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    ascii_and_punctuation = set(range(32, 127)) | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
    static = ''.join(path.read_text(encoding='utf-8') for path in (ROOT / 'public').rglob('*') if path.suffix in {'.html', '.js'})
    sans = {ord(c) for c in static if ord(c) >= 32} | ascii_and_punctuation
    showcase = (ROOT / 'public/app/portal/events-showcase.js').read_text(encoding='utf-8')
    serif = {ord(c) for c in ''.join(re.findall(r"(?:title|motto):\s*'([^']*)'", showcase)) + '校园里的每一份善意人道 · 博爱 · 奉献'} | ascii_and_punctuation
    running = {ord(c) for c in '南京大学红十字会'}
    jobs = [(spec, prepare_source(spec), points) for spec, points in zip(SPECS, [sans, serif, running])]
    with ProcessPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(build_font, jobs))
    entries = [entry for entry, _ in results]
    css = '\n'.join(rule for _, rules in results for rule in rules)
    fallback = []
    for key, name, local_names, weight in [
        ('sans', 'Plaza Sans Fallback', ['Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC'], '100 599'),
        ('sans', 'Plaza Sans Fallback', ['Microsoft YaHei Bold', 'PingFangSC-Semibold', 'Noto Sans CJK SC Bold'], '600 900'),
        ('serif', 'Plaza Serif Fallback', ['SimSun', 'Songti SC', 'Noto Serif CJK SC'], '200 900'),
        ('running', 'Plaza Running Fallback', ['STXingkai', 'KaiTi', 'STKaiti'], '400'),
    ]:
        metrics = entries[['sans', 'serif', 'running'].index(key)]['metrics']
        sources = ','.join(f"local('{local}')" for local in local_names)
        fallback.append(f"@font-face{{font-family:'{name}';src:{sources};font-weight:{weight};size-adjust:100%;ascent-override:{metrics['ascent']:.2f}%;descent-override:{metrics['descent']:.2f}%;line-gap-override:{metrics['lineGap']:.2f}%;}}")
    (ROOT / 'public/styles/events-fonts.css').write_text('/* Generated by scripts/build-plaza-fonts.py. Disjoint ranges preserve full glyph coverage. */\n' + css + '\n' + '\n'.join(fallback) + '\n', encoding='utf-8')
    (FONTS / 'plaza-manifest.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
