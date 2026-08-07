# Phase 10 — Scheduled Export Memory Lifecycle

Phase 10 makes file-backed export artifacts the primary path for scheduled daily exports and manual email exports. Large ZIP, workbook, and PDF attachments remain reusable across delivery retries without remaining as long-lived complete Buffers in application memory.

## Explicit daily export lifecycle

The scheduled daily export now calls `createScheduledExportArtifact` once. The export is streamed into a temporary ZIP file and represented as:

```ts
{ filePath, sizeBytes }
```

The same file-backed source is reused for:

- sequential email delivery;
- WhatsApp delivery;
- email retries;
- WhatsApp retries;
- export-run size and company metadata.

The daily scheduler no longer calls the buffered full-export ZIP builder for its main export. Existing schedule enablement, three-year date range, company selection, retry counts, retry delays, success/partial-failure rules, run tracking, and recipient settings remain unchanged.

## Manual email export lifecycle

Manual email exports from `/api/export/start` now use the same explicit temporary artifact lifecycle. The HTTP request still returns the background job immediately, progress messages remain available, and the email is retried according to the existing policy.

Manual download exports continue to stream a temporary ZIP to the browser and preserve the existing single-use download cleanup behavior.

## Sequential email delivery

Nodemailer receives a file path for file-backed exports. It streams the attachment for each recipient rather than creating several full MIME encodings concurrently.

Recipients remain sequential. SMTP verification, Gmail size checks, subject/body text, filenames, recipient selection, partial-delivery logging, and transporter shutdown remain unchanged.

## Serialized WhatsApp materialization

Green API requires the `form-data` package and a complete multipart body. Phase 10 therefore keeps the reusable export on disk and materializes it only while one active scheduled-export upload owns the global materialization slot.

`withSerializedExportAttachmentBuffer` provides this boundary:

1. wait for the previous file-backed upload;
2. verify the source file and expected size;
3. read one complete attachment Buffer;
4. build the required Green API multipart body;
5. await the upload response;
6. release the slot in `finally`.

Ordinary in-memory POS, invoice, image, and small PDF sends keep their existing direct path and are not forced through the scheduled-export queue.

## Deterministic cleanup

Explicit scheduled and manual artifacts use `try/finally` disposal. Their temporary ZIP files are removed after all configured delivery attempts finish, regardless of success, partial failure, configuration failure, or thrown errors.

Scheduled stock-report PDF and net-position workbook markers are released after their individual WhatsApp attempts. Scheduled all-company net-position ZIP markers are released after WhatsApp and email delivery finish.

Startup stale-file cleanup remains available for process crashes and hard restarts. Timer cleanup remains a fallback for compatibility-created managed markers, not the primary ownership mechanism for the new daily/manual paths.

## Attachment source contract

`ExportAttachmentSource` supports:

- ordinary in-memory `Buffer` attachments;
- explicit `{ filePath, sizeBytes }` sources;
- compatibility Buffer markers backed by temporary files.

Shared helpers provide size validation, Nodemailer file-path conversion, managed-marker release, and serialized file-backed materialization.

## Compatibility bridge

`server/scheduledAttachmentBridge.mjs` remains loaded in development and production as a compatibility boundary for older background exporters that still call `Buffer.concat` or `workbook.xlsx.writeBuffer()`.

Phase 10 no longer depends on that bridge for the primary daily full-export and manual email paths. Removing the bridge entirely remains a later migration only after every remaining scheduled PDF/workbook producer has an explicit streaming or file-backed API.

## Behavior retained

- No report rows, accounting values, inventory values, costing values, or workbook formulas change.
- Existing schedules, time zones, recipients, captions, names, MIME types, attachment limits, and retry policies remain unchanged.
- Email and WhatsApp can still succeed independently and produce a partial-failure run status.
- Manual export job status and progress reporting remain unchanged.
- No new background polling or database queries are introduced.

## Database changes

No SQL, schema migration, settings backfill, or production data repair is required for Phase 10.

## Deferred verification

Source contracts now cover the explicit daily lifecycle, manual email lifecycle, serialized file-backed WhatsApp materialization, ordinary Buffer compatibility, sequential email delivery, and deterministic cleanup.

The existing attachment smoke verifier remains available for file-marker and multipart behavior, and the new source verifier covers the production wiring:

```bash
node scripts/verify-phase10-scheduled-export-lifecycle.mjs
node scripts/verify-phase10-scheduled-attachments.mjs
node node_modules/vitest/vitest.mjs run tests/phase10-scheduled-export-lifecycle-contract.test.ts
```

These commands, TypeScript compilation, lint, integration tests, production build, memory profiling, provider delivery tests, deployment checks, and CI were not run during this phase. They remain deferred to the final all-phase verification pass.

## Merge order

Phase 10 is stacked with Phase 9 after the Phase 5–6 and Phase 7–8 pull requests. Merge the earlier stacked pull requests first, then integrate the Phase 9–10 pull request only after explicit owner authorization.
