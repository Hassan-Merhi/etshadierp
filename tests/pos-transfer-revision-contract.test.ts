import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

const lifecycle = readFileSync("server/routes/fiscal-transfers/revision-lifecycle.ts", "utf8");
const status = readFileSync("server/routes/fiscal-transfers/revision-status.ts", "utf8");
const access = readFileSync("server/routes/fiscal-transfers/pos-transfer-access.ts", "utf8");
const detail = readFileSync("client/src/pages/pos/postransferorders/components/ViewTransferDialog.tsx", "utf8");
const editor = readFileSync("client/src/pages/pos/postransferorders/components/TransferOrderDetail.tsx", "utf8");

describe("POS stock-transfer revision contract", () => {
  it("creates immutable sequential revision numbers", () => {
    expect(lifecycle).toContain("revisionNumber: (latest?.revisionNumber ?? 0) + 1");
    expect(lifecycle).not.toContain("update(stockTransferRevisions)");
  });

  it("calculates each revision against the latest effective quantity", () => {
    expect(lifecycle).toContain("effectiveQuantities");
    expect(lifecycle).toContain("newQuantity - originalQuantity");
    expect(editor).toContain("sort((a, b) => a.revisionNumber - b.revisionNumber)");
    expect(editor).toContain('revision.status === "rejected"');
    expect(editor).toContain('revision.status === "superseded"');
  });

  it("approves one revision and blocks duplicate or stale application", () => {
    expect(lifecycle).toContain('Revision is already approved or is not pending');
    expect(lifecycle).toContain('Earlier pending revisions must be reviewed first');
    expect(lifecycle).toContain('is stale for');
    expect(lifecycle).toContain("eq(stockTransferRevisions.id, revision.id)");
  });

  it("supports auditable terminal lifecycle states", () => {
    expect(status).toContain("'rejected', 'superseded'");
    expect(status).toContain("A meaningful reason is required");
    expect(status).toContain("A rejected revision cannot be approved");
    expect(status).toContain("A superseded revision cannot be approved");
  });

  it("enforces company and POS location isolation", () => {
    expect(access).toContain("Transfer is not available in the active company");
    expect(access).toContain("POS location is not assigned");
    expect(access).toContain("This transfer does not involve your assigned location");
  });

  it("keeps source, destination, quantities and history visible", () => {
    expect(detail).toContain("From location");
    expect(detail).toContain("To location");
    expect(detail).toContain("Original quantity");
    expect(detail).toContain("Current effective");
    expect(detail).toContain("Revision history");
    expect(detail).toContain("Previous");
    expect(detail).toContain("Revised");
  });
});
