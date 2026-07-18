import { describe, expect, it } from "vitest";
import { decideExplicitCompanyContext } from "../server/services/security/companyContextEnforcementAdapter";
import { authorizePrivilegedOperation } from "../server/services/security/privilegedOperationPolicy";
import { validateUnsafeOperationInput } from "../server/services/security/unsafeOperationValidation";
import { authorizeProtectedAssetAccess } from "../server/services/security/protectedAssetAccessPolicy";
import { toAuditLogInsert } from "../server/services/security/securityAuditRuntime";

const repairSchema = Object.freeze({
  fields: Object.freeze({
    containerIds: Object.freeze({ kind: "array" as const, required: true }),
    confirm: Object.freeze({ kind: "boolean" as const, required: true }),
    reason: Object.freeze({ kind: "string" as const, required: true, minLength: 3, maxLength: 500 }),
    idempotencyKey: Object.freeze({ kind: "string" as const, required: true, minLength: 8, maxLength: 200 }),
  }),
  allowUnknownFields: false,
  maxDepth: 3,
  maxArrayLength: 500,
  maxStringLength: 500,
});

describe("Program 5 end-to-end security model", () => {
  it("composes company scope, exact input, privileged authorization, protected asset access, and audit persistence", async () => {
    const session = {
      userId: "admin-7",
      currentRole: "Admin",
      currentCompanyId: 7,
      factoryCompanyId: 7,
      securityPermissions: ["factory.raw-stock.repair", "files.download"],
      passwordConfirmedAt: Date.now(),
    };

    const company = decideExplicitCompanyContext(session, [7], true);
    expect(company).toEqual({ allowed: true, companyId: 7, code: "COMPANY_CONTEXT_OK" });

    const payload = validateUnsafeOperationInput({
      operation: "factory.raw-stock.recalc.apply",
      schema: repairSchema,
      payload: {
        containerIds: [11, 12],
        confirm: true,
        reason: "Repair verified landed-cost drift",
        idempotencyKey: "raw-stock-repair-2026-07-18-001",
      },
    });
    expect(Object.isFrozen(payload)).toBe(true);

    const privileged = authorizePrivilegedOperation({
      actor: {
        userId: session.userId,
        role: session.currentRole,
        companyId: session.currentCompanyId,
        permissions: session.securityPermissions,
      },
      companyId: 7,
      domain: "factory",
      action: "factory.raw-stock.recalc.apply",
      kind: "repair",
      requiredPermission: "factory.raw-stock.repair",
      reason: payload.reason as string,
      idempotencyKey: payload.idempotencyKey as string,
      sourceType: "raw-stock-recalc",
      sourceId: "11,12",
      passwordConfirmedAt: session.passwordConfirmedAt,
    });
    expect(privileged.authorized).toBe(true);

    const asset = await authorizeProtectedAssetAccess(
      {
        async loadAsset() {
          return {
            id: 91,
            kind: "uploaded-file",
            companyId: 7,
            ownerUserId: "other-user",
            storageKey: "stored-files/91",
            fileName: "cost-audit.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byteSize: 2048,
            deletedAt: null,
          };
        },
      },
      {
        actor: {
          userId: session.userId,
          role: session.currentRole,
          companyId: session.currentCompanyId,
          permissions: session.securityPermissions,
        },
        assetId: 91,
        kind: "uploaded-file",
        action: "download",
        domain: "reporting",
        requiredPermission: "files.download",
      }
    );
    expect(asset.safeFileName).toBe("cost-audit.xlsx");

    const audit = toAuditLogInsert(
      {
        kind: "privileged-operation",
        action: "factory.raw-stock.recalc.apply",
        outcome: "allowed",
        companyId: 7,
        actorUserId: session.userId,
        targetType: "raw-stock-recalc",
        targetId: "11,12",
        reasonCode: "AUTHORIZED",
        occurredAt: Date.now(),
        metadata: { idempotencyKey: privileged.idempotencyKey },
      },
      "admin"
    );
    expect(audit.insert.action).toBe("SECURITY:privileged-operation:factory.raw-stock.recalc.apply:allowed");
    expect(audit.insert.companyId).toBe(7);
  });

  it("fails closed on a cross-company request before mutation or asset access", () => {
    expect(
      decideExplicitCompanyContext(
        { currentCompanyId: 7, factoryCompanyId: 7 },
        [8],
        true
      )
    ).toEqual({ allowed: false, companyId: 7, code: "COMPANY_CONTEXT_MISMATCH" });
  });
});
