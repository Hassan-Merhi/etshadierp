# Phase 10 — Scheduled and Email Export Memory Optimization

Status: **in progress** on `agent/memory-phase-1-stabilization`.

This phase reduces how long scheduled email and WhatsApp jobs retain complete XLSX, PDF, and ZIP Buffers. It does not change report contents, schedules, recipients, permissions, retry counts, or business calculations.

## Completed in the first block

### Reusable attachment sources

`server/helpers/exportAttachmentSource.ts` introduces one attachment type that can be either:

- an existing `Buffer`; or
- a temporary file path plus its verified size.

It includes size validation, file availability validation, Nodemailer attachment conversion, and on-demand Buffer reading for providers that cannot stream from disk.

### Sequential export email delivery

`server/services/emailService.ts` now:

- accepts Buffer-backed or file-backed ZIP attachments;
- rejects oversized attachments before opening SMTP;
- sends to recipients sequentially instead of starting every large attachment send concurrently;
- reuses one attachment descriptor across recipients;
- closes the Nodemailer transporter after success or failure;
- preserves the existing rule that one successful recipient makes the overall send successful while partial failures are logged.

Sequential delivery prevents multiple MIME/base64 encodings of the same large ZIP from existing at the same time.

### Deterministic temporary archive release

`server/helpers/temporaryExportArchive.ts` now exports `releaseTemporaryExportArchive()` for explicit cleanup in `finally` blocks.

### Scheduled artifact lifecycle

`server/helpers/scheduledExportArtifact.ts` builds one ZIP into a temporary file and returns:

- the file-backed attachment source;
- size and company metadata;
- an idempotent `dispose()` function.

`withScheduledExportArtifact()` guarantees archive deletion after the delivery callback finishes, including failures.

## Remaining Phase 10 wiring

The following callers still need to switch from buffered generation to `withScheduledExportArtifact()`:

1. `runDailyExport()` in `server/services/schedulerService.ts`
2. Manual email mode in `server/routes/exportRoutes.ts`
3. All-company scheduled net-position ZIP delivery

The stock-report scheduler also needs explicit per-file cleanup after each WhatsApp upload so its PDF Buffer is released before the net-position workbook is generated.

## WhatsApp constraint

Green API's current upload implementation uses the `form-data` package and `form.getBuffer()`. It therefore requires a complete multipart request body for each attempt. The Phase 10 target is to keep the export on disk between retries, read it only for the active attempt, and release the attempt Buffer immediately afterward.

The file must not remain in memory during retry delays.

## Safety constraints

- Do not regenerate the same export for each recipient or retry.
- Do not delete the temporary file until all enabled delivery channels finish.
- Always delete it in a `finally` block.
- Keep email and WhatsApp retries independent.
- Preserve current success, partial-failure, and run-tracking behavior.
- Do not change export calculations, workbook layout, or selected date ranges.
