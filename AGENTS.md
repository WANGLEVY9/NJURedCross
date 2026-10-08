# Repository Working Rules

## Active Feature Branch

The active feature for this checkout is:

```text
codex/morning-evening-card
```

Unless the user explicitly redirects the work:

- Do all edits and commits on `codex/morning-evening-card`.
- Do not switch to or modify `feature-birthday-blessings`.
- Do not push to any GitHub remote without an explicit user instruction.
- Keep `command.md` untracked and out of commits.

If the checkout is on a different branch before implementation starts, stop and report the mismatch instead of silently moving user changes.

## Module Isolation

“早安晚安” is an independent business module from “生日祝福”.

The module may reuse shared platform infrastructure:

- authentication and sessions;
- permissions and CSRF;
- SeaTable access;
- mail delivery;
- audit logging;
- design tokens and generic UI primitives.

It must not reuse birthday-specific state machines, tables or submission flows.

## Preferred File Boundaries

Put module-owned code in dedicated paths:

```text
lib/morning/                         backend domain logic
public/app/portal/pages/morning.js   public plaza page
public/app/portal/morning-*.js       public card/detail/comment components
public/app/console/pages/morning.js  admin review page
public/styles/morning.css            module-specific styles
scripts/*morning*.mjs                preflight, schema, smoke and operations tools
tests/*morning*.test.mjs             module regression tests
```

Shared files must be changed only as minimal additive integration points:

- `server.js`: route dispatch and module mounting only.
- `public/app/main.js`: route registration only.
- `public/app/core/api.js`: namespaced client methods only.
- `lib/production-schema.js`: append module tables and columns only.
- `package.json`: module scripts and required dependencies only.
- shared CSS or UI primitives: only when a genuinely reusable control is missing.

Do not modify birthday blessing functions, tables or UI while implementing this module.

## Product Boundary

The first version of “早安晚安” contains:

- member card submission;
- admin review;
- public plaza;
- card detail;
- comments;
- email notification for comments;
- optional public QQ, WeChat or other contact information.

The first version explicitly excludes:

- likes;
- like counts;
- like notifications;
- like tables;
- like API routes;
- like-related UI or tests.

## Required Workflow

For every round of implementation:

1. Check `git status --short --branch`.
2. Confirm the branch is `codex/morning-evening-card`.
3. Identify module-owned files versus shared integration points.
4. Make the smallest additive change that satisfies the request.
5. Add or update focused tests.
6. Run `npm run verify`; run module smoke/preflight commands when relevant.
7. Commit that round on the same branch.
8. Report the commit hash and any residual risk.

Do not mix unrelated birthday, material, event, outreach or identity refactors into this branch.
