import { describe, expect, it } from "vitest";
import {
  ProtectedAssetAccessError,
  assertExportCompanyScope,
  authorizeProtectedAssetAccess,
  sanitizeDownloadFileName,
  validateStorageKey,
  type ProtectedAssetLookup,
} from "../server/services/security/protectedAssetAccessPolicy";

const lookup: ProtectedAssetLookup = {
  async loadAsset(id, kind) {
    if (id === "missing") return null;
    return {
      id,
      kind,
      companyId: id === "cross" ? 11 : 10,
      ownerUserId: 7,
      storageKey: "company-10/reports/report.pdf",
      fileName: "report.pdf",
      byteSize: 128,
      deletedAt: id === "deleted" ? new Date() : null,
    };
  },
};

const actor = {
  userId: 7,
  role: "Manager",
  companyId: 10,
  permissions: ["reports.download"],
};

describe("protected asset access policy", () => {
  it("allows an authorized same-company download", async () => {
    const result = await authorizeProtectedAssetAccess(lookup, {
      actor,
      assetId: "asset-1",
      kind: "report-export",
      action: "download",
      requiredPermission: "reports.download",
    });
    expect(result.safeFileName).toBe("report.pdf");
    expect(result.disposition).toBe("attachment");
  });

  it("denies cross-company access even for Admin", async () => {
    await expect(
      authorizeProtectedAssetAccess(lookup, {
        actor: { userId: 1, role: "Admin", companyId: 10 },
        assetId: "cross",
        kind: "attachment",
        action: "read",
        requiredPermission: "attachments.read",
      })
    ).rejects.toMatchObject({ code: "CROSS_COMPANY_ACCESS_DENIED" });
  });

  it("returns non-leaking not found for missing or deleted assets", async () => {
    for (const assetId of ["missing", "deleted"]) {
      await expect(
        authorizeProtectedAssetAccess(lookup, {
          actor,
          assetId,
          kind: "attachment",
          action: "download",
          requiredPermission: "attachments.read",
        })
      ).rejects.toMatchObject({ message: "Not found" });
    }
  });

  it("allows explicit owner access only inside the same company", async () => {
    await expect(
      authorizeProtectedAssetAccess(lookup, {
        actor: { userId: 7, role: "User", companyId: 10 },
        assetId: "asset-1",
        kind: "uploaded-file",
        action: "read",
        requiredPermission: "files.read",
        allowOwnerAccess: true,
      })
    ).resolves.toMatchObject({ safeFileName: "report.pdf" });
  });

  it("rejects traversal-like storage keys", () => {
    for (const key of ["../secret", "/absolute/path", "folder//file", "folder\\file"]) {
      expect(() => validateStorageKey(key)).toThrowError(ProtectedAssetAccessError);
    }
  });

  it("sanitizes response filenames", () => {
    expect(sanitizeDownloadFileName("../quarterly/report.pdf")).toBe(".-quarterly-report.pdf");
    expect(() => sanitizeDownloadFileName("..")) .toThrowError(ProtectedAssetAccessError);
  });

  it("binds exports to the current company", () => {
    expect(assertExportCompanyScope(10, undefined)).toBe(10);
    expect(assertExportCompanyScope(10, "10")).toBe(10);
    expect(() => assertExportCompanyScope(10, 11)).toThrowError(ProtectedAssetAccessError);
  });
});
