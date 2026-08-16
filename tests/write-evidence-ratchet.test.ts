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
