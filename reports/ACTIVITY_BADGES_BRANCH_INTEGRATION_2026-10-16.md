# Activity badges branch integration

Reviewed branch: `origin/feat/activity-center-badges` at `bbac11db172feac189b5fdf5511086d50134dd1c`.
Integration base: main `012b32d798737e87e82acecf8d59214697ec740b`.

The requested branch exists under `feat/`, not `feature/`. It already contains the latest main as an ancestor, so Git reports no textual conflict. Its tree nevertheless contains semantic regressions from an earlier main merge. The merge commit retains the developer history and explicitly resolves those regressions in favour of main.

## Integrated design

- Six illustrated category emblems, compact date tiles, round activity cards and category label colours; completed the missing 一加助残专项 colour.
- Activity plaza introduction uses the shared plaza header, preserving its live result count and existing filters/URLs.
- Activity detail fact text and section label sizing. The branch introduces no new font binary or font family; existing self-hosted NJU Sans/Serif remain authoritative.
- Blood calendar mobile date-cell containment, week jump dialog and associated browser checks.
- Synthetic category-label preview mode, without production data writes.

## Semantic conflicts resolved

The branch's changes to `lib/events`, `server.js`, shared roster semantics and public registration/cancellation workflows are excluded from this design merge. In particular, main keeps:

- category authority, multiple assigned reviewers and approval return/notification behaviour;
- event time windows and approved project position generation/publication;
- catalog/detail demand loading, scoped reads and bounded profile lookup concurrency;
- owner assignment/version checks;
- signed check-in tickets and existing registration/leave/roster rules.

The older `eventCenterLabel()` would collapse 一加助残专项 into 博爱中心 and rename 主席团专项 to 主席团. Main's canonical six-category taxonomy remains in use, with blood programme handling unchanged.

## Integration corrections

- Week selection marks all seven selected dates and supplies grid row semantics.
- Month navigation moves focus and selection into the displayed month; PageUp/PageDown support year paging with Shift.
- Mobile picker remains a bottom sheet with scrolling on short displays. Tests distinguish its placement from desktop centering and wait for entry animation before measuring.
- Activity plaza bottom spacing retains the existing compact footer flow.

Validation uses isolated synthetic browser fixtures. Deployment and live acceptance are checked separately through Actions, the server release manifest/runtime hashes, and public pages.

Local results: `npm run verify` passed (1,920 Node tests passed, two skipped, zero failures, plus permission/identity/profile checks); lint passed after integration corrections. The targeted desktop/mobile Chromium suite passed 52 tests, with four desktop-only geometry cases intentionally skipped on mobile. Screenshots cover six categories at 1440px/1920px desktop and 390px mobile, five-theme card facts/actions, and week selection.
