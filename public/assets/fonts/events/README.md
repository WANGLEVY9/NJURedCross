# Activity plaza typography

The plaza uses the existing OFL Source Han Sans SC derivatives (`NJU Heading`)
in `../roles`, at regular and bold weights. GB2312 glyph shards load on demand;
additional characters fall back to installed Chinese fonts.

`title.woff2` is a variable Noto Serif SC subset containing the fixed Chinese
hero title and motto. `wordmark.woff2` is a Zhi Mang Xing subset containing the
eight Chinese characters in the society name. The corresponding OFL licenses
are included here. The generated manifest records file hashes and glyphs.

Run `python scripts/build-events-typography.py` with fonttools/brotli and the
original WOFF2 sources in `.cache/plaza-font-sources`. The large original
fonts are not published. Every face uses `font-display: optional` to prevent
late font swaps; slow or failed loads retain the local Chinese fallback for
that page visit. Styles are scoped to the activity plaza and its preview.
