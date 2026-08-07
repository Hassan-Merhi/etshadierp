import { describe, expect, it } from "vitest";

import { auditDocIndex } from "../scripts/audit-doc-index.mjs";

describe("documentation state index", () => {
  it("classifies every doc as reference or record", async () => {
    const report = await auditDocIndex();

    // A doc with no entry is one nobody has decided about. Forcing the choice
    // at write time is the only point at which it is cheap — six months later
    // the author is gone and the reader cannot tell current behaviour from a
    // finished project's write-up.
    expect(report.unclassified, `Unclassified docs:\n${report.unclassified.join("\n")}`).toEqual([]);
  });

  it("keeps every documented figure equal to its live source", async () => {
    const report = await auditDocIndex();
    const mismatches = report.figureResults
      .filter((result) => !result.ok)
      .map((result) => `${result.doc} claims ${result.claimed} for ${result.id}; actual ${result.actual}`);

    // This is the one kind of doc rot a script can actually catch, and it is
    // the kind that recurs here: docs/god-file-split-program.md tracked a
    // backlog number in prose and drifted to roughly double the real figure in
    // two different places.
    expect(mismatches, `Documented figures out of date:\n${mismatches.join("\n")}`).toEqual([]);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
  });

  it("actually checks something", async () => {
    const report = await auditDocIndex();
    // Guards against the bindings silently matching nothing — a regex that
    // stops matching after a reword would otherwise turn the gate off without
    // failing anything. A missing match is already a failure in the audit; this
    // asserts the suite is not running against an empty binding list.
    expect(report.summary.figuresChecked).toBeGreaterThanOrEqual(7);
  });

  it("keeps records in the archive and references out of it", async () => {
    const report = await auditDocIndex();

    // Classification without location is just an opinion in a config file. A
    // record left in docs/ puts finished work back where a reader looks for
    // current behaviour, which is the exact confusion Phase 3 removed — 131
    // documents deep.
    expect(report.misplaced, `Docs whose location disagrees with their class:\n${report.misplaced.join("\n")}`).toEqual(
      []
    );
    expect(report.summary.archived).toBeGreaterThan(100);
  });

  it("has no classification entries for deleted docs", async () => {
    const report = await auditDocIndex();
    expect(report.staleEntries).toEqual([]);
  });
});
