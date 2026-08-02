import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("translation phases 10, 7 and 13", () => {
  it("covers accounting, vouchers and daybook without translating stored account names", () => {
    const dictionary = source("client/src/i18n/accountingDocumentTranslations.ts");
    const translator = source("client/src/components/ApplicationInterfaceTranslator.tsx");

    for (const label of [
      "Chart of Accounts",
      "General Ledger",
      "Trial Balance",
      "Journal Entry",
      "Payment Voucher",
      "Receipt Voucher",
      "Debit",
      "Credit",
      "Opening Balance",
      "Closing Balance",
    ]) {
      expect(dictionary).toContain(label);
    }
    expect(translator).toContain("[data-account-name]");
    expect(translator).toContain("[data-account-code]");
  });

  it("offers English Arabic and French historical document downloads", () => {
    const actions = source("client/src/components/FactoryBilingualDocumentActions.tsx");
    expect(actions).toContain("export-pdf?lang=en");
    expect(actions).toContain("export-pdf?lang=ar");
    expect(actions).toContain("export-pdf?lang=fr");
    expect(actions).toContain("export-excel?lang=fr");
    expect(actions).toContain("pending-export?lang=fr");
  });

  it("covers errors, PDF, Excel, print and WhatsApp interface copy", () => {
    const dictionary = source("client/src/i18n/accountingDocumentTranslations.ts");
    for (const label of [
      "Validation failed",
      "Permission denied",
      "Export failed",
      "Import failed",
      "Print failed",
      "Export PDF",
      "Download Excel",
      "Print Preview",
      "Send via WhatsApp",
    ]) {
      expect(dictionary).toContain(label);
    }
  });
});
