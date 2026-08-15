/**
 * The evidence ratchet holds, and holds against the ways ratchets usually fail.
 *
 * The repository already gates whether a sensitive write route is *tested*
 * (audit-write-route-coverage.mjs, at zero). Nothing gated whether a write
 * leaves the trail the rest of the system reconciles against: a file can change
 * inventory without a canonical movement journal row, or create a voucher with
 * no idempotency key, and every existing gate stays green.
 *
 * Both are backlogs rather than zeros, so this is the lint-warning pattern —
 * measure, pin, forbid growth. Two failure modes matter more than the count:
 *
 *   A file joining the backlog while another leaves it. The count is unchanged
 *   and the ratchet, if it only counted, would pass — while a brand new write
 *   path silently ships with no evidence behind it.
 *
 *   The measurement quietly matching nothing. A detector that stopped finding
 *   inventory writes would report a backlog of zero, which reads as a clean
 *   bill of health and is indistinguishable from success.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditWriteEvidence, compareBacklog } from "../scripts/audit-write-evidence.mjs";

const baseline = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/write-evidence-baseline.json"), "utf8")
) as {
  stockWritesWithoutJournalEvidence: { ceiling: number; files: string[]; rationale: string };
  voucherWritesWithoutRequestIdentity: { ceiling: number; files: string[]; rationale: string };
};

const measured = auditWriteEvidence() as {
  scannedFiles: number;
  unjournalledStockWrites: string[];
  voucherWritesWithoutRequestIdentity: string[];
};

describe("write evidence ratchet", () => {
  it("holds both backlogs at or below their pinned ceilings", () => {
    expect(measured.unjournalledStockWrites.length).toBeLessThanOrEqual(
      baseline.stockWritesWithoutJournalEvidence.ceiling
    );
    expect(measured.voucherWritesWithoutRequestIdentity.length).toBeLessThanOrEqual(
      baseline.voucherWritesWithoutRequestIdentity.ceiling
    );
  });

  it("names no file that the baseline has not reviewed", () => {
    const pinnedStock = new Set(baseline.stockWritesWithoutJournalEvidence.files);
    const pinnedVouchers = new Set(baseline.voucherWritesWithoutRequestIdentity.files);

    expect(measured.unjournalledStockWrites.filter((file) => !pinnedStock.has(file))).toEqual([]);
    expect(measured.voucherWritesWithoutRequestIdentity.filter((file) => !pinnedVouchers.has(file))).toEqual([]);
  });

  it("fails a swap that keeps the count steady", () => {
    const pinned = { ceiling: 2, files: ["server/a.ts", "server/b.ts"] };
    const { errors } = compareBacklog("probe", ["server/a.ts", "server/c.ts"], pinned);

    // Two files before, two after — a pure count check passes this, and a new
    // write path with no evidence ships behind an unchanged number.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("server/c.ts");
  });

  it("treats a shrinking backlog as an improvement to re-pin, not a failure", () => {
    const pinned = { ceiling: 2, files: ["server/a.ts", "server/b.ts"] };
    const { errors, notes } = compareBacklog("probe", ["server/a.ts"], pinned);

    expect(errors).toEqual([]);
    expect(notes.join(" ")).toContain("server/b.ts");
  });

  it("is measuring something, so an empty backlog cannot pass as success", () => {
    // A detector that matched nothing would report zero of each and satisfy
    // every ceiling above. These floors mean the audit has to keep finding the
    // write paths it was built to find.
    expect(measured.scannedFiles).toBeGreaterThan(500);
    expect(measured.unjournalledStockWrites.length).toBeGreaterThan(0);
    expect(measured.voucherWritesWithoutRequestIdentity.length).toBeGreaterThan(0);
  });

  it("records why each backlog exists so a reviewer can judge a new entry", () => {
    expect(baseline.stockWritesWithoutJournalEvidence.rationale).toContain("postStockMovementTx");
    expect(baseline.voucherWritesWithoutRequestIdentity.rationale).toContain("request id");
  });

  it("credits the mechanisms that actually provide the evidence", () => {
    // The audit is only as honest as its positive signal: if these files stopped
    // counting as covered the backlog would jump, and if the signal were widened
    // to something incidental the backlog would collapse.
    const journalled = "server/services/pos/deductSaleInventory.ts";
    const identified = "server/routes/vouchers/centralPaymentReceiptCreateRoute.ts";

    expect(fs.existsSync(path.join(process.cwd(), journalled))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), identified))).toBe(true);
    expect(measured.unjournalledStockWrites).not.toContain(journalled);
    expect(measured.voucherWritesWithoutRequestIdentity).not.toContain(identified);
  });
});
