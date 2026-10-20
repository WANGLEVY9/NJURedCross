# Optional web typography sources

These are SIL OFL 1.1 web subsets generated from pinned upstream releases.
`manifest.json` records source URLs, commits, SHA256, sizes and character counts.
Each family retains its upstream license in this directory.

The deployed application prefers the device's installed CJK families and does
not request these files. They remain as optional offline/specimen assets; adding
them to a page costs several megabytes and must be treated as a deliberate
performance trade-off.

| CSS family | Original | Role |
| --- | --- | --- |
| NJU Heading | Adobe Source Han Sans SC | Chinese headings and actions |
| NJU Information | Adobe Source Han Serif SC | Chinese information and inputs |
| NJU Annotation | LXGW WenKai | Chinese annotations |

The derivative names avoid Adobe's reserved `Source` font name. Latin glyphs
are excluded from these subsets. The Latin fallback files are likewise optional;
normal pages use the device's Times New Roman and then the platform serif stack.

Run `python scripts/build-web-fonts.py` in an environment with `fonttools` and
`brotli`. The generator downloads source files to the OS temporary directory,
collects static CJK characters from the application into core files, then groups
remaining GB2312 characters into demand-loaded shards. New content is not
restricted to the static application vocabulary; rare characters outside this
repertoire use the system Chinese fallback. Production browsers contact
only this site's own font URLs; no third-party font service is required.

`font-display: swap` would keep an optional specimen usable while fonts load or
if they fail, but it is not part of the application startup path.
