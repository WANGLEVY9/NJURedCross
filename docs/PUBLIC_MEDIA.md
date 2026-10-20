# Public media delivery

The homepage and activity plaza keep their supplied photographs, crops, article
links and typefaces. `public/app/portal/media-manifest.js` maps each supplied
source to responsive, content-addressed WebP derivatives. Originals and derived
photos are managed separately from Git and source deployment archives.

## Prepare and publish photographs

Put the three authorized article originals in a private working directory as
`cover-1.jpg` through `cover-3.jpg`, and the four volunteer originals as
`volunteer-01.jpg` through `volunteer-04.jpg`. Existing volunteer originals live
in `/opt/njuredcross/public/assets/volunteers/` on the server. Activity originals
are the existing `public/assets/events-carousel/activity-01.webp` through `06`.

Run `node scripts/build-public-media.mjs /path/to/authorized-originals` from the
repository. This retains the article cover crop and builds 480, 960 and 1600px
variants, capped at the original width. It writes only derivatives to the
ignored directory `public/assets/volunteers/optimized/`, plus the source mapping
module. Inspect the mapping diff and publish the derivatives to that same path
on the server **before** releasing code that references them. Use an archive
without resource forks or extended attributes, for example:

```sh
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/public-media.tar.gz -C public/assets/volunteers optimized
scp /tmp/public-media.tar.gz njuredcross:/tmp/public-media.tar.gz
ssh njuredcross 'tar -xzf /tmp/public-media.tar.gz -C /opt/njuredcross/public/assets/volunteers'
```

Verify every referenced file's SHA-256 and an HTTPS response before publishing
its source mapping. Keep old variants for rollback; code deployment does not
remove these independently managed files. Do not put photos, tokens or server
configuration into Git. If managed media is unavailable, the client tries the
original source, then retains the prior carousel frame or shows an explicit
placeholder. Article links continue pointing to the supplied original article.

## Loading and caching

The first hero is eager and high priority. Offscreen volunteer photos are lazy;
responsive sizes avoid full-resolution downloads on phones. Carousels keep at
most three frames and prefetch only the next image after the displayed image
loads, excluding hidden tabs, data-saving mode and very slow connections. A
replacement frame is shown only after loading and decoding; failed switches
retain the displayed photograph. Auto-rotation pauses for focus, hover, hidden
tabs and reduced-motion preferences.

Only a matching full SHA-256 `v` parameter enables immutable caching for fonts
and raster images. Incorrect or absent hashes still require revalidation. The
UI shell and scripts keep their deployment-safe cache policies.

## Portal typography

`events-fonts.css` is deferred with the application styles, so a delayed font
stylesheet cannot block the independent startup script. The activity title and
running brand use their original fonts. Compact regular/bold UI faces derive
from the existing licensed font files; other characters use the system fallback.
To rebuild after changing portal copy, run
`python3 scripts/build-portal-ui-fonts.py` with fonttools and brotli installed.
The existing typography builder also runs this final compaction step.

Browser regressions cover delayed styles, bounded font delivery, responsive
layout at narrow widths and zoom, same-origin images, and slow/failed carousel
switches. These use synthetic business fixtures, never production tables.
