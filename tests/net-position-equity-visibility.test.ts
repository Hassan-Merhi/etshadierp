import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("net position equity visibility", () => {
  it("shows Partner Capital / Equity only for supplier-partner companies in the generic ERP details view", () => {
    const source = read("client/src/pages/NetProfitDetails.tsx");

    expect(source).toContain('const showPartnerEquity = selectedCompany?.companyType === "supplier_partner"');
    expect(source).toContain("{showPartnerEquity && (");
    expect(source).toContain('title="Partner Capital / Equity"');
  });

  it("keeps dedicated factory net-position views free of the Partner Capital / Equity panel", () => {
    const factoryOverview = read("client/src/pages/factory/FactoryNetPosition.tsx");
    const factoryDetails = read("client/src/pages/factory/FactoryNetPositionDetails.tsx");

    for (const source of [factoryOverview, factoryDetails]) {
      expect(source).not.toContain('title="Partner Capital / Equity"');
      expect(source).not.toContain('id="equity"');
    }
  });
});
