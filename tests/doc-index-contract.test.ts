import { describe, expect, it } from "vitest";

import { auditDocIndex } from "../scripts/audit-doc-index.mjs";

describe("documentation state contract", () => {
  it("keeps every current doc classified, correctly filed, and discoverable", async () => {
    const report = await auditDocIndex();

    expect(report.unclassified).toEqual([]);
    expect(report.staleEntries).toEqual([]);
    expect(report.misplaced).toEqual([]);
    expect(report.readmeMissingReferences).toEqual([]);
    expect(report.readmeRecordLinks).toEqual([]);
    expect(report.readmeBrokenLinks).toEqual([]);
    expect(report.figureResults.filter((result: { ok: boolean }) => !result.ok)).toEqual([]);
    expect(report.failures).toEqual([]);
  });
});
