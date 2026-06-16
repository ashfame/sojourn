# Sojourn Architecture

Sojourn is a static, browser-only React app for tracking physical presence days,
residency targets, planned trips, and supporting evidence. There is no backend in
the current implementation. App state and uploaded evidence files are persisted
locally in the user's browser.

## Runtime Shape

- UI runtime: React 19, TypeScript, Vite.
- Production deployment: static files only.
- Persistence: IndexedDB via the `idb` package, with a small `localStorage`
  metadata mirror for cross-tab reloads and fallback.
- Remote sync: not implemented. `RemoteSyncDriver` exists as a reserved
  interface for a future backend.
- Service worker: registered only in production. It network-fetches navigations,
  `index.html`, `version.json`, and `sw.js`, and uses network-first runtime
  caching for same-origin GET assets.

## Entry Points

- `src/main.tsx` mounts `<App />` into `#root`, imports global styles, and
  registers `public/sw.js` in production.
- `src/app/App.tsx` owns the full interactive app shell, local UI state, and all
  calls into the storage driver.
- `src/app/styles.css` is the global stylesheet for the app shell, timeline,
  target cards, forms, modal, and responsive layout.

## Module Map

- `src/domain/types.ts`: canonical TypeScript data model.
- `src/domain/dates.ts`: UTC date-only helpers.
- `src/domain/countries.ts`: known country labels, flags, and Schengen country
  set used by suggestions.
- `src/domain/evidence.ts`: evidence type labels and completeness scoring.
- `src/domain/rules.ts`: timeline construction, rule window calculation, day
  counting, progress/tone calculation, projection helpers, and timeline summary
  formatting.
- `src/domain/seed.ts`: ID generation, suggested/default rule templates, initial
  empty app state, and storage migrations for old starter/demo data.
- `src/storage/storageDriver.ts`: persistence interfaces.
- `src/storage/indexedDbStorage.ts`: current storage implementation.
- `src/storage/archive.ts`: JSON/ZIP import/export implementation, including
  evidence file packaging.
- `public/sw.js`: production service worker.

## Data Model

The persisted app record is `AppData`:

```ts
interface AppData {
  schemaVersion: 1;
  settings: AppSettings;
  stays: Stay[];
  evidence: EvidenceItem[];
  rules: Rule[];
  updatedAt: string;
}
```

Core entities:

- `Stay`: a dated presence period with `country`, `entryDate`, optional
  `exitDate`, optional `label`, and timestamps.
- `EvidenceItem`: metadata for proof linked to a stay. File bytes are not stored
  inside this entity; they are referenced by optional `blobKey`.
- `Rule`: a configurable day-count target with countries, threshold, direction,
  window, counting convention, label, and description.
- `TimelineStay`: a derived render/counting model created from `Stay`, enriched
  with source, counting dates, display duration, linked evidence, and evidence
  score.

`AppSettings` currently stores `homeBaseCountry`, `nationality`,
`legalResidence`, and `countEntryExitDays`. Only nationality and legal residence
are editable in the UI today, and profile data is metadata only. Day counting is
driven by each rule's `counting` value.

Dates are stored as `YYYY-MM-DD` strings and interpreted with UTC date helpers.
This avoids local timezone shifts in date-only residency calculations.

## Storage

The active storage backend is `createIndexedDbStorage()` in
`src/storage/indexedDbStorage.ts`.

IndexedDB constants:

- Database name: `sojourn-browser-store`
- Database version: `2`
- App object store: `app`
- App record key: `current`
- Evidence file object store: `files`
- Local mirror key: `sojourn-browser-store.current.v1`

The `app` store contains one `StoredRecord`:

```ts
interface StoredRecord {
  key: string;
  data: AppData;
  savedAt: string;
  revision: number;
}
```

The `files` store contains uploaded evidence bytes:

```ts
interface FileRecord {
  key: string;
  buffer: ArrayBuffer;
  type: string;
  savedAt: string;
}
```

Evidence file keys use this format:

```text
evidence/{evidenceId}
```

Loading behavior:

1. Open IndexedDB and read `app/current`.
2. Read the `localStorage` mirror.
3. Pick the newer record by revision, then by `savedAt`.
4. Run `migrateAppData`.
5. Write the migrated/newer record back to IndexedDB if needed.
6. Refresh the `localStorage` mirror.
7. If no record exists, create empty initial data with revision `1`.

Saving behavior:

1. Stamp `updatedAt` in `App.tsx`.
2. `save()` reads the previous IndexedDB record.
3. Revision increments by one.
4. The record is written to IndexedDB and mirrored to `localStorage`.

Cross-tab behavior:

- The UI listens for `storage` events for `STORAGE_BACKUP_KEY`.
- When another tab updates the mirror, the app reloads through the storage
  driver and re-applies migration/newer-record selection.

Evidence file behavior:

- Uploading evidence stores metadata in `AppData.evidence`.
- Uploaded bytes are saved separately in IndexedDB `files` under
  `evidence/{evidenceId}`.
- Deleting evidence deletes its file record first, then removes metadata.
- Deleting a stay deletes all linked evidence file records and metadata.
- Previewing evidence reads the blob from IndexedDB, creates an object URL, and
  renders PDF/image inline when possible.

## Import And Export

Exports are ZIP archives created by `src/storage/archive.ts`. The archive format
is intentionally simple and currently uses stored, uncompressed ZIP entries.

Archive entries:

- `sojourn-data.json`: JSON serialized `AppData`.
- `sojourn-manifest.json`: evidence file manifest.
- `evidence/{generated-file-name}`: evidence file bytes.

Manifest file entries have this shape:

```ts
interface ArchiveEvidenceFile {
  evidenceId: string;
  path: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}
```

Export flow:

1. Clone app data shallowly.
2. For each evidence item, call `getEvidenceFile(item)`.
3. If a blob exists, generate a stable archive filename from evidence type,
   title/file name/id, and extension.
4. Update exported metadata with archive file name, MIME type, and size.
5. Add data, manifest, and file entries to an uncompressed ZIP blob.

Import flow:

- JSON files are parsed directly and migrated.
- ZIP files are parsed by reading the central directory.
- Only uncompressed ZIP archives are supported.
- Imported archive evidence files are written to IndexedDB `files` using
  `evidence/{evidenceId}`.
- Imported evidence metadata is updated with `blobKey`, file name, MIME type,
  and size from the manifest.
- If ZIP parsing fails, import falls back to JSON parsing.

## Timeline Engine

`createTimeline(data, asOf, extraStays = [])` is the source of derived timeline
rows. It accepts persisted stays plus optional projected stays.

Important behavior:

- Stays are sorted ascending by `entryDate`, then returned descending for render.
- Evidence is grouped by `stayId` and attached to explicit timeline rows.
- A stay without `exitDate` is active and normally extends through `asOf`.
- If an active stay is followed by another stay, it is capped at the day before
  the next stay, bounded by `asOf`.
- A stay with a stored future `exitDate` is treated as a known exit and counts
  through that future date.
- Missing periods between explicit stays are rendered as synthetic
  `source: "unaccounted"` rows.
- Display durations are inclusive, but overlapping transfer days are handled so
  adjacent explicit stays do not inflate displayed tracked totals.

The timeline row fields distinguish raw stored dates from counting dates:

- `entryDate` / `exitDate`: row display period.
- `knownExitDate`: present only when the original stored stay had an exit.
- `countEntryDate` / `countExitDate`: clipped range used by rule counting.
- `durationDays`: inclusive display duration after overlap adjustment.

## Rule Engine

Rules support these windows:

- `calendar_year`: January 1 through December 31 of the `asOf` year.
- `fiscal_year`: custom start month/day; end is the day before the next fiscal
  year starts.
- `rolling_days`: `window.days` ending on `asOf`.

Rules support these directions:

- `minimum`: progress fills toward a target. Tone is `safe` at or above the
  threshold, `good` at 65 percent or more, otherwise `neutral`.
- `ceiling`: progress spends a budget. Tone is `danger` at 90 percent or more,
  `watch` at 70 percent or more, otherwise `good`.

Rules support these counting conventions:

- `entry_exit_count`: count every date from entry through exit.
- `exclude_exit_day`: count entry through the day before a known exit, except
  do not subtract a day merely because the stored exit falls after the reporting
  period.
- `presence_any_part`: legacy/internal value for imported or existing data. With
  the current date-only model this matches `entry_exit_count` and is not exposed
  as a selectable UI option.

Counting implementation:

1. Build a timeline for the app data, plus any projection stays.
2. For each rule, compute its active window for `asOf`.
3. Include timeline rows whose country is in the rule's `countryScope`.
4. Clip each stay's counting range to the rule window.
5. Add each included date to a `Set` so overlapping stays do not double-count.
6. Return `RuleProgress` with used days, remaining days, percent, tone, status
   text, detail text, and display window label.

The UI prevents duplicate rules by comparing a rule signature made from sorted
country scope, direction, threshold, window signature, and counting convention.
The same duplicate cleanup also runs during migration.

## Projections

Projection state is not persisted. It lives in `App.tsx` as `projection` and
`plannedProjections`.

Projection flow:

1. The Plan view collects country, entry date, exit date, and label.
2. `projectionStay()` converts each planned trip into a `Stay` with
   `projected: true`.
3. The projected stay id is replaced with an index/country/date-based id in the
   UI.
4. `ruleAsOfDate()` advances the calculation `asOf` date to the latest
   projected exit if needed.
5. `computeRuleProgress()` runs the same rule engine against persisted stays
   plus projected stays.

## Evidence Scoring

Evidence completeness is derived by `scoreEvidence(evidence, { ongoing })`.

The four checks are:

- Entry proof: visa or entry stamp, or at least one transport proof.
- Exit proof: satisfied automatically for ongoing stays, or by at least two
  transport proofs, or by a flight confirmation certificate.
- Accommodation: at least one accommodation item.
- Supporting trail: at least two evidence items.

Tone mapping:

- `complete`: all checks satisfied.
- `partial`: at least two checks satisfied.
- `weak`: fewer than two checks satisfied.

Evidence types:

- `visa`
- `flight_ticket`
- `boarding_pass`
- `flight_confirmation_certificate`
- `accommodation`
- `entry_stamp`
- `other`

## App UI State And Flow

`App.tsx` keeps persisted domain data separate from view-only state.

Persisted:

- `data: AppData | null`
- `metadata: StorageMetadata`

View-only:

- expanded stay ids
- active app view: `timeline`, `targets`, `projection`, or `data`
- add/edit form state for stays, evidence, and targets
- projection draft and planned projections
- `asOf` date
- status message
- evidence preview object URL
- hidden import input ref

On mount, the app loads through the storage driver. It also schedules an `asOf`
refresh for the next UTC day, and refreshes when the window regains focus or
visibility. This keeps active-stay counts current without requiring a page
reload.

Main views:

- Timeline: target strip, add-stay form, timeline rows, expanded evidence
  panels, stay editing, active-stay end-today action, and evidence CRUD.
- Targets: suggested targets, existing target summaries, editable rule forms,
  duplicate prevention, and custom target creation.
- Plan: projection form, planned trip list, and projected target progress.
- Data: profile metadata, storage metadata, import, and export archive actions.

## Migrations And Initial Data

`createInitialData()` returns an empty product state:

- no stays
- no evidence
- no rules
- default settings for home base, nationality, legal residence, and inclusive
  counting preference

`defaultRules`, starter stays, and starter evidence are still present in
`seed.ts` for migration cleanup and suggestion/reference logic, not as first-run
data.

`migrateAppData()` currently:

- removes old starter/demo stays.
- removes evidence linked to those old starter stays.
- removes old starter target rules.
- updates the old India NRI threshold from `60` to `59` when applicable.
- removes duplicate target rules by semantic signature.

Migrations run on storage load and import.

## Country Support

`COUNTRY_NAMES` is a small explicit country label map, not a global country
database. Unknown two-letter country codes still work, but display as the code
or generated flag where possible.

`SCHENGEN_COUNTRIES` is the set used by the Schengen suggested/default rule.
Update this list intentionally if the app's supported Schengen scope changes.

## Build And Configuration

Runtime/tooling versions:

- Node is pinned by `.nvmrc` to `24.15`.
- `package.json` requires Node `>=24.15 <25` and npm `>=11`.

Package scripts:

- `npm run dev`: Vite dev server on `127.0.0.1`.
- `npm run build`: typecheck plus static Vite build into `dist`.
- `npm run build:static`: same build target.
- `npm run preview`: local Vite preview server.
- `npm test`: Vitest unit/integration tests.
- `npm run test:ui`: Playwright end-to-end tests.
- `npm run lint`: ESLint.
- `npm run typecheck`: TypeScript project build.

Vite config:

- `base` comes from `VITE_BASE_PATH`, default `/`.
- `__SOJOURN_BUILD_COMMIT__` is defined from `VITE_GIT_COMMIT`,
  `GITHUB_SHA`, or `unknown`.
- Dev and preview servers set COOP/COEP headers.
- Build target is `es2024`.
- Sourcemaps are enabled.
- `@sqlite.org/sqlite-wasm` is excluded from dependency optimization as a
  placeholder for future storage experiments.

GitHub Actions:

- Workflow file: `.github/workflows/ci.yml`.
- Runs on pushes to `main`, pull requests targeting `main`, and manual
  dispatch.
- The verify job runs `npm ci`, typecheck, lint, unit tests, installs Chromium
  with system dependencies, runs Playwright tests, uploads the Playwright report,
  and builds static assets.
- The static build sets `VITE_BASE_PATH=/sojourn/` and
  `VITE_GIT_COMMIT=${github.sha}`.
- Non-PR runs upload `dist` as a GitHub Pages artifact, then deploy it with
  `actions/deploy-pages`.

## Tests

Unit/domain coverage:

- empty first-run data
- timeline gaps and transfer-day duration behavior
- calendar, fiscal, and rolling rule windows
- active stays
- known future exits
- projected stays
- exit-day exclusion
- Schengen rolling window counting

Storage coverage:

- first load
- save/reload through `StorageDriver`
- newer `localStorage` mirror selection
- JSON import
- ZIP archive export/import with evidence file bytes
- migration cleanup for starter data and duplicate rules

End-to-end coverage:

- target setup
- stay creation/edit/delete
- unaccounted gap display
- target edit/delete
- projection calculation
- evidence add/preview/edit/delete
- data panel visibility
- JSON import

## Current Boundaries And Non-Goals

- The app does not provide legal advice. Rules are user-configurable counting
  profiles.
- There is no authentication, server API, or remote backup in the active app.
- Uploaded evidence is browser-local only unless the user exports an archive.
- Projection trips are temporary UI state and are not saved.
- The archive ZIP writer supports uncompressed stored entries only.
- The country list is intentionally narrow.

## Change Checklist

When changing internals, keep this document current. In particular, update it
when changing:

- persisted data shapes in `types.ts`
- storage keys, database names, object stores, or file key formats
- import/export archive format
- timeline or rule counting semantics
- evidence scoring semantics
- service worker caching strategy
- deployment/build configuration
- test strategy or meaningful coverage boundaries
