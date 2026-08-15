/**
 * The supplier usage report's PDF and Excel writers.
 *
 * These two functions decide, among other things, whether cost per kilo and cost
 * per bale appear in a report a user is about to download. That decision is a
 * boolean passed in by the route from the caller's permissions, and it had no
 * test: a change to the column layout that dropped the branch would leak
 * supplier costs to the roles the route deliberately hides them from.
 *
 * Both writers stream into the response, so the response here is a real
 * collector and the produced workbook is opened again and read back.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generateEmptyExcel,
  generateEmptyPdf,
  generateExcel,
  generatePdf,
} from "../server/routes/factory-reports/_helpers";

/** A response that keeps what was written to it instead of sending it anywhere. */
function collectingResponse() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, unknown>();
  let finished: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });

  return {
    headers,
    done,
    body: () => Buffer.concat(chunks),
    setHeader(name: string, value: unknown) {
      headers.set(name, value);
    },
    write(chunk: Buffer | string) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    emit() {
      return true;
    },
    end(chunk?: Buffer | string) {
      if (chunk) this.write(chunk);
      finished?.();
      return this;
    },
  };
}

const supplierSummaries = [
  {
    supplierName: "Northern Mills",
    openingBalance: 120.5,
    totalPurchasedKg: 400,
    totalUsedKg: 300,
    remaining: 220.5,
    avgCostPerKg: 1.2345,
    costPerBale: 45.67,
    totalBales: 8,
  },
];

const baleBreakdown = [
  {
    baleId: 91,
    baleCode: "BALE-091",
    materials: [
      { containerNumber: "MSKU1234567", weightKg: 60 },
      { containerNumber: "TGHU7654321", weightKg: 40 },
    ],
    weightKg: 100,
    date: "2026-02-10",
  },
];

async function excelFrom(res: ReturnType<typeof collectingResponse>): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.body() as unknown as ArrayBuffer);
  return workbook;
}

function sheetText(sheet: ExcelJS.Worksheet): string {
  const parts: string[] = [];
  sheet.eachRow((row) => row.eachCell({ includeEmpty: false }, (cell) => parts.push(String(cell.value))));
  return parts.join("|");
}

describe("supplier usage report — empty period", () => {
  it("sends a PDF that says so rather than an empty file", async () => {
    const res = collectingResponse();
    generateEmptyPdf(res, "Test Company", "2026-01-01", "2026-01-31");
    await res.done;

    expect(String(res.headers.get("Content-Type"))).toBe("application/pdf");
    expect(String(res.headers.get("Content-Disposition"))).toContain("2026-01-01");
    expect(res.body().subarray(0, 4).toString()).toBe("%PDF");
  });

  it("sends a workbook with a no-data notice", async () => {
    const res = collectingResponse();
    await generateEmptyExcel(res, "Test Company", "2026-01-01", "2026-01-31");

    const workbook = await excelFrom(res);
    const summary = workbook.getWorksheet("Summary")!;
    expect(sheetText(summary)).toContain("No data found");
    expect(Number(res.headers.get("Content-Length"))).toBe(res.body().byteLength);
  });
});

describe("supplier usage report — PDF", () => {
  it("streams a PDF that carries the period in its filename", async () => {
    const res = collectingResponse();
    await generatePdf(res, "Test Company", "2026-02-01", "2026-02-28", supplierSummaries, baleBreakdown, false);
    await res.done;

    expect(String(res.headers.get("Content-Disposition"))).toContain("supplier_usage_report_2026-02-01_2026-02-28");
    expect(res.body().subarray(0, 4).toString()).toBe("%PDF");
    expect(res.body().byteLength).toBeGreaterThan(1000);
  });

  it("still produces a document when there is nothing to break down", async () => {
    const res = collectingResponse();
    await generatePdf(res, "Test Company", "2026-02-01", "2026-02-28", supplierSummaries, [], true);
    await res.done;

    expect(res.body().subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("supplier usage report — Excel", () => {
  const containerMap = new Map<number, unknown>([[1, { containerNumber: "MSKU1234567" }]]);
  const supplierMap = new Map<number, unknown>([[1, { name: "Northern Mills" }]]);
  const allMixSources = [
    { baleId: 91, containerId: 1, supplierId: 1, weightKg: 60 },
    { baleId: 91, containerId: 1, supplierId: 1, weightKg: 40 },
  ];

  it("includes the cost columns when costs are shown", async () => {
    const res = collectingResponse();
    await generateExcel(
      res,
      "Test Company",
      "2026-02-01",
      "2026-02-28",
      supplierSummaries,
      baleBreakdown,
      allMixSources,
      containerMap,
      supplierMap,
      false
    );

    const text = sheetText((await excelFrom(res)).getWorksheet("Summary")!);
    expect(text).toContain("Northern Mills");
    expect(text.toLowerCase()).toContain("cost");
  });

  it("omits every cost column when costs are hidden", async () => {
    const res = collectingResponse();
    await generateExcel(
      res,
      "Test Company",
      "2026-02-01",
      "2026-02-28",
      supplierSummaries,
      baleBreakdown,
      allMixSources,
      containerMap,
      supplierMap,
      true
    );

    const workbook = await excelFrom(res);
    const everySheet = workbook.worksheets.map((sheet) => sheetText(sheet)).join("|");

    // The caller hides costs because of who is asking. A cost that survives in
    // any sheet of the workbook is the same leak whether it is on the first
    // sheet or the last.
    expect(everySheet).toContain("Northern Mills");
    expect(everySheet.toLowerCase()).not.toContain("cost");
    expect(everySheet).not.toContain("1.2345");
    expect(everySheet).not.toContain("45.67");
  });

  it("names the workbook after the requested period", async () => {
    const res = collectingResponse();
    await generateExcel(
      res,
      "Test Company",
      "2026-03-01",
      "2026-03-31",
      supplierSummaries,
      [],
      [],
      new Map(),
      new Map(),
      false
    );

    expect(String(res.headers.get("Content-Disposition"))).toContain("2026-03-01_2026-03-31");
    expect(Number(res.headers.get("Content-Length"))).toBe(res.body().byteLength);
  });
});
