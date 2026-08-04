import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSION_BY_KEY } from "../shared/permissionConfig";

const REQUIRED_PERMISSIONS = [
  "remote_support_view",
  "remote_support_mouse",
  "remote_support_keyboard",
  "remote_support_audit",
] as const;

describe("remote support permission contract", () => {
  it("registers four separately configurable remote support permissions", () => {
    for (const key of REQUIRED_PERMISSIONS) {
      expect(PERMISSION_BY_KEY[key], key).toMatchObject({
        key,
        group: "Remote Support",
        type: "action",
      });
    }
  });

  it("enforces view, mouse, keyboard and audit permissions server-side", () => {
    const screenRoutes = fs.readFileSync("server/routes/screenFeedRoutes.ts", "utf8");
    const mouseRoutes = fs.readFileSync("server/routes/remoteControlSessionRoutes.ts", "utf8");
    const keyboardRoutes = fs.readFileSync("server/routes/remoteKeyboardControlRoutes.ts", "utf8");
    const auditRoutes = fs.readFileSync("server/routes/remoteSupportAuditRoutes.ts", "utf8");

    expect(screenRoutes).toContain('requireActionAccess("remote_support_view")');
    expect(mouseRoutes).toContain('requireActionAccess("remote_support_view")');
    expect(mouseRoutes).toContain('requireActionAccess("remote_support_mouse")');
    expect(keyboardRoutes).toContain('requireActionAccess("remote_support_keyboard")');
    expect(auditRoutes).toContain('requireActionAccess("remote_support_audit")');
  });

  it("keeps the permanent audit endpoint company scoped and remote-support only", () => {
    const auditRoutes = fs.readFileSync("server/routes/remoteSupportAuditRoutes.ts", "utf8");
    expect(auditRoutes).toContain("getSessionCompanyId(req)");
    expect(auditRoutes).toContain('eq(auditLog.tableName, "remote_support_sessions")');
    expect(auditRoutes).toContain('eq(auditLog.companyId, companyId)');
  });
});
