import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../server/db", () => ({
  db: {
    select: harness.select,
    insert: harness.insert,
  },
}));

vi.mock("../server/lib/logger", () => ({
  logger: {
    error: harness.loggerError,
  },
}));

import { logAIAction, requireAIActionPermission } from "../server/lib/aiActionPermission";

function request(session: Record<string, unknown>): Request {
  return { session } as unknown as Request;
}

function enableUser(enabled: boolean) {
  harness.where.mockResolvedValueOnce([{ chatbotEnabled: enabled }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.from.mockReturnValue({ where: harness.where });
  harness.select.mockReturnValue({ from: harness.from });
  harness.values.mockResolvedValue(undefined);
  harness.insert.mockReturnValue({ values: harness.values });
});

describe("AI action permission", () => {
  it("requires an authenticated session before touching the database", async () => {
    const denial = await requireAIActionPermission(request({ currentRole: "Admin" }), "read");

    expect(denial).toEqual({ code: 401, message: "Unauthorized" });
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("denies every action tier when the assistant is disabled", async () => {
    enableUser(false);
    const denial = await requireAIActionPermission(request({ userId: "u1", currentRole: "Admin" }), "read");

    expect(denial?.code).toBe(403);
    expect(harness.select).toHaveBeenCalledTimes(1);
  });

  it("allows chatbot-enabled read actions for a POS role", async () => {
    enableUser(true);
    const denial = await requireAIActionPermission(request({ userId: "u1", currentRole: "POS User" }), "read");

    expect(denial).toBeNull();
  });

  it("blocks draft and write actions for POS roles", async () => {
    enableUser(true);
    const draftDenial = await requireAIActionPermission(request({ userId: "u1", currentRole: "POS User" }), "draft");
    expect(draftDenial?.code).toBe(403);

    enableUser(true);
    const writeDenial = await requireAIActionPermission(request({ userId: "u1", currentRole: "POS User" }), "write");
    expect(writeDenial?.code).toBe(403);
  });

  it("allows draft and write actions for approved non-POS roles", async () => {
    for (const role of ["Developer", "Admin", "Owner", "Manager", "Normal User"]) {
      enableUser(true);
      expect(await requireAIActionPermission(request({ userId: "u1", currentRole: role }), "write")).toBeNull();
    }
  });
});

describe("AI action audit logging", () => {
  it("does not write an audit row without both user and company identity", async () => {
    await logAIAction({
      req: request({ userId: "u1" }),
      actionType: "read",
      actionName: "chat_message",
      status: "success",
    });
    await logAIAction({
      req: request({ currentCompanyId: 7 }),
      actionType: "read",
      actionName: "chat_message",
      status: "success",
    });

    expect(harness.insert).not.toHaveBeenCalled();
  });

  it("records the action tier, identity, payloads, status, and created record", async () => {
    const inputJson = { query: "stock" };
    const outputJson = { id: 42 };

    await logAIAction({
      req: request({ userId: "u1", currentCompanyId: 7 }),
      actionType: "write",
      actionName: "stock_transfer",
      inputJson,
      outputJson,
      status: "success",
      createdRecordId: 42,
    });

    expect(harness.insert).toHaveBeenCalledTimes(1);
    expect(harness.values).toHaveBeenCalledWith({
      userId: "u1",
      companyId: 7,
      actionType: "write",
      actionName: "stock_transfer",
      inputJson,
      outputJson,
      status: "success",
      createdRecordId: 42,
    });
  });

  it("keeps the primary request alive when audit logging fails", async () => {
    harness.values.mockRejectedValueOnce(new Error("audit database unavailable"));

    await expect(
      logAIAction({
        req: request({ userId: "u1", currentCompanyId: 7 }),
        actionType: "draft",
        actionName: "po_import",
        status: "error",
      })
    ).resolves.toBeUndefined();
    expect(harness.loggerError).toHaveBeenCalledTimes(1);
  });
});
