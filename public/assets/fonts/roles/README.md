# Web typography sources

These are SIL OFL 1.1 web subsets generated from pinned upstream releases.
`manifest.json` records source URLs, commits, SHA256, sizes and character counts.
Each family retains its upstream license in this directory.

| CSS family | Original | Role |
| --- | --- | --- |
| NJU Heading | Adobe Source Han Sans SC | Chinese headings and actions |
| NJU Information | Adobe Source Han Serif SC | Chinese information and inputs |
| NJU Annotation | LXGW WenKai | Chinese annotations |

The derivative names avoid Adobe's reserved `Source` font name. Latin glyphs
are excluded from these subsets. The CSS stack uses the device's Times New Roman
first, and the bundled OFL Tinos serif fallback if absent; no proprietary font is
distributed. `scripts/build-latin-fallback.py` generates this small Latin subset;
its sources are recorded separately in `latin-manifest.json`.

Run `python scripts/build-web-fonts.py` in an environment with `fonttools` and
`brotli`. The generator downloads source files to the OS temporary directory,
collects static CJK characters from the application into core files, then groups
remaining GB2312 characters into demand-loaded shards. New content is not
restricted to the static application vocabulary; rare characters outside this
repertoire use the system Chinese fallback. Production browsers contact
only this site's own font URLs; no third-party font service is required.

`font-display: swap` keeps the interface usable while fonts load or if they fail.
