import type { Request } from "express";
import { DurableFinancialOperationError } from "./durableFinancialOperation";

export function financialOperationRequestPayload(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const { clientRequestId: _clientRequestId, ...payload } = body as Record<string, unknown>;
  return payload;
}

export function resolveFinancialOperationKey(req: Request): string {
  const header = req.get("X-Idempotency-Key")?.trim() || "";
  const bodyValue =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body.clientRequestId : undefined;
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";

  if (header && body && header !== body) {
    throw new DurableFinancialOperationError(
      "FINANCIAL_OPERATION_IDEMPOTENCY_CONFLICT",
      "X-Idempotency-Key and clientRequestId must match when both are supplied"
    );
  }
  const key = header || body;
  if (!key) {
    throw new DurableFinancialOperationError(
      "FINANCIAL_OPERATION_ID_REQUIRED",
      "This financial operation requires X-Idempotency-Key or clientRequestId"
    );
  }
  return key;
}

export function financialOperationErrorStatus(error: unknown): number {
  if (!(error instanceof DurableFinancialOperationError)) return 500;
  if (
    error.code === "FINANCIAL_OPERATION_ID_REQUIRED" ||
    error.code === "FINANCIAL_OPERATION_ID_INVALID" ||
    error.code === "FINANCIAL_OPERATION_COMPANY_INVALID"
  ) {
    return 400;
  }
  if (
    error.code === "FINANCIAL_OPERATION_IDEMPOTENCY_CONFLICT" ||
    error.code === "FINANCIAL_OPERATION_OUTCOME_UNCERTAIN" ||
    error.code === "FINANCIAL_OPERATION_STATE_UNAVAILABLE"
  ) {
    return 409;
  }
  return 500;
}