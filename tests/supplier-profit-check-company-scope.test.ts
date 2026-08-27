import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const analyzePath = path.resolve(process.cwd(), "server/routes/supplier-profit-check/analyze.ts");
const pagePath = path.resolve(process.cwd(), "client/src/pages/SupplierProfitCheck.tsx");

describe("supplier profit check company scope", () => {
  it("returns at most one stock-item match for each proforma line", () => {
    const source = fs.readFileSync(analyzePath, "utf8");

    expect(source).toContain("SELECT DISTINCT ON (spl.id)");
    expect(source).toContain("AND sp.company_id = $2");
    expect(source).toContain("AND sp.supplier_id = $3");
    expect(source).toContain("CASE WHEN lower(si.code) = lower(spl.barcode) THEN 0 ELSE 1 END");
    expect(source).toContain("[proformaId, companyId, supplierId]");
  });

  it("keeps supplier stock-group lookup inside the active company", () => {
    const source = fs.readFileSync(analyzePath, "utf8");

    expect(source).toContain(
      "SELECT stock_group_id FROM suppliers WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL"
    );
    expect(source).toContain("[supplierId, companyId]");
  });

  it("waits for company synchronization and remounts the model when company changes", () => {
    const source = fs.readFileSync(pagePath, "utf8");

    expect(source).toContain("if (!selectedCompany) return null;");
    expect(source).toContain("<SupplierProfitCheckForCompany key={selectedCompany.id} />");
  });
});
