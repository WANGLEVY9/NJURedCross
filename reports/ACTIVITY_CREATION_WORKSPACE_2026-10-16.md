# Activity creation workspace refinement

## Scope and design

Native ES modules and CSS; no dependencies or backend changes. The frontend-design and emil-design-eng guidance informed the reading order, themed surfaces, keyboard handling and touch targets.

| Before | After | Reason |
| --- | --- | --- |
| Separate primary owner box | One chip list, creator fixed first | One coherent owner selection model |
| Summary definition list | Live activity preview with title, schedule, description and metrics | Review the activity rather than raw field labels |
| Navigation and section titles differ | 活动信息 / 活动安排 / 时长分配 throughout | Predictable section navigation |
| Browser-owned calendar | Theme-aware Gregorian calendar and hour/minute/second editor | Consistent UI while retaining manual input |

The creator remains the existing primary owner in API semantics. Additional owners alone populate `coOwners`. Editing existing activities retains the existing owner rather than transferring ownership to the editor. No permission, approval, capacity or submission contracts change.

The preview uses current form values and explicit placeholders, not invented activity data. Its capacity figures remain recommendation/registration limits. Grouped activities still require the existing post-approval position configuration.

The calendar preserves the labeled datetime-local control, seconds and local wall-clock value. Apply commits; Cancel/Escape discard the temporary date selection. Keyboard arrows, Home/End and month/year paging work. Closing the drawer disposes keyboard bindings. Invalid end-before-start values still block submission.

## Reliability checks

- Fixed-owner ordering and removal protection, including late directory refresh.
- Live preview updates and original payload structure.
- Section navigation and unsaved draft protection.
- Person-picker Escape no longer also opens the drawer discard confirmation.
- Calendar commit/cancel, focus restoration, leap years, bounds, disabled fields and no implicit timezone conversion.
- Save ambiguity, draft preservation after approval failure, edit/copy/source-adoption and agent handoff regression tests.

Local `npm run verify` passed: 1,920 Node tests passed, two skipped, zero failures (plus the permission/identity/profile checks). The initial desktop/mobile browser suite passed 50/50. Additional integrated-calendar and desktop viewport checks cover 1440×900, 1920×1080 and 1280×800. Synthetic tests never write to production business tables or send real mail.

Production acceptance must separately check Actions, release manifest, runtime files and a freshly loaded admin page. Existing operator drafts must not be refreshed or overwritten for acceptance.
