import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("startup warning repairs", () => {
  it("repairs duplicate exchange-rate rows before creating the unique index", () => {
    const source = read("server/startupWarningRepair.mjs");

    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("PARTITION BY company_id, effective_date, from_currency, to_currency");
    expect(source).toContain("ORDER BY id DESC");
    expect(source).toContain("duplicate_rank > 1");
    expect(source).toContain("exchange_rates_company_date_pair_unique");
    expect(source).toContain("LOCK TABLE exchange_rates IN SHARE ROW EXCLUSIVE MODE");
  });

  it("runs the repair before the production server entrypoint", () => {
    const runtimeGuard = read("server/runtimeMemoryGuard.mjs");
    expect(runtimeGuard).toContain('import "./startupWarningRepair.mjs"');
  });

  it("self-heals SP supplier-link columns and uses transactional direct SQL", () => {
    const source = read("server/routes/sp/spSupplierVoucherSync.ts");

    for (const required of [
      "ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
      "ALTER TABLE voucher_entries ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
      "ALTER TABLE sp_containers ADD COLUMN IF NOT EXISTS supplier_id INTEGER",
      "ALTER TABLE sp_containers ADD COLUMN IF NOT EXISTS goods_otw_voucher_id INTEGER",
      "ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS sub_type TEXT",
      "sp-supplier-voucher-sync-trigger-v1",
      "sp-supplier-voucher-link-repair-v1",
      "UPDATE vouchers v",
      "UPDATE voucher_entries ve",
    ]) {
      expect(source).toContain(required);
    }

    expect(source).not.toContain("WITH candidates AS");
  });
});
