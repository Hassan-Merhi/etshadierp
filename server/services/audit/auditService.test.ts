import { beforeEach, describe, expect, it, vi } from "vitest";

const valuesMock = vi.fn();
const insertMock = vi.fn(() => ({ values: valuesMock }));
const loggerErrorMock = vi.fn();

vi.mock("../../db", () => ({
  db: {
    insert: insertMock,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { buildAuditChanges, sanitizeAuditValue, writeAuditEvent } from "./auditService";

describe("audit framework", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    valuesMock.mockResolvedValue(undefined);
  });

  it("redacts sensitive values recursively and bounds large values", () => {
    const result = sanitizeAuditValue({
      password: "secret-password",
      profile: {
        apiKey: "secret-key",
        name: "x".repeat(2_100),
      },
      rows: Array.from({ length: 120 }, (_, index) => index),
    }) as any;

    expect(result.password).toBe("[REDACTED]");
    expect(result.profile.apiKey).toBe("[REDACTED]");
    expect(result.profile.name.length).toBe(2_001);
    expect(result.rows).toHaveLength(100);
  });

  it("builds only changed fields and sanitizes them", () => {
    const changes = buildAuditChanges(
      { name: "Before", password: "old-secret", unchanged: 10 },
      { name: "After", password: "new-secret", unchanged: 10 }
    );

    expect(changes).toEqual({
      name: { old: "Before", new: "After" },
      password: { old: "[REDACTED]", new: "[REDACTED]" },
    });
  });

  it("writes a normalized audit event through the provided executor", async () => {
    await writeAuditEvent({
      userId: " 42 ",
      username: " Admin ",
      companyId: 3,
      action: "update",
      tableName: " vouchers ",
      recordId: 99,
      recordIdentifier: " V-99 ",
      changes: {
        authorization: { old: "Bearer old", new: "Bearer new" },
        amount: { old: "10", new: "12" },
      },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith({
      userId: "42",
      username: "Admin",
      companyId: 3,
      action: "update",
      tableName: "vouchers",
      recordId: 99,
      recordIdentifier: "V-99",
      changes: {
        authorization: { old: "[REDACTED]", new: "[REDACTED]" },
        amount: { old: "10", new: "12" },
      },
    });
  });

  it("logs safe failure context and rethrows database failures", async () => {
    const failure = new Error("database unavailable");
    valuesMock.mockRejectedValue(failure);

    await expect(
      writeAuditEvent({
        userId: "7",
        username: "Operator",
        action: "create",
        tableName: "sales",
        changes: { password: { new: "must-not-leak" } },
      })
    ).rejects.toBe(failure);

    expect(loggerErrorMock).toHaveBeenCalledWith("Audit write failed", {
      module: "audit",
      action: "write_failed",
      auditAction: "create",
      tableName: "sales",
      recordId: null,
      companyId: null,
      userId: "7",
      error: "database unavailable",
    });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain("must-not-leak");
  });

  it("rejects missing actor and target identifiers before writing", async () => {
    await expect(
      writeAuditEvent({ userId: " ", username: "Admin", action: "delete", tableName: "users" })
    ).rejects.toThrow("Audit userId is required");
    expect(insertMock).not.toHaveBeenCalled();
  });
});
