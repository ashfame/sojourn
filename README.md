# Residency Days

Browser-only tax residency day tracker for country presence, travel events, stays, evidence documents, direct S3 persistence, and exportable tax residency packages.

## Stack

- React 19 + TypeScript 6 + Vite 8.
- Browser runtime only: static assets, service worker, web workers, WebAssembly, OPFS, IndexedDB, Web Crypto, and `fetch`.
- SQLite WASM is initialized inside the data worker and uses OPFS when cross-origin isolation is available.
- IndexedDB mirrors the working state and stores attachment blobs.
- S3-compatible object storage is the durable remote backing store through signed browser `PUT`, `GET`, and `HEAD` requests.

Node is used only for development, build, and tests. The production app is static browser assets.

## Development

```bash
npm install
npm run dev
```

The dev server sets:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Those headers are required for SQLite WASM OPFS support.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:ui
```

`npm run test:ui` requires Playwright's Chromium runtime and Linux browser libraries. Install them with:

```bash
npx playwright install chromium
npx playwright install-deps chromium
```

The dependency installer may require sudo on Linux.

## GitHub Pages

The app is deployed from `main` by GitHub Actions after typecheck, lint, unit tests, and Playwright tests pass.

Production URL:

```text
https://ashfame.github.io/sojourn/
```

The Pages build sets `VITE_BASE_PATH=/sojourn/` so Vite assets and the service worker are served from the repository subpath.

GitHub Actions configuration:

- Pages source should be `GitHub Actions`.
- Optional repository Actions variable: `VITE_BYOS_CLIENT_ID`.

If `VITE_BYOS_CLIENT_ID` is not set, the app still works, but users must enter the approved BYOS connected-app client ID in the S3 view before clicking `Connect BYOS`.

GitHub Pages does not support setting custom COOP/COEP response headers for this static site. The app therefore uses IndexedDB as the durable browser cache on Pages. OPFS-backed SQLite is still used on hosts that provide:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

## BYOS S3 Setup

The app signs BYOS S3-compatible requests directly in the browser. BYOS credentials are short-lived and app-scoped.

Production BYOS defaults:

- Auth/API/S3 endpoint: `https://byos.ashfame.com`
- Signing region: `us-east-1`
- Scope: `storage:app storage:s3`
- Request style: path-style S3 URLs

The browser OAuth flow is authorization-code PKCE. It is not an OIDC sign-in flow and does not request `openid`, `profile`, `email`, or `offline_access`.

1. Register and approve the app in BYOS connected apps.
2. Add this redirect URI to the BYOS connected app:

```text
https://ashfame.github.io/sojourn/
```

3. Set `VITE_BYOS_CLIENT_ID` for builds, or enter the approved client ID in the S3 view.
4. Click `Connect BYOS`.
5. BYOS redirects back to the app with `code` and `state`.
6. The app verifies state, exchanges the code at `/oauth2/token`, and requests S3 credentials at `/oauth2/protocol-credentials`.
7. The app uses `response.grant.external_alias` as the S3 bucket name.

The BYOS credential endpoint returns:

- `access_key_id`
- `secret`
- `grant.external_alias`
- `credential.expires_at` or `grant.expires_at`

The S3 secret is kept in memory for the browser session. It is not written to local storage by the BYOS flow; reloads can refresh S3 credentials while the OAuth access token remains valid in session storage.

Generic S3-compatible settings are still accepted manually:

- `endpoint`
- `bucket`
- `region`
- `prefix`
- `accessKeyId`
- `secretAccessKey`
- optional `sessionToken`
- `forcePathStyle`

Required CORS shape for the bucket:

```json
[
  {
    "AllowedOrigins": ["https://your-app-origin.example"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": [
      "authorization",
      "content-type",
      "if-match",
      "if-none-match",
      "x-amz-content-sha256",
      "x-amz-date",
      "x-amz-security-token"
    ],
    "ExposeHeaders": ["etag", "x-amz-version-id", "content-length"]
  }
]
```

Remote object layout:

- `state/head.json`
- `state/manifests/{generation}.json`
- `state/json/{generation}.json`
- `attachments/sha256/{hash_prefix}/{sha256}`
- `exports/{export_id}/...`

## Current V1 Coverage

- Configurable tax-year profiles with India and UAE defaults.
- Timezone-aware day ledger from presence intervals, stays, travel events, and manual corrections.
- Evidence import, hashing, OPFS attachment storage with IndexedDB fallback, and entity linking.
- Timeline and evidence completeness indicators.
- Direct S3 upload with content-addressed attachments, versioned state snapshots, manifests, and ETag/`If-None-Match` guarded head object advancement.
- S3 restore from `state/head.json` with attachment hash verification.
- Browser-generated ZIP export with report, day ledger, evidence index, state snapshot, and documents.
