import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay accounting isolation", () => {
  it("does not write vouchers, ledgers, daybook or balances", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).not.toContain("UPDATE vouchers");
    expect(source).not.toContain("UPDATE voucher_entries");
    expect(source).not.toContain("UPDATE ledger_accounts");
    expect(source).not.toContain("UPDATE factory_daybook_entries");
    expect(source).not.toContain("UPDATE customer_balances");
  });
});
