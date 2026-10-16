# Activity icons and site typography

## Diagnosis and changes

The previous six icons were CSS masks backed by a separately fetched PNG. A mask
that has not loaded paints nothing, leaving a blank area above the date. On the
live page the PNG eventually returned 200 and the icons appeared; this does not
establish the precise network failure experienced by every user. Merely reducing
the PNG size did not eliminate the dependency.

The shared activity emblem now renders six inline SVG drawings: a team and star,
hands holding a heart, a first-aid kit, a checklist and gear, accessible service,
and a blood-service bus. Paths share a 64-unit canvas, rounded strokes and theme
colour. Both homepage and activity plaza use this component. Category names,
event dates, capacities, links and application behaviour are unchanged.

Typography follows the Owner's requested roles on public and console pages:

| Content | Font |
| --- | --- |
| Chinese headings and actions | Source Han Sans SC |
| Chinese information and inputs | Source Han Serif SC |
| Annotations and field hints | LXGW WenKai, explicitly approved by Owner |
| English and numbers | Local Times New Roman; OFL Tinos fallback if unavailable |

Fonts are self-hosted, with real 400/700 weights for Sans/Serif and 400 for WenKai.
Core files cover application vocabulary; additional GB2312 characters load by
Unicode range. Each family covers about 7,100 characters; rare characters beyond
this repertoire retain system fallback. Full upstream CJK packs are not shipped:
the production receiver has a 32 MiB release-content limit. Browser text uses
`font-display:swap` and never waits for fonts before becoming operable.

Pinned source revisions, SHA256 and SIL OFL licenses accompany the assets. No
commercial Times New Roman files are redistributed. Legacy Noto and PNG assets
are retained for cached clients but are no longer requested by the new UI.

## Verification

- `npm run verify`: 1,920 passed, 2 environment-dependent skips, zero failures.
- Chromium desktop/mobile related suites: 96 passed, 6 intentional desktop-only
  skips on mobile. Covers six categories, navigation, home/plaza density, five
  themes, booking presentation, mobile admin tasks, attendance and hours.
- Firefox/WebKit typography and taxonomy: 8 passed.
- Full desktop accessibility audit exposed insufficient contrast in existing
  success/warning badge text (4.27/4.25). The shared badges now mix their semantic
  colour with text ink; the five-theme desktop audit passed all 20 checks.
- macOS WebKit full workflow suite: 64 passed, 3 intentional skips. Linux CI
  reached the screenshot step but stalled waiting for font readiness; downloaded
  traces showed all requested Chinese font files returned 200. The Latin fallback
  now uses its URL directly instead of redundant local-face lookups (Times New
  Roman remains first in the CSS stack). Font readiness tests are included in the
  cross-engine CI suite; deployment must still pass the complete gate.
- Image/font request failures: inline icons remain visible and navigation works.
- Chrome platform-font inspection confirmed actual custom Heading 700,
  Information 400 and Annotation 400 glyphs; English used TimesNewRomanPSMT.
- Visual inspection: 1440/1920 desktop, 390 mobile cards, font specimen and
  mobile attendance inspector. Samples use isolated synthetic data.

Production release is verified separately using Actions, server manifest hashes
and refreshed live pages; these local checks alone are not deployment evidence.
