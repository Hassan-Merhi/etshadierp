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
  stockWritesWithoutJournalEvidence: {
    ceiling: number;
    files: string[];
    rationale: string;
    reviewed: Record<string, { reason: string; files: string[] }>;
    unreviewed: string[];
  };
  voucherWritesWithoutRequestIdentity: {
    ceiling: number;
    files: string[];
    rationale: string;
  };
};

const voucherReview = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/voucher-write-evidence-review.json"), "utf8")
) as {
  reviewState: string;
  summary: {
    totalReviewed: number;
    explicitReplayGuard: number;
    migrationImportRepair: number;
    infrastructureWriter: number;
    operationalWithoutRequestIdentity: number;
    unreviewed: number;
  };
  reviewed: Record<string, { verdict: string; reason: string; files: string[] }>;
  unreviewed: string[];
};

const measured = auditWriteEvidence() as {
  scannedFiles: number;
  unjournalledStockWrites: string[];
  voucherWritesWithoutRequestIdentity: string[];
  journalledStockWrites: number;
  voucherWritesWithRequestIdentity: number;
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
    const pinned = { ceiling: 2, files: ["first-writer", "second-writer"] };
    const { errors } = compareBacklog("probe", ["first-writer", "replacement-writer"], pinned);

    // Two files before, two after — a pure count check passes this, and a new
    // write path with no evidence ships behind an unchanged number.
    expect(errors).toHaveLength(1);
    expect(errors[0].includes("replacement-writer")).toBe(true);
  });

  it("treats a shrinking backlog as an improvement to re-pin, not a failure", () => {
    const pinned = { ceiling: 2, files: ["first-writer", "second-writer"] };
    const { errors, notes } = compareBacklog("probe", ["first-writer"], pinned);

    expect(errors).toEqual([]);
    expect(notes.join(" ").includes("second-writer")).toBe(true);
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
    // Named mechanisms, so the rationale a reviewer reads points at the thing
    // the audit actually looks for rather than a vague description of it.
    expect(baseline.stockWritesWithoutJournalEvidence.rationale.includes("postStockMovementTx")).toBe(true);
    expect(baseline.voucherWritesWithoutRequestIdentity.rationale.includes("request id")).toBe(true);
  });

  it("accounts for every file in the stock backlog", () => {
    const stock = baseline.stockWritesWithoutJournalEvidence;
    const classified = Object.values(stock.reviewed).flatMap((group) => group.files);

    expect([...classified, ...stock.unreviewed].sort()).toEqual([...stock.files].sort());
    expect(new Set(classified).size, "a file is classified twice").toBe(classified.length);
  });

  it("keeps the stock unreviewed remainder empty", () => {
    expect(baseline.stockWritesWithoutJournalEvidence.unreviewed).toEqual([]);
  });

  it("says why each stock category is not a defect, or that it is", () => {
    for (const [category, group] of Object.entries(baseline.stockWritesWithoutJournalEvidence.reviewed)) {
      expect(group.files.length, `${category} classifies no files`).toBeGreaterThan(0);
      expect(group.reason.length, `${category} has no stated reason`).toBeGreaterThan(120);
    }

    expect(Object.keys(baseline.stockWritesWithoutJournalEvidence.reviewed)).toContain("unjournalled");
    expect(baseline.stockWritesWithoutJournalEvidence.reviewed.unjournalled.files.length).toBeGreaterThan(0);
  });

  it("accounts for every voucher creation path in the file-by-file review", () => {
    const classified = Object.values(voucherReview.reviewed).flatMap((group) => group.files);

    expect(voucherReview.reviewState).toBe("REVIEWED FILE BY FILE");
    expect([...classified, ...voucherReview.unreviewed].sort()).toEqual(
      [...baseline.voucherWritesWithoutRequestIdentity.files].sort()
    );
    expect(new Set(classified).size, "a voucher file is classified twice").toBe(classified.length);
    expect(voucherReview.summary.totalReviewed).toBe(baseline.voucherWritesWithoutRequestIdentity.files.length);
  });

  it("keeps the voucher unreviewed remainder empty", () => {
    expect(voucherReview.unreviewed).toEqual([]);
    expect(voucherReview.summary.unreviewed).toBe(0);
  });

  it("keeps the real voucher backlog explicit rather than hiding it in review labels", () => {
    const realBacklog = voucherReview.reviewed["operational-without-request-identity"];
    expect(realBacklog.verdict).toBe("genuine backlog");
    expect(realBacklog.files.length).toBe(voucherReview.summary.operationalWithoutRequestIdentity);
    expect(realBacklog.files.length).toBeGreaterThan(0);

    for (const [category, group] of Object.entries(voucherReview.reviewed)) {
      expect(group.files.length, `${category} classifies no files`).toBeGreaterThan(0);
      expect(group.reason.length, `${category} has no stated reason`).toBeGreaterThan(120);
      expect(group.verdict.length, `${category} has no verdict`).toBeGreaterThan(10);
    }
  });

  it("keeps voucher review summary counts honest", () => {
    expect(voucherReview.summary.explicitReplayGuard).toBe(
      voucherReview.reviewed["explicit-replay-guard"].files.length
    );
    expect(voucherReview.summary.migrationImportRepair).toBe(
      voucherReview.reviewed["migration-import-repair"].files.length
    );
    expect(voucherReview.summary.infrastructureWriter).toBe(
      voucherReview.reviewed["infrastructure-writer"].files.length
    );
    expect(
      voucherReview.summary.explicitReplayGuard +
        voucherReview.summary.migrationImportRepair +
        voucherReview.summary.infrastructureWriter +
        voucherReview.summary.operationalWithoutRequestIdentity
    ).toBe(voucherReview.summary.totalReviewed);
  });

  it("credits the write paths that do carry evidence", () => {
    // The audit is only as honest as its positive signal. A detector that
    // credited nothing would report every write path as backlog and still
    // satisfy a ceiling set from its own output; one that credited everything
    // would report an empty backlog, which reads as success. Both sides have to
    // be non-empty for the measurement to mean anything.
    expect(measured.journalledStockWrites).toBeGreaterThan(0);
    expect(measured.voucherWritesWithRequestIdentity).toBeGreaterThan(0);
  });
});
