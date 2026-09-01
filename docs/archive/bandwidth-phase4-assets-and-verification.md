# Bandwidth Phase 4 — assets and final verification

## Scope

Phase 4 addresses static assets, label images, service-worker storage, and final production verification. It does not change accounting, inventory quantities, factory costing, posting, permissions, schemas, migrations, or deletion behavior.

## Label image extraction

`client/src/lib/labelHtml.ts` historically embedded a full 1,280 × 853 PNG as a base64 JavaScript string. Every route that imported label helpers could therefore download the image as executable code.

`build/viteLabelAssetExtractionPlugin.ts` now:

- detects the embedded label logo during Vite transformation;
- reads the existing `server/hmd-logo.png` source;
- generates a 12-character SHA-256 content hash;
- emits one `assets/hmd-label-logo-<hash>.jpg` file;
- replaces the base64 JavaScript constant with the hashed asset URL;
- serves the same hashed URL during Vite development;
- fails the build if the expected embedded source is no longer present.

The label helper is also assigned to a dedicated `label-printing` Rollup chunk so normal ERP routes do not absorb label-only code into the core entry bundle.

## Service-worker limits

The service worker now:

- uses network-only delivery for `/api/*` and never persists company-scoped JSON in Cache Storage;
- uses cache-first delivery for content-hashed assets;
- uses cache-first delivery for timestamp-versioned label banners and immutable preview WebP files;
- rejects Range requests so partial responses cannot contaminate cached downloads;
- bounds ERP static Cache Storage at 200 entries;
- keeps navigation HTML network-first and deployment-safe;
- preserves stale-chunk recovery, background sync notifications, and push notifications.

## Verification

`npm run verify:bandwidth` enforces all four phases. When a production build exists, it additionally verifies:

- exactly one `label-printing-*.js` chunk;
- exactly one `hmd-label-logo-<hash>.jpg` asset;
- no built JavaScript contains the original embedded PNG signature;
- the core `index-*.js` entry remains below 1.5 MB;
- the label-printing chunk remains below 200 KB.

`npm run smoke:bandwidth` now also verifies that:

- no `/api/*` response is stored in ERP Cache Storage;
- Cache Storage remains within the 200-entry static limit plus the two app-shell entries;
- hashed assets are served locally on repeat load;
- `exceljs-vendor`, `html2canvas-vendor`, and `label-printing` do not load on an ordinary route;
- HTML and service-worker responses remain fresh while hashed assets remain immutable.

## Completion boundary

The code, source contracts, build-artifact contracts, and production smoke checks are complete in the branch. Actual production success cannot be asserted before merge and deployment because the five-minute bandwidth snapshots and repeat-load browser behavior only exist in the deployed environment.

## Production success criteria

After merge and deployment, collect new five-minute production snapshots. Phase 4 is successful when ordinary use remains below the 50 MB per five-minute budget, repeat static loads are locally served, and the ranked endpoint list no longer shows repeated large response bursts.
