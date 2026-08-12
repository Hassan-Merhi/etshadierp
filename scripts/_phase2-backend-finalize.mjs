import fs from "node:fs";

function replaceExactly(text, oldValue, newValue, label) {
  const first = text.indexOf(oldValue);
  if (first === -1) throw new Error(`Missing expected pattern: ${label}`);
  if (text.indexOf(oldValue, first + oldValue.length) !== -1) {
    throw new Error(`Expected exactly one pattern: ${label}`);
  }
  return text.replace(oldValue, newValue);
}

const customerPath = "tests/customer-order-excel-export-behavior.test.ts";
let customer = fs.readFileSync(customerPath, "utf8");
customer = replaceExactly(
  customer,
  '    expect(String(res.headers.get("Content-Disposition"))).toContain("CONT-1_Customer A_Kolwezi.xlsx");',
  '    expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=CONT-1_Customer A_Kolwezi.xlsx");',
  "exact Content-Disposition assertion"
);
customer = replaceExactly(
  customer,
  `    const sheet = harness.workbooks[0].worksheets[0];
    const text = sheet.rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.value)).join(" | ");
    expect(text).toContain("Commercial Invoice");
    expect(text).toContain("INV-20");
    expect(text).toContain("Shirts");
    expect(text).toContain("Pants");
    expect(text).toContain("Handling");
    expect(text).toContain("Grand Total");`,
  `    const sheet = harness.workbooks[0].worksheets[0];
    const values = sheet.rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.value));
    expect(values).toEqual(
      expect.arrayContaining(["Commercial Invoice", "INV-20", "Shirts", "Pants", "Handling", "Grand Total"])
    );`,
  "worksheet value assertions"
);
customer = replaceExactly(
  customer,
  `    const text = harness.workbooks[0].worksheets[0].rows
      .flatMap((row) => [...row.cells.values()].map((cell) => cell.value))
      .join(" | ");
    expect(text).not.toContain("Price/Bale");
    expect(text).not.toContain("Grand Total");`,
  `    const values = harness.workbooks[0].worksheets[0].rows.flatMap((row) =>
      [...row.cells.values()].map((cell) => cell.value)
    );
    expect(values.includes("Price/Bale")).toBe(false);
    expect(values.includes("Grand Total")).toBe(false);`,
  "hidden selling values assertions"
);
fs.writeFileSync(customerPath, customer);

const statsPath = "tests/stats-net-position-excel-behavior.test.ts";
let stats = fs.readFileSync(statsPath, "utf8");
stats = replaceExactly(
  stats,
  `    getRow(number: number) {
      while (this.rows.length < number) this.rows.push(new FakeRow(this.rows.length + 1));
      return this.rows[number - 1];
    }
    mergeCells() {}`,
  `    getRow(number: number) {
      while (this.rows.length < number) this.rows.push(new FakeRow(this.rows.length + 1));
      return this.rows[number - 1];
    }
    spliceRows(start: number, deleteCount: number, ...insert: any[]) {
      const replacementRows = insert.map((values, index) => new FakeRow(start + index, values));
      this.rows.splice(start - 1, deleteCount, ...replacementRows);
      this.rows.forEach((row, index) => {
        row.number = index + 1;
      });
    }
    mergeCells() {}`,
  "ExcelJS spliceRows test double"
);
fs.writeFileSync(statsPath, stats);

const { auditSourceTextAssertions } = await import("./audit-source-text-assertions.mjs");
const report = auditSourceTextAssertions();
const baselinePath = "config/source-text-assertion-baseline.json";
const allowancesPath = "config/ci-ratchet-allowances.json";
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const allowances = JSON.parse(fs.readFileSync(allowancesPath, "utf8"));
const actual = report.summary.totalTextAssertions;
const oldCeiling = baseline.maxTotalTextAssertions + allowances.sourceTextAssertionDelta.maxAdditionalTextAssertions;
if (actual > oldCeiling) {
  throw new Error(`Source-text assertions ${actual} exceed one-way ceiling ${oldCeiling}`);
}
if (actual < oldCeiling) {
  const nextAdditional = actual - baseline.maxTotalTextAssertions;
  if (nextAdditional < 0) throw new Error(`Invalid negative allowance ${nextAdditional}`);
  allowances.sourceTextAssertionDelta.maxAdditionalTextAssertions = nextAdditional;
  fs.writeFileSync(allowancesPath, JSON.stringify(allowances, null, 2) + "\n");
  console.log(`Tightened source-text ceiling ${oldCeiling} -> ${actual}`);
} else {
  console.log(`Source-text ceiling remains exact at ${actual}`);
}
