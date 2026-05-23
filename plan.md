# Tax Residency Tracker V1 Browser-Only Direct-S3 Plan

## Summary
Build a complete browser-based React app for tracking country presence, travel events, stays, evidence documents, and tax-year day counts. The app is browser-only and uses S3-compatible object storage directly as the durable backing store. Browser storage provides a local working cache, fast queries, offline tolerance, and recovery from interrupted uploads.

There is no Node companion process, local HTTP daemon, native SQLite process, local filesystem service, or Litestream layer in V1.

## Runtime Architecture
- React single-page app served as static browser assets.
- Service worker caches the app shell and static assets for offline use.
- Dedicated data worker owns database access and day-count computation.
- SQLite runs in-browser through SQLite WASM with OPFS persistence where supported, acting as the local working/query cache.
- IndexedDB is the fallback persistence layer if OPFS-backed SQLite is unavailable.
- Attachments are stored in browser-managed storage, preferably OPFS for file-like blobs and IndexedDB Blob records as fallback.
- Browser Web Crypto computes document hashes and encrypts optional local, remote, and exported backups.
- A storage worker writes application snapshots, manifests, and attachments directly to user-owned S3-compatible object storage.
- OAuth uses browser PKCE flow. The app exchanges the OAuth access token with a remote credential-minting endpoint using `fetch`.
- The remote service only mints scoped object-storage credentials or pre-signed URLs. It does not store application data.

## Non-Goals
- No Node runtime in production.
- No local companion process.
- No native SQLite binary.
- No Litestream, because Litestream requires a native process and filesystem-level SQLite WAL access.
- No legal residency advice, treaty interpretation, or authoritative country-specific tax rules.
- No multi-device live collaboration in V1.

## Storage Model
Use S3-compatible object storage as the durable canonical store. Use SQLite WASM as the browser-side working datastore because the app needs relational queries, day-ledger computation, filtering, and timeline projections.

Durable persistence:
- Store the canonical app state as versioned encrypted SQLite snapshots or structured JSON snapshots in S3.
- Prefer SQLite snapshot objects if SQLite WASM is the active local datastore.
- Keep a small pointer object, `state/head.json`, containing the current generation, snapshot key, manifest key, previous generation, schema version, and content hash.
- Use S3 conditional writes with ETag or object-version checks where available.
- Because writes are low volume, upload a fresh snapshot after meaningful user actions instead of implementing WAL replication or a high-frequency delta protocol.
- Keep recent snapshot generations in S3 for rollback.

Browser working cache:
- SQLite WASM + OPFS VFS runs in a dedicated worker.
- All reads and writes route through the worker to avoid concurrent database access problems.
- The UI sends typed commands to the worker and receives typed results/events.
- IndexedDB stores serialized snapshots, normalized fallback records, attachment blobs, pending upload records, and S3 head metadata when OPFS SQLite is unavailable.
- The app exposes a storage health panel showing the active cache backend, remote head generation, pending upload state, and quota estimate.

Attachment persistence:
- Store PDFs/images/imported files in OPFS under content-addressed names when available.
- Store IndexedDB Blob records as fallback.
- Upload attachments directly to S3 under content-addressed object keys.
- SQLite stores document metadata, hashes, MIME type, logical links, local storage key, remote object key, upload status, and verification state.
- Files are never treated as paths on the user filesystem unless the user explicitly imports or exports through browser file picker APIs.

## Core Data Interfaces

### `tax_year_profile`
- `id`
- `country_code`
- `label`
- `start_month`
- `start_day`
- `timezone`
- `reporting_currency`
- `created_at`
- `updated_at`

Defaults:
- India: Apr 1 to Mar 31.
- UAE: Jan 1 to Dec 31.
- Other countries: Jan 1 to Dec 31 until configured.

### `travel_event`
- `id`
- `type`: `flight`, `train`, `border_crossing`, `ferry`, `other`
- `origin_country`
- `origin_city`
- `destination_country`
- `destination_city`
- `departure_at`
- `departure_timezone`
- `arrival_at`
- `arrival_timezone`
- `carrier`
- `booking_reference`
- `notes`
- `confidence`
- `created_at`
- `updated_at`

### `stay_event`
- `id`
- `type`: `hotel`, `lease`, `home`, `family`, `other`
- `country_code`
- `city`
- `check_in_date`
- `check_out_date`
- `timezone`
- `provider`
- `booking_reference`
- `notes`
- `created_at`
- `updated_at`

### `presence_interval`
- `id`
- `country_code`
- `start_at`
- `end_at`
- `timezone`
- `source_type`
- `source_id`
- `confidence`
- `is_manual`
- `notes`
- `created_at`
- `updated_at`

### `manual_correction`
- `id`
- `country_code`
- `date`
- `timezone`
- `day_status`
- `reason`
- `supersedes_snapshot_id`
- `created_at`

### `document`
- `id`
- `title`
- `kind`: `passport_stamp`, `boarding_pass`, `ticket`, `hotel_invoice`, `lease`, `visa`, `tax_doc`, `bank_statement`, `custom`
- `mime_type`
- `size_bytes`
- `sha256`
- `capture_date`
- `local_storage_backend`
- `local_storage_key`
- `remote_object_key`
- `upload_status`
- `verification_status`
- `created_at`
- `updated_at`

### `document_link`
- `id`
- `document_id`
- `entity_type`: `travel_event`, `stay_event`, `presence_interval`, `tax_year_profile`, `day_count_snapshot`, `manual_correction`
- `entity_id`
- `relationship`
- `created_at`

### `day_count_snapshot`
- `id`
- `country_code`
- `tax_year_profile_id`
- `period_start`
- `period_end`
- `included_day_count`
- `ambiguous_day_count`
- `missing_evidence_day_count`
- `computed_at`
- `rules_version`
- `input_hash`
- `result_json`

### `storage_manifest`
- `id`
- `device_id`
- `manifest_version`
- `local_generation`
- `remote_generation`
- `database_snapshot_key`
- `attachment_entries_json`
- `created_at`
- `uploaded_at`
- `upload_status`
- `last_error`

## Day Ledger
The app computes a canonical day ledger from:
- Presence intervals.
- Travel events with timezone-aware departure and arrival timestamps.
- Stay events.
- Manual corrections.
- Linked evidence.

Rules:
- Compute dates in the relevant country/tax-year timezone.
- Preserve exact instants for travel events.
- Represent overnight flights and timezone crossings explicitly.
- Mark layover and ambiguous border days as ambiguous unless resolved by user input.
- Same-day entry/exit can count as a present day depending on the selected counting profile.
- Missing exit dates create open intervals that are clearly marked as open-ended.
- Manual corrections override computed results but always keep an audit trail.

The first V1 implementation should keep country-specific legal logic configurable rather than hardcoded. Built-in profiles provide tax-year boundaries, not legal advice.

## UI Scope

### Main Views
- Dashboard with current tax-year day counts by country.
- Timeline/calendar view showing country spans, travel days, stays, and evidence markers.
- Event editor for travel, stays, presence intervals, and manual corrections.
- Documentation hub for importing, previewing, linking, and verifying files.
- Tax-year profile settings per jurisdiction.
- S3 save and backup status view.
- Export view for a tax residency package.

### Timeline
- Country/year selector.
- Calendar and horizontal timeline modes.
- Computed day counts visible beside the selected profile.
- Event icons for flights, hotels, border crossings, visas, leases, tax docs, bank statements, and custom evidence.
- Ambiguous days and manually corrected days visually distinct.
- Evidence completeness indicator per day/range.

### Documentation Hub
- Import files through file picker or drag-and-drop.
- Hash each file with Web Crypto before storing.
- Link documents to events, date ranges, countries, or tax years.
- Preview supported PDFs/images in-browser.
- Show storage backend, local availability, remote upload state, and verification state.

### Save and Upload States
The UI should distinguish:
- `Saving...`
- `Saved in browser`
- `Uploading to S3`
- `Saved to S3`
- `Offline changes pending`
- `Upload error`

Browser-cache writes should complete before remote upload starts so failed S3 writes never discard user input. When online, the app should upload to S3 immediately or after a short debounce.

## Direct S3 Persistence Model
Browser-only persistence cannot rely on Litestream or native WAL replication. V1 uses direct S3 object writes with versioned snapshots and content-addressed attachments.

Flow:
1. User signs in with OAuth PKCE in the browser.
2. App exchanges OAuth access token for scoped browser-usable object storage access or pre-signed object operations.
3. On startup, app reads `state/head.json` from S3 and downloads the referenced snapshot if the remote generation is newer than the browser cache.
4. User changes commit to SQLite WASM/OPFS or IndexedDB cache first.
5. Data worker emits a new local generation number and dirty state.
6. Storage worker uploads changed attachments under content-addressed object keys.
7. Storage worker exports the current database/state snapshot and uploads it to S3.
8. Storage worker uploads a manifest describing snapshot key, attachment keys, hashes, sizes, and generation.
9. Storage worker advances `state/head.json` using an ETag or version precondition.
10. Local rows are marked `Saved to S3` only after snapshot, manifest, attachment verification, and head update succeed.

Remote object layout:
- `state/head.json`
- `state/manifests/{generation}.json`
- `state/database/{generation}.sqlite`
- `state/json/{generation}.json` if the app uses JSON snapshots for fallback mode
- `attachments/sha256/{hash_prefix}/{sha256}`
- `exports/{export_id}/...`

Credential options:
- Preferred: remote service returns pre-signed URLs for specific object operations.
- Alternative: remote service returns short-lived scoped S3-compatible credentials with strict prefix and duration limits.

Conflict strategy for V1:
- Single browser profile is the expected primary writer.
- Each S3 head update includes `device_id`, `local_generation`, previous remote generation, and expected ETag or object version.
- If `state/head.json` changed since the browser loaded it, stop automatic writes and require explicit user choice:
  - pull remote into local browser storage,
  - overwrite remote with local state,
  - export both copies for manual review.

Backup and restore:
- Restore downloads `state/head.json`, the selected manifest, database snapshot, and referenced attachments.
- Hash all restored attachments before marking them valid.
- Rebuild local OPFS/IndexedDB storage from the manifest.
- Keep a pre-restore local export when possible.

## Browser Capability Handling
- Detect OPFS, IndexedDB, service worker, web worker, Web Crypto, and storage quota support at startup.
- Show blocking guidance if minimum required APIs are unavailable.
- Use `navigator.storage.persist()` to request persistent storage.
- Warn when estimated quota is low or persistence is denied.
- Keep all data usable offline after first load.

## Export Package
Generate an exportable tax residency package fully in the browser:
- Summary HTML/PDF-compatible report.
- CSV/JSON day ledger.
- Country/tax-year day count summary.
- Evidence index with document hashes.
- Referenced documents as original files.
- ZIP package produced in-browser with a browser-compatible ZIP library or stream writer.

## Test Plan

### Unit Tests
- India Apr-Mar tax year boundaries.
- UAE Jan-Dec tax year boundaries.
- Custom tax-year start month/day.
- Leap-year day counting.
- Overnight flights crossing midnight and timezones.
- Same-day entry/exit.
- Missing exit date.
- Manual correction overrides and audit trail.
- Evidence completeness calculation.

### Worker Tests
- Data worker initializes SQLite WASM.
- Database migrations apply idempotently.
- Commands serialize writes through one database owner.
- Snapshot export/import preserves records.
- Attachment hash calculation matches stored metadata.
- Storage worker writes snapshot, manifest, attachments, and head object in the correct order.
- Failed head ETag precondition leaves local changes pending instead of overwriting remote state.

### Integration Tests
- Create travel event, attach document, verify SQLite metadata and browser storage blob.
- Create stay event and compute day ledger.
- Change financial year selector and verify totals.
- Direct S3 save uploads attachment, snapshot, manifest, and head object.
- Failed attachment upload keeps browser-cache data and surfaces retry state.
- Restore reconstructs database plus attachment storage from manifest.
- Remote head divergence blocks automatic overwrite and asks for explicit resolution.

### UI Tests
- Timeline renders country spans and event icons.
- Ambiguous and manually corrected days are distinguishable.
- Evidence links open the correct document preview.
- Save/upload states are visible and non-blocking.
- Offline app shell loads through service worker.
- Storage capability warnings render when APIs are unavailable.

## Implementation Milestones

### Milestone 1: Browser Shell and Storage Foundation
- Create React app shell.
- Add service worker for offline static assets.
- Add data worker boundary.
- Initialize SQLite WASM with OPFS persistence.
- Add IndexedDB fallback.
- Add schema migrations.
- Add storage capability and quota detection.

### Milestone 2: Core Domain Model
- Implement tax-year profiles.
- Implement travel events.
- Implement stay events.
- Implement presence intervals.
- Implement document metadata and links.
- Implement manual corrections.

### Milestone 3: Day Ledger
- Build timezone-aware day ledger computation in a worker.
- Add country/tax-year selectors.
- Add day count snapshots.
- Add evidence completeness calculations.
- Add focused unit tests for boundary cases.

### Milestone 4: Timeline and Documentation UI
- Build timeline/calendar views.
- Build event editors.
- Build document import, preview, and linking flows.
- Add evidence markers and completeness indicators.

### Milestone 5: Direct S3 Persistence
- Implement OAuth PKCE flow.
- Implement credential or pre-signed URL exchange.
- Implement attachment object upload by content hash directly to S3.
- Implement database/state snapshot upload directly to S3.
- Implement manifest upload and head object advancement with ETag/version checks.
- Implement save state UI and retry behavior.

### Milestone 6: Restore and Export
- Implement restore from remote manifest.
- Verify database and attachment hashes.
- Implement export package generation.
- Add tests for backup, restore, and package contents.

## Key Technical Decisions
- S3-compatible object storage is the durable canonical backing store.
- SQLite WASM + OPFS is the preferred browser working/query cache.
- A single dedicated worker owns all database writes.
- Attachments are content-addressed by SHA-256.
- Persistence is direct snapshot-and-manifest S3 writes, not WAL replication.
- Service worker is for offline app delivery and queued network work, not direct SQLite ownership.
- V1 is single-primary-browser with S3 head divergence detection.
- All application data remains in browser storage plus user-controlled S3-compatible object storage.
