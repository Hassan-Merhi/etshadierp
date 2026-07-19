import { describe, expect, it, vi } from "vitest";
import {
  inventoryRebuildInputSchema,
  requireValidatedUnsafeInput,
} from "../server/services/security/unsafeInputEnforcementAdapter";

function run(body: unknown) {
  const req: any = { body };
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res: any = { status };
  const next = vi.fn();

  requireValidatedUnsafeInput({
    operation: "inventory.rebuild",
    schema: inventoryRebuildInputSchema,
  })(req, res, next);

  return { req, status, json, next };
}

describe("unsafe input enforcement adapter", () => {
  it("accepts and freezes an approved dry-run payload", () => {
    const result = run({ dryRun: true });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.req.body)).toBe(true);
  });

  it("accepts the complete privileged apply payload", () => {
    const result = run({
      dryRun: false,
      reason: "Rebuild inventory after an approved audit",
      confirmationToken: "REBUILD-INVENTORY:7",
      idempotencyKey: "inventory-rebuild-2026-07-18-001",
      sourceId: "admin-ui",
    });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).not.toHaveBeenCalled();
  });

  it("rejects unknown fields before route logic", () => {
    const result = run({ dryRun: true, companyId: 999 });

    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({ message: "Invalid request" });
    expect(result.next).not.toHaveBeenCalled();
  });

  it("rejects invalid types and oversized values", () => {
    const invalidType = run({ dryRun: "false" });
    const oversized = run({ dryRun: false, reason: "x".repeat(501) });

    expect(invalidType.status).toHaveBeenCalledWith(400);
    expect(oversized.status).toHaveBeenCalledWith(400);
  });

  it("rejects prototype-pollution keys", () => {
    const payload = JSON.parse('{"dryRun":true,"__proto__":{"polluted":true}}');
    const result = run(payload);

    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.next).not.toHaveBeenCalled();
  });
});
