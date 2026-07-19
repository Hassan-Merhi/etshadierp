import { describe, expect, it } from "vitest";
import {
  authorizeProtectedAssetAccess,
  ProtectedAssetAccessError,
  sanitizeDownloadFileName,
} from "../server/services/security/protectedAssetAccessPolicy";
import { AuthorizationDeniedError } from "../server/services/security/authorizationPolicy";

const asset = {
  id: 41,
  kind: "uploaded-file" as const,
  companyId: 7,
  ownerUserId: null,
  storageKey: "stored-files/41",
  fileName: "Quarterly / Report.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  byteSize: 2048,
  deletedAt: null,
};

const lookup = {
  async loadAsset(id: string | number, kind: string) {
    return String(id) === "41" && kind === "uploaded-file" ? asset : null;
  },
};

describe("stored file protected access", () => {
  it("allows a same-company actor with the exact permission", async () => {
    const decision = await authorizeProtectedAssetAccess(lookup, {
      actor: { userId: "u1", role: "Admin", companyId: 7, permissions: ["files.download"] },
      assetId: 41,
      kind: "uploaded-file",
      action: "download",
      requiredPermission: "files.download",
      allowedRoles: [],
    });
    expect(decision.asset.companyId).toBe(7);
    expect(decision.safeFileName).toBe("Quarterly - Report.xlsx");
  });

  it("denies role-only access when the named permission is absent", async () => {
    await expect(
      authorizeProtectedAssetAccess(lookup, {
        actor: { userId: "u1", role: "Admin", companyId: 7, permissions: [] },
        assetId: 41,
        kind: "uploaded-file",
        action: "download",
        requiredPermission: "files.download",
        allowedRoles: [],
      })
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("denies cross-company access without disclosing the asset", async () => {
    await expect(
      authorizeProtectedAssetAccess(lookup, {
        actor: { userId: "u2", role: "Admin", companyId: 8, permissions: ["files.download"] },
        assetId: 41,
        kind: "uploaded-file",
        action: "read",
        requiredPermission: "files.download",
        allowedRoles: [],
      })
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("rejects missing and malformed assets", async () => {
    await expect(
      authorizeProtectedAssetAccess(lookup, {
        actor: { userId: "u1", role: "Admin", companyId: 7, permissions: ["files.download"] },
        assetId: 0,
        kind: "uploaded-file",
        action: "download",
        requiredPermission: "files.download",
      })
    ).rejects.toBeInstanceOf(ProtectedAssetAccessError);
  });

  it("sanitizes traversal and header-control characters from names", () => {
    expect(sanitizeDownloadFileName("../folder\\report\n.csv")).toBe(".-folder-report.csv");
  });
});
