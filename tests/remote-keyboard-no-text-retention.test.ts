import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const serviceSource = fs.readFileSync(
  path.join(process.cwd(), "server/services/remoteKeyboardCommandService.ts"),
  "utf8"
);
const auditSource = fs.readFileSync(
  path.join(process.cwd(), "server/services/remoteSupportAuditService.ts"),
  "utf8"
);

describe("remote keyboard metadata-only retention", () => {
  it("retains only command correlation metadata after delivery", () => {
    expect(serviceSource).toContain("interface RemoteKeyboardCommandReceipt");
    expect(serviceSource).toContain("const commandReceipts = new Map<string, RemoteKeyboardCommandReceipt>()");
    expect(serviceSource).toContain("commandReceipts.set(command.id, { sessionId: command.sessionId, createdAt: command.createdAt })");
    expect(serviceSource).not.toContain("const commandHistory = new Map<string, RemoteKeyboardCommand>()");
  });

  it("clears keyboard state immediately when the bounded support session stops", () => {
    expect(serviceSource).toContain("subscribeRemoteControlSessionStops");
    expect(serviceSource).toContain("installRemoteKeyboardSessionStopCleanup");
    expect(serviceSource).toContain("clearSessionKeyboardState(session.id, false)");
  });

  it("audits text length without storing inserted text", () => {
    expect(auditSource).toContain("textLength");
    expect(auditSource).toContain("Array.from(input.text).length");
    expect(auditSource).not.toContain('text: { new: input.text }');
  });
});
