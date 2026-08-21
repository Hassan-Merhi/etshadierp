# Phase 9 — Build and performance polish

## Spreadsheet loading

The Spreadsheet Editor is intentionally lazy at two levels:

- The page is loaded through `client/src/lazyPages.ts`.
- Spreadsheet parsing, ExcelJS synchronization, and native XLSX download are loaded only when the corresponding operation is used.

The Vite build keeps the heavy dependencies separate:

- `fortune-sheet-vendor` contains the spreadsheet canvas and remains route-triggered.
- `exceljs-vendor` contains ExcelJS parsing/synchronization and is loaded by spreadsheet or export flows.
- `xlsx-vendor` contains the native XLSX writer and is loaded by XLSX export flows.

The route entry itself is therefore small; the large dependency files are not part of the initial ERP shell payload. The large Fortune Sheet and ExcelJS/XLSX files are expected tradeoffs for the capabilities they provide and are not bundled into the server artifact.

## Remaining build warnings

### PostCSS `from` warning

The warning:

> A PostCSS plugin did not pass the `from` option to `postcss.parse`.

comes from the current Tailwind CSS 3 plugin path. Tailwind's internal preflight/rule generation calls `postcss.parse` without forwarding a source filename. The project also contains Tailwind 4 tooling, but the application currently uses the Tailwind 3 configuration and directives. Migrating the whole stylesheet pipeline would be a broader visual-risk change, so the warning is documented rather than suppressed or patched inside `node_modules`.

### ExcelJS `eval` warning

The warning points to the upstream minified `exceljs` browser distribution. It is emitted by Vite's dependency scanner because that upstream file contains an `eval` expression. ExcelJS is required for workbook fidelity and advanced spreadsheet features; replacing or modifying the vendor bundle would risk import/export behavior. The warning is retained and documented rather than hiding it or changing the package contents.

## Verification

The Phase 9 build checks remain:

- TypeScript check
- Production Vite build
- Server bundle verification
- Runtime dependency verification

The build should continue to report the documented PostCSS and upstream ExcelJS warnings while passing all verification steps.