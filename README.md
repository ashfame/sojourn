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

## S3 Setup

The app signs S3-compatible requests directly in the browser. Use short-lived, tightly scoped credentials or the built-in OAuth PKCE credential-minting flow.

The OAuth flow works entirely in the browser:

1. Enter the authorization endpoint, token endpoint, client ID, redirect URI, scope, optional audience, and credential-minting endpoint.
2. Create and open the PKCE authorization URL.
3. Paste the returned authorization code and state.
4. The browser exchanges the code for an access token and calls the credential-minting endpoint.
5. The credential endpoint returns scoped S3-compatible settings.

The credential endpoint should return either a direct settings object or `{ "s3": { ... } }` with:

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
