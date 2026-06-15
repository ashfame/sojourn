# Sojourn

Timeline-first browser app for tracking where you were, which residency rules you are racing toward or spending down, and which proof supports each stay.

The current product model is intentionally small:

- `Stay`: country, entry date, exit date, label.
- `Evidence`: stay, type, file metadata, date.
- `Rule`: country scope, threshold, direction, window, counting convention.

The app starts empty, asks the user to configure targets first, and treats missing dates between
stays as unaccounted time instead of guessing a home base. The same rule engine powers current
counts and future projections.

## Stack

- React 19 + TypeScript 6 + Vite 8.
- Browser runtime only: static assets, IndexedDB, Web Crypto, and `fetch`.
- IndexedDB is the current local storage backend.
- Storage is accessed through a `StorageDriver` interface so a future remote SQLite snapshot/sync backend can replace or augment IndexedDB without rewriting the UI.

Node is used only for development, build, and tests. The production app is static browser assets.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
```

`npm run test:ui` requires Playwright's Chromium runtime and Linux browser libraries. GitHub Actions installs those dependencies and runs Playwright on every push and pull request to `main`.

## GitHub Pages

The public deployment is:

```text
https://ashfame.github.io/sojourn/
```

GitHub Actions runs typecheck, lint, unit tests, a static build, and Playwright before deploying the latest successful `main` build to Pages.

## Static Build

Build deployable static assets into `dist`:

```bash
npm run build:static
```

`npm run build` is an alias for the same command.

The generated `dist` directory can be deployed to any static host that can serve `index.html`, JavaScript, CSS, WASM, worker files, and `sw.js`.

If the app is hosted from a subpath instead of the domain root, set `VITE_BASE_PATH` during the build:

```bash
VITE_BASE_PATH=/sojourn/ npm run build:static
```

## Current UX

- The main screen is a scrollable stay timeline.
- First run has no demo stays, evidence, or targets.
- When no targets exist, the app opens the target setup panel and offers suggested templates.
- A stay with no exit date is treated as active and counts through today; the app refreshes the
  active day count when the date changes.
- If a stored stay has a future exit date, targets still count it only through today. Use
  Projection to model future days.
- Each stay expands inline to show evidence.
- Explicit stays can be edited or deleted from the expanded stay panel.
- Evidence can be added, edited, or deleted from the expanded stay panel.
- Evidence completeness is summarized as `x/4` on every stay.
- Missing dates between entered stays render as `X days unaccounted for` timeline rows.
- Target cards use one progress component with two meanings:
  - `minimum`: fill toward a target, safe when complete.
  - `ceiling`: spend down a budget, warning near the edge.
- Targets are configurable. Each rule owns its countries, threshold, direction, counting convention, and window.
- Duplicate targets with the same countries, threshold, direction, window, and counting policy are blocked.
- Counting policies are per-target:
  - inclusive dates: entry and exit dates count,
  - exclude exit date: nights-style counting,
  - any touched date: date-only inclusive, reserved for future time-aware stays.
- For ceiling rules, the threshold is the maximum safe day count. For example, "under 60" is configured as `59`.
- Nationality and legal residence are profile metadata, hidden behind the `Data & profile` panel.
- Export is also kept behind `Data & profile` so the main screen stays focused on targets and timeline.
- UAE is suggested as a calendar-year minimum.
- India is suggested as an Apr-Mar fiscal-year ceiling.
- Schengen is suggested as a rolling 180-day window over a country set.
- A projection panel runs hypothetical future stays through the same rule engine.

## BYOS And Remote Storage

This rebuild currently stores data only in browser IndexedDB.

Remote backup/sync is intentionally not wired into the UX yet. The storage boundary is already explicit:

- `StorageDriver` handles local load/save/export/import.
- `RemoteSyncDriver` is reserved for a future remote SQLite snapshot or sync backend.

When BYOS returns to the product, configure the deployed app URL as a redirect URI. For GitHub Pages:

```text
https://ashfame.github.io/sojourn/
```

## Archive

The previous technical V1 was preserved before this rebuild:

```text
archive/technical-v1-2026-06-14
```
