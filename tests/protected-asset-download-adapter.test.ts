import { describe, expect, it } from "vitest";
import {
  attachmentContentDisposition,
  authorizeContainerDocumentDownload,
} from "../server/services/security/protectedAssetDownloadAdapter";
import { ProtectedAssetAccessError } from "../server/services/security/protectedAssetAccessPolicy";
import type { AuthorizationActor } from "../server/services/security/authorizationPolicy";

const actor: AuthorizationActor = {
  userId: "user-1",
  role: "Manager",
  companyId: 10,
  permissions: [],
};

function lookupFor(overrides: Partial<any> = {}) {
  return {
    async loadAsset() {
      return {
        id: 1,
        kind: "attachment" as const,
        companyId: 10,
        ownerUserId: "user-2",
        storageKey: "container-docs/file.pdf",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        byteSize: 1024,
        deletedAt: null,
        ...overrides,
      };
    },
  };
}

describe("protected container document download adapter", () => {
  it("allows an authenticated same-company role and returns a sanitized attachment name", async () => {
    const decision = await authorizeContainerDocumentDownload(
      lookupFor(),
      actor,
      "container-docs/file.pdf"
    );
    expect(decision.asset.companyId).toBe(10);
    expect(decision.safeFileName).toBe("invoice.pdf");
    expect(decision.disposition).toBe("attachment");
  });

  it("denies cross-company access without revealing the asset", async () => {
    await expect(
      authorizeContainerDocumentDownload(
        lookupFor({ companyId: 11 }),
        actor,
        "container-docs/file.pdf"
      )
    ).rejects.toMatchObject({ name: "AuthorizationDeniedError" });
  });

  it("rejects unsafe storage keys before file serving", async () => {
    await expect(
      authorizeContainerDocumentDownload(
        lookupFor({ storageKey: "container-docs/../secret.pdf" }),
        actor,
        "container-docs/file.pdf"
      )
    ).rejects.toBeInstanceOf(ProtectedAssetAccessError);
  });

  it("rejects invalid byte sizes", async () => {
    await expect(
      authorizeContainerDocumentDownload(
        lookupFor({ byteSize: -1 }),
        actor,
        "container-docs/file.pdf"
      )
    ).rejects.toMatchObject({ code: "ASSET_SIZE_INVALID" });
  });

  it("builds an attachment-only content disposition without raw quote or semicolon injection", () => {
    const disposition = attachmentContentDisposition('report"; inline.pdf');
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(disposition).toContain('filename="report__ inline.pdf"');
    expect(disposition).toContain("filename*=UTF-8''report%22%3B%20inline.pdf");
  });
});
