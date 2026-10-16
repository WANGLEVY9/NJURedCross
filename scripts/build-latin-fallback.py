"""Small OFL serif fallback for devices without licensed Times New Roman."""
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
from fontTools import subset
from fontTools.ttLib import TTFont

base = 'https://raw.githubusercontent.com/google/fonts/1d0e46c7933245c8180fe83e47917961c913bbdb/ofl/tinos/'
output = Path(__file__).resolve().parents[1] / 'public/assets/fonts/roles'
output.mkdir(parents=True, exist_ok=True)
manifest = []
for weight, name in [(400, 'Regular'), (700, 'Bold')]:
    url = base + f'Tinos-{name}.ttf'
    with urlopen(url, timeout=60) as response:
        raw = response.read()
    font = TTFont(io.BytesIO(raw))
    options = subset.Options()
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=list(range(0x250)) + list(range(0x1E00, 0x2070)))
    sub.subset(font)
    font.flavor = 'woff2'
    file = f'latin-{weight}.woff2'
    font.save(output / file)
    manifest.append({'file': file, 'source': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': (output / file).stat().st_size})
with urlopen('https://raw.githubusercontent.com/googlefonts/tinos/3b4482a99b80ea5fc75f187b1be3120a3f5905b3/OFL.txt', timeout=60) as response:
    license_text = response.read().decode('utf-8')
    (output / 'latin-LICENSE.txt').write_text('\n'.join(line.rstrip() for line in license_text.splitlines()) + '\n')
(output / 'latin-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
