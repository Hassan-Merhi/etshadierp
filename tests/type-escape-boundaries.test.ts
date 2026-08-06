import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { auditTypeEscapes, countFileEscapes } from "../scripts/audit-type-escapes.mjs";

interface TypeEscapeConfig {
  version: number;
  scan: {
    ratchetBucket: number;
    baseline: Record<string, [number, number, number]>;
  };
  totals: { typeEscapeCeiling: number };
}

const config = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "config/type-escape-boundaries.json"), "utf8")
) as TypeEscapeConfig;

describe("type-escape ratchet", () => {
  it("never lets a file gain a type escape", () => {
    const report = auditTypeEscapes();
    const grown = report.files
      .filter((file) => file.severity === "failure")
      .map((file) => `${file.path}: ${file.total} escapes, baseline ${file.cap}`);

    // The ratchet is the point. A file already carrying `any` may shed them
    // freely, but adding one — or introducing the first one in a clean file —
    // has to be a deliberate, reviewed baseline change rather than silent
    // drift. This is the same contract as the god-file size ratchet.
    expect(grown, `Files above their type-escape baseline:\n${grown.join("\n")}`).toEqual([]);
    expect(report.failures, report.failures.join("\n")).toEqual([]);
  });

  it("holds the repository ceiling as a falling number", () => {
    const report = auditTypeEscapes();
    expect(report.summary.typeEscapeTotal).toBeLessThanOrEqual(config.totals.typeEscapeCeiling);
  });

  it("keeps the baseline free of entries for deleted files", () => {
    const report = auditTypeEscapes();
    // A stale entry is harmless to correctness but inflates the ceiling, which
    // is the number the drawdown is measured against.
    expect(report.staleBaselineEntries).toEqual([]);
  });

  it("keeps compiler suppressions at effectively zero", () => {
    const report = auditTypeEscapes();
    // @ts-ignore / @ts-expect-error switch the compiler off for a whole line
    // rather than widening one type, so they are held far tighter than `any`.
    expect(report.summary.suppressions).toBeLessThanOrEqual(2);
  });

  it("keeps shared/ — the schema layer types flow from — free of escapes", () => {
    const report = auditTypeEscapes();
    const sharedEscapes = report.files.filter((file) => file.path.startsWith("shared/") && file.total > 0);

    // Every escape elsewhere in the repository discards a type that *was*
    // available, because the source of truth is clean. Keeping it that way is
    // what makes the rest of the drawdown tractable.
    expect(
      sharedEscapes.map((file) => file.path),
      "shared/ must stay free of type escapes"
    ).toEqual([]);
  });

  it("counts from the AST, not from source text", () => {
    // Guards the audit itself. A grep-based count reports all four of these as
    // escapes; only the last two are real, and miscounting either way makes the
    // baseline meaningless. This is the reason the audit parses.
    const source = [
      "// this helper accepts any of the three shapes",
      'const label = "as any";',
      "type Real = { value: any };",
      "const cast = input as any;",
      "",
    ].join("\n");

    const counts = countFileEscapes("sample.ts", source);
    expect(counts.explicitAny).toBe(1);
    expect(counts.asAny).toBe(1);
    expect(counts.suppressions).toBe(0);
  });

  it("counts type-position anys that a `: any` grep misses", () => {
    // The grep in the original audit matched `: any` only, so these four were
    // invisible — which is why the AST baseline came out ~2,300 higher than the
    // figure first reported.
    const source = [
      "const a: any[] = [];",
      "function b(): Promise<any> { return Promise.resolve(1); }",
      "type C = Record<string, any>;",
      "let d: Array<any>;",
      "",
    ].join("\n");

    expect(countFileEscapes("sample.ts", source).explicitAny).toBe(4);
  });

  it("identifies Drizzle result casts as the mechanical drawdown target", () => {
    const source = ["const rows = (result as any).rows;", "const other = (value as any).total;", ""].join("\n");

    const counts = countFileEscapes("sample.ts", source);
    expect(counts.asAny).toBe(2);
    // Only the `.rows` access is a discarded query result type.
    expect(counts.drizzleRowCasts).toBe(1);
  });
});
