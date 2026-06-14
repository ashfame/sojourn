# Sojourn Browser-Only V1 Plan

## Decision

Start fresh from the previous technical prototype.

The old app was shaped around OIDC, credential minting, S3, SQLite cache layers, workers, and backup plumbing before the core product UX was clear. The new direction is simpler: a complete browser app with a timeline as the main screen, local browser storage first, and a storage boundary that can later support browser SQLite, sync, or direct object-storage backups.

The previous implementation is preserved at:

```text
archive/technical-v1-2026-06-14
```

## Product Shape

Sojourn is a local-first residency day tracker. It should answer three questions quickly:

- Where was I, by scrolling the timeline?
- Which residency targets or ceilings am I approaching?
- What proof supports each stay?

The app does not provide legal advice or treaty interpretation. Rules are configurable counting profiles.

## Runtime Constraints

- Production app is static browser assets only.
- No Node runtime in the production stack.
- No local companion process.
- No native SQLite process.
- No Litestream.
- Browser APIs are allowed: IndexedDB, Web Workers, Service Workers, OPFS, Web Crypto, File APIs, and WASM.

Node is used only for development, tests, and building static assets into `dist`.

## Core UX

The main screen is the timeline.

- Stays are sorted newest first.
- Home-base gaps are inferred automatically from explicit stays.
- Each stay expands inline to show proof.
- Each stay shows evidence completeness, such as `2/4`.
- Target cards stay visible near the top so the user can see day-count pressure before browsing details.
- Projection is a first-class workflow: add a hypothetical stay and rerun the same rule engine.

The target cards use one progress component with two meanings:

- `minimum`: a target to reach, like UAE 183 days. More progress is better; green when safe.
- `ceiling`: a budget to avoid spending, like India or Schengen. More progress is riskier; amber and red near the edge.

## V1 Data Model

### `Stay`

```ts
{
  id: string;
  country: string;
  entryDate: string;
  exitDate?: string;
  label?: string;
}
```

The timeline is derived from stays plus inferred home-base gaps.

### `Evidence`

```ts
{
  id: string;
  stayId: string;
  type:
    | "visa"
    | "flight_ticket"
    | "boarding_pass"
    | "flight_confirmation_certificate"
    | "accommodation"
    | "entry_stamp"
    | "other";
  title: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  date?: string;
}
```

V1 stores file metadata. Blob/file persistence can be added behind the same storage interface.

### `Rule`

```ts
{
  id: string;
  label: string;
  countryScope: string[];
  threshold: number;
  direction: "minimum" | "ceiling";
  window:
    | { type: "calendar_year" }
    | { type: "fiscal_year"; startMonth: number; startDay: number }
    | { type: "rolling_days"; days: number };
  counting: "entry_exit_count" | "presence_any_part";
}
```

Country scope can contain multiple countries, which is how Schengen works without special-casing.

## Built-In Rules

- UAE tax residency: `183` day minimum, calendar year, UAE country scope.
- India NRI status: `60` day conservative ceiling, Apr-Mar fiscal year, India country scope.
- Schengen 90/180: `90` day ceiling, rolling 180-day window, Schengen country set.

Entry/exit counting belongs to the rule, not to the stay.

## Storage Architecture

### Current V1

- IndexedDB is the active browser persistence backend.
- The UI reads and writes through a `StorageDriver`.
- Data is saved locally before any future remote work starts.
- Export produces a JSON snapshot that can be deployed or backed up manually.

### Storage Boundary

```ts
interface StorageDriver {
  load(): Promise<PersistedAppData>;
  save(data: AppData): Promise<StorageMetadata>;
  exportData(data: AppData): Promise<Blob>;
  importData(blob: Blob): Promise<AppData>;
}

interface RemoteSyncDriver {
  pull(): Promise<PersistedAppData | undefined>;
  push(data: AppData, previousRevision?: number): Promise<StorageMetadata>;
}
```

This keeps the React app independent from the storage backend.

### Future Remote Storage

Remote persistence is intentionally deferred.

Likely options:

- Browser SQLite/WASM with OPFS as the local working store.
- Periodic encrypted SQLite or JSON snapshots uploaded directly to object storage.
- A virtual filesystem or sync layer if it proves simpler than snapshot uploads.
- Direct S3-compatible writes are acceptable because the app is not write-heavy.

Future sync should remain browser-only:

- OAuth PKCE can happen in the browser.
- A remote service may mint scoped credentials or pre-signed URLs.
- Application data should live in browser storage and user-controlled object storage.
- Remote divergence should be detected and require explicit restore/overwrite choice.

## Rule Engine Requirements

- Calendar-year windows.
- Fiscal-year windows, especially India Apr-Mar.
- Rolling windows, especially Schengen 90/180.
- Leap years.
- Same-day entry/exit.
- Open-ended current stays.
- Overlapping boundary days, such as Schengen transfer days and UAE return days.
- Future projections using hypothetical stays.

## Evidence Requirements

Each stay should show whether proof is strong enough for audit use.

The initial completeness score checks for:

- Entry proof.
- Exit proof.
- Accommodation proof.
- Supporting trail, such as visa, flight confirmation, or other document.

Later versions should store imported file blobs, hash them with Web Crypto, and link them to stays and export packages.

## Static Build And CI

- `npm run build:static` generates deployable assets in `dist`.
- GitHub Actions runs typecheck, lint, unit tests, static build, and Playwright.
- GitHub Pages can deploy the latest public `main` build.

## Current Implementation Milestone

The first rebuild should deliver:

- Timeline-first React UI.
- Target cards with minimum/ceiling semantics.
- Stay creation.
- Expandable evidence panels.
- Evidence metadata creation.
- Projection panel.
- Settings for home base, nationality, legal residence, and entry/exit policy.
- IndexedDB-backed `StorageDriver`.
- Unit tests for rule windows and storage.
- Playwright coverage for the main timeline/evidence path.

## Next Milestones

1. Store imported evidence blobs in browser storage.
2. Add document preview for PDFs/images.
3. Add rule editor for custom countries and thresholds.
4. Add import/restore from exported JSON.
5. Add browser SQLite/WASM storage experiment behind `StorageDriver`.
6. Add remote backup/sync behind `RemoteSyncDriver`.
7. Add exportable tax residency package with summary and referenced proof.
