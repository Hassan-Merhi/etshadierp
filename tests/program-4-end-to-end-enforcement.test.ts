import { beforeEach, describe, expect, it, vi } from "vitest";

const auditValues = vi.fn(async () => undefined);
const auditInsert = vi.fn(() => ({ values: auditValues }));

vi.mock("../server/db", () => ({
  db: {
    insert: auditInsert,
  },
}));

import {
  inventoryRebuildInputSchema,
  requireValidatedUnsafeInput,
} from "../server/services/security/unsafeInputEnforcementAdapter";
import { requirePrivilegedOperation } from "../server/services/security/privilegedOperationEnforcementAdapter";
import { detectSecurityAnomalies } from "../server/services/security/securityAuditPolicy";

function responseDouble() {
  return {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

function requestDouble(overrides: Record<string, unknown> = {}) {
  return {
    body: {
      dryRun: false,
      reason: "Verified repair requested by administrator",
      confirmationToken: "REBUILD-INVENTORY:7",
      idempotencyKey: "inventory-rebuild-2026-07-18-001",
      sourceId: "manual-admin-repair-1",
    },
    session: {
      userId: "user-7",
      username: "admin",
      currentRole: "Admin",
      currentCompanyId: 7,
      securityPermissions: ["administration.repair"],
      passwordConfirmedAt: Date.now(),
    },
    method: "POST",
    path: "/api/admin/rebuild-inventory",
    ip: "127.0.0.1",
    get: (header: string) => (header.toLowerCase() === "user-agent" ? "vitest" : undefined),
    ...overrides,
  } as any;
}

const validation = requireValidatedUnsafeInput({
  operation: "inventory.rebuild",
  schema: inventoryRebuildInputSchema,
});

const privileged = requirePrivilegedOperation({
  domain: "inventory",
  action: "inventory.rebuild",
  kind: "recalculate",
  requiredPermission: "administration.repair",
  sourceType: "inventory-rebuild-request",
  expectedConfirmationToken: (companyId) => `REBUILD-INVENTORY:${companyId}`,
  allowDryRun: true,
});

async function executeChain(req: any) {
  const res = responseDouble();
  let routeReached = false;
  let forwardedError: unknown;

  await new Promise<void>((resolve) => {
    validation(req, res as any, (validationError?: unknown) => {
      if (validationError) {
        forwardedError = validationError;
        resolve();
        return;
      }
      Promise.resolve(
        privileged(req, res as any, (privilegedError?: unknown) => {
          forwardedError = privilegedError;
          if (!privilegedError) routeReached = true;
        })
      ).finally(resolve);
    });
  });

  return { res, routeReached, forwardedError };
}

describe("Program 4 end-to-end enforcement", () => {
  beforeEach(() => {
    auditInsert.mockClear();
    auditValues.mockClear();
    auditValues.mockResolvedValue(undefined);
  });

  it("validates, authorizes, audits, and reaches route logic for an approved repair", async () => {
    const req = requestDouble();
    const result = await executeChain(req);

    expect(result.forwardedError).toBeUndefined();
    expect(result.routeReached).toBe(true);
    expect(Object.isFrozen(req.body)).toBe(true);
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const inserted = auditValues.mock.calls[0][0];
    expect(inserted.action).toBe("SECURITY:privileged-operation:inventory.rebuild:allowed");
    expect(inserted.companyId).toBe(7);
    expect(inserted.changes.metadata).not.toHaveProperty("confirmationToken");
  });

  it("rejects unsafe and cross-company assertion fields before authorization", async () => {
    const req = requestDouble({
      body: {
        dryRun: false,
        reason: "repair",
        confirmationToken: "REBUILD-INVENTORY:7",
        idempotencyKey: "inventory-rebuild-001",
        sourceId: "manual",
        companyId: 99,
      },
    });
    const result = await executeChain(req);

    expect(result.res.statusCode).toBe(400);
    expect(result.routeReached).toBe(false);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid idempotency key before privileged authorization", async () => {
    const req = requestDouble();
    req.body.idempotencyKey = "short";
    const result = await executeChain(req);

    expect(result.res.statusCode).toBe(400);
    expect(result.routeReached).toBe(false);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["missing permission", { securityPermissions: ["reports.read"] }, "PERMISSION_REQUIRED"],
    [
      "stale password proof",
      { passwordConfirmedAt: Date.now() - 10 * 60 * 1000 },
      "PRIVILEGED_PASSWORD_CONFIRMATION_REQUIRED",
    ],
  ])("denies and audits %s", async (_label, sessionPatch, expectedReason) => {
    const base = requestDouble();
    base.session = { ...base.session, ...sessionPatch };
    const result = await executeChain(base);

    expect(result.res.statusCode).toBe(403);
    expect(result.routeReached).toBe(false);
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const inserted = auditValues.mock.calls[0][0];
    expect(inserted.action).toBe("SECURITY:privileged-operation:inventory.rebuild:denied");
    expect(inserted.changes.reasonCode).toBe(expectedReason);
  });

  it("denies and audits an invalid company-bound confirmation token", async () => {
    const req = requestDouble();
    req.body.confirmationToken = "REBUILD-INVENTORY:8";
    const result = await executeChain(req);

    expect(result.res.statusCode).toBe(403);
    expect(result.routeReached).toBe(false);
    expect(auditValues.mock.calls[0][0].changes.reasonCode).toBe("PRIVILEGED_CONFIRMATION_REQUIRED");
  });

  it("fails closed when an allowed decision cannot be persisted", async () => {
    auditValues.mockRejectedValueOnce(new Error("audit unavailable"));
    const result = await executeChain(requestDouble());

    expect(result.routeReached).toBe(false);
    expect(result.forwardedError).toBeInstanceOf(Error);
  });

  it("classifies repeated privileged denials as anomalies", () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, index) => ({
      eventKey: `event-${index}`,
      kind: "privileged-operation" as const,
      severity: "critical" as const,
      action: "inventory.rebuild",
      outcome: "denied" as const,
      companyId: 7,
      actorUserId: "user-7",
      targetType: "inventory-rebuild-request",
      targetId: String(index),
      reasonCode: "PERMISSION_REQUIRED",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: now - index * 1000,
      metadata: {},
    }));

    expect(detectSecurityAnomalies(events, { now, denialThreshold: 5 }).map((item) => item.code)).toEqual(
      expect.arrayContaining(["REPEATED_DENIALS", "PRIVILEGED_OPERATION_FAILURE"])
    );
  });
});
