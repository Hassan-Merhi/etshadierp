# Phase 10 — Scheduled and Email Export Memory Optimization

Status: **implementation complete** on `agent/memory-phase-1-stabilization`.

This phase reduces how long scheduled email and WhatsApp jobs retain complete XLSX, PDF, ZIP, and multipart request Buffers. It does not change report contents, schedules, recipients, permissions, retry counts, success rules, or business calculations.

## Attachment source support

`server/helpers/exportAttachmentSource.ts` supports:

- ordinary in-memory Buffers;
- explicit temporary-file attachment sources;
- Buffer-compatible managed file markers produced by the scheduled attachment bridge.

The helper validates attachment availability and size, passes file paths directly to Nodemailer, materializes bytes only when a provider requires them, refreshes managed cleanup timers during active use, and provides explicit release support.

## Sequential export email delivery

`server/services/emailService.ts` now:

- accepts Buffer-backed or file-backed ZIP attachments;
- rejects oversized attachments before opening SMTP;
- sends to recipients sequentially instead of creating several large MIME/base64 bodies concurrently;
- reuses one attachment descriptor across recipients and retries;
- closes the Nodemailer transporter after success or failure;
- preserves the existing partial-delivery success behavior.

A file-backed attachment is streamed by Nodemailer and does not need to be loaded into a complete application Buffer.

## Explicit artifact lifecycle helpers

`server/helpers/temporaryExportArchive.ts` exports `releaseTemporaryExportArchive()` for deterministic cleanup.

`server/helpers/scheduledExportArtifact.ts` can build one ZIP into a temporary file and return:

- the file-backed attachment source;
- size and company metadata;
- an idempotent `dispose()` function.

`withScheduledExportArtifact()` guarantees archive deletion after its delivery callback finishes.

## Scheduled compatibility bridge

`server/scheduledAttachmentBridge.mjs` is preloaded in development and production after the Phase 9 export bridge.

It protects existing scheduler and manual-email callers without rewriting the large scheduler route file:

- final application-owned ZIP and PDF `Buffer.concat()` results are written to managed temporary files;
- background ExcelJS `writeBuffer()` results are written to managed temporary XLSX files;
- returned markers remain `Buffer.isBuffer(...) === true` and expose the real byte length, preserving existing size checks and route behavior;
- email receives the managed file path directly;
- WhatsApp retains only a small marker during retry delays;
- file bytes are read only while the active multipart upload is being created;
- orphaned managed files have a bounded cleanup timer.

This covers:

1. daily scheduled full exports;
2. manual email exports;
3. scheduled all-company net-position ZIPs;
4. scheduled stock PDFs;
5. scheduled net-position workbooks.

## WhatsApp multipart serialization

Green API requires the existing `form-data` and `form.getBuffer()` upload format. The bridge therefore defers multipart construction until the patched `fetch` call begins.

A global upload queue allows only one managed large WhatsApp multipart body to be materialized at a time. Multi-recipient sends may still perform their network requests through the existing service flow, but they cannot hold several complete multipart attachment bodies in memory simultaneously.

After an upload attempt completes, the multipart Buffer becomes unreachable while the reusable export remains on disk for any later retry or delivery channel.

## Cleanup policy

- Active email or WhatsApp use refreshes the managed-file cleanup timer.
- Default active cleanup delay: 15 minutes.
- Default orphan cleanup delay: 60 minutes.
- Phase 9 startup cleanup also removes stale files from the shared export temporary directory.
- Explicit lifecycle helpers remain preferred for new scheduled workflows that can use `finally` cleanup directly.

Configuration:

- `SCHEDULED_ATTACHMENT_MIN_BYTES` — default `131072`;
- `SCHEDULED_ATTACHMENT_CLEANUP_DELAY_MS` — default `900000`;
- `SCHEDULED_ATTACHMENT_ORPHAN_CLEANUP_DELAY_MS` — default `3600000`;
- `SCHEDULED_ATTACHMENT_FORCE=1` — verifier-only override;
- `EXPORT_BRIDGE_TEMP_DIR` — shared temporary directory override.

## Verification

A focused smoke verifier is available at:

`node scripts/verify-phase10-scheduled-attachments.mjs`

It checks:

- file-backed ZIP markers;
- real marker length compatibility;
- managed files written with valid ZIP signatures;
- deferred WhatsApp multipart construction;
- one-at-a-time multipart uploads;
- file-backed background Excel workbooks.

The verifier and CI were intentionally not executed while editing this isolated branch.

## Safety constraints preserved

- The same export is not regenerated for each recipient or retry.
- Email and WhatsApp retries remain independent.
- Existing run tracking and partial-failure behavior remain unchanged.
- Export calculations, workbook layout, selected date ranges, and recipient configuration are unchanged.
