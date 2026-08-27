import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  assertTransactionCompanyScope,
  TransactionCompanyScopeError,
} from "../server/services/security/transactionCompanyScope";
import { runWithCompanyRequestRuntimeContext } from "../server/services/security/companyRequestRuntimeContext";

function requestContext(companyId: number, authorizedCompanyIds: readonly number[] = []) {
  return {
    userId: "phase-3-rls-user",
    companyId,
    authorizedCompanyIds,
    role: "Admin",
    developerBypass: false,
    method: "POST",
    path: "/api/phase-3-rls-test",
  };
}

function transactionStub() {
  const execute = vi.fn(async (_query: SQL) => undefined);
  return { tx: { execute }, execute };
}

describe("transaction company scope request binding", () => {
  it("allows the canonical request company to become transaction-local RLS scope", async () => {
    const { tx, execute } = transactionStub();

    const companyId = await runWithCompanyRequestRuntimeContext(requestContext(101), () =>
      assertTransactionCompanyScope(tx, 101)
    );

    expect(companyId).toBe(101);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("allows a secondary company only after the request boundary verified it", async () => {
    const { tx, execute } = transactionStub();

    const companyId = await runWithCompanyRequestRuntimeContext(requestContext(101, [202]), () =>
      assertTransactionCompanyScope(tx, 202)
    );

    expect(companyId).toBe(202);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails before touching PostgreSQL when a service drifts to another tenant", async () => {
    const { tx, execute } = transactionStub();

    await expect(
      runWithCompanyRequestRuntimeContext(requestContext(101), () => assertTransactionCompanyScope(tx, 202))
    ).rejects.toMatchObject({
      name: "TransactionCompanyScopeError",
      code: "TRANSACTION_COMPANY_SCOPE_INVALID",
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("does not let Developer bypass the active request company", async () => {
    const { tx, execute } = transactionStub();
    const context = { ...requestContext(303), role: "Developer", developerBypass: true };

    await expect(
      runWithCompanyRequestRuntimeContext(context, () => assertTransactionCompanyScope(tx, 404))
    ).rejects.toBeInstanceOf(TransactionCompanyScopeError);

    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves explicit scoping for background work with no request context", async () => {
    const { tx, execute } = transactionStub();

    await expect(assertTransactionCompanyScope(tx, 505)).resolves.toBe(505);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
