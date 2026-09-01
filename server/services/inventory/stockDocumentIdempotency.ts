import { and, desc, eq, sql } from "drizzle-orm";
import { auditLog } from "@shared/schema";
import type { db } from "../../db";

/** The caller's own transaction, so the marker commits with the document. */
export type StockDocumentIdempotencyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The audit_log marker table name. Stock documents reuse the same mechanism the
 * central posting engine uses for vouchers, so no schema migration is needed and
 * there is one place to look when asking whether a request was already served.
 */
const STOCK_DOCUMENT_IDEMPOTENCY_TABLE = "stock_document_idempotency";

export class StockDocumentIdempotencyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StockDocumentIdempotencyError";
    this.code = code;
  }
}

/**
 * Normalises the client-supplied request id.
 *
 * Returns null when the caller supplied none: a request without a key is served
 * as it always was. Inventing a key from the payload instead would be worse than
 * no key at all, because two genuinely separate transfers of the same items on
 * the same day are indistinguishable by payload, and silently dropping the
 * second one loses stock movement that really happened.
 */
export function resolveStockDocumentRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > 200) {
    throw new StockDocumentIdempotencyError(
      "STOCK_DOCUMENT_REQUEST_ID_INVALID",
      "clientRequestId must be 200 characters or fewer"
    );
  }
  return normalized;
}

/** The deterministic key a document is recorded under. */
export function stockDocumentIdempotencyKey(input: {
  sourceType: string;
  companyId: number;
  clientRequestId: string;
}): string {
  return `${input.sourceType}:${input.companyId}:${input.clientRequestId}`;
}

/**
 * Looks up a document already created for this key, taking a transaction-scoped
 * advisory lock on the key first.
 *
 * The lock is what makes two simultaneous submissions safe rather than merely
 * usually safe: the second one blocks until the first commits, and then sees the
 * marker instead of racing past an empty read and creating a second document.
 * It is released with the transaction either way.
 */
export async function findExistingStockDocumentTx(input: {
  tx: StockDocumentIdempotencyTransaction;
  companyId: number;
  idempotencyKey: string;
}): Promise<number | null> {
  await input.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-document:${input.idempotencyKey}`}))`);

  const [marker] = await input.tx
    .select({ documentId: auditLog.recordId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, input.companyId),
        eq(auditLog.tableName, STOCK_DOCUMENT_IDEMPOTENCY_TABLE),
        eq(auditLog.recordIdentifier, input.idempotencyKey)
      )
    )
    .orderBy(desc(auditLog.id))
    .limit(1);

  if (!marker) return null;

  const documentId = Number(marker.documentId);
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new StockDocumentIdempotencyError(
      "STOCK_DOCUMENT_IDEMPOTENCY_CORRUPT",
      `Idempotency marker ${input.idempotencyKey} has no valid document reference`
    );
  }
  return documentId;
}

/**
 * Records the marker inside the same transaction as the document it describes,
 * so a rolled-back document leaves no marker claiming it exists.
 */
export async function recordStockDocumentTx(input: {
  tx: StockDocumentIdempotencyTransaction;
  companyId: number;
  idempotencyKey: string;
  documentId: number;
  sourceType: string;
  actorUserId?: string | null;
}): Promise<void> {
  await input.tx.insert(auditLog).values({
    userId: input.actorUserId ? String(input.actorUserId) : "system",
    username: "stock-document-idempotency",
    companyId: input.companyId,
    action: "create",
    tableName: STOCK_DOCUMENT_IDEMPOTENCY_TABLE,
    recordId: input.documentId,
    recordIdentifier: input.idempotencyKey,
    changes: {
      sourceType: { new: input.sourceType },
      idempotencyKey: { new: input.idempotencyKey },
    },
  });
}
