import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getSchedulerCallbackName,
  nameSchedulerCallback,
  resolveSchedulerMetricName,
} from "../server/lib/schedulerObservability";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 5 performance and operations", () => {
  it("records cron metrics under a stable business job name", () => {
    const callback = nameSchedulerCallback(async () => undefined, "overdue customer check");

    expect(getSchedulerCallbackName(callback)).toBe("overdue-customer-check");
    expect(resolveSchedulerMetricName("0 9 * * *", callback)).toBe("cron:overdue-customer-check");
    expect(resolveSchedulerMetricName("0 9 * * *", async () => undefined)).toBe("cron-expression:0 9 * * *");
  });

  it("queries the current customer balance schema for overdue reminders", () => {
    const overdueQuery = source("server/services/scheduler/overdueCustomerQuery.ts");

    expect(overdueQuery).toContain("cb.debit_amount");
    expect(overdueQuery).toContain("cb.credit_amount");
    expect(overdueQuery).toContain("cb.transaction_date");
    expect(overdueQuery).toContain("cb.company_id = c.company_id");
    expect(overdueQuery).not.toMatch(/cb\.(entry_type|entry_date|amount)\b/);
  });

  it("uses native bounded SQL pagination for account-transfer entries", () => {
    const route = source("server/routes/voucher-entries/by-account.ts");
    const client = source("client/src/pages/AccountTransfer.tsx");

    expect(route).toContain("wantsBoundedPagination");
    expect(route).toContain("await Promise.all");
    expect(route).toContain(".limit(limit)");
    expect(route).toContain(".offset(offset)");
    expect(client).toContain('pagination: "1"');
    expect(client).toContain("pageSize: String(ENTRY_PAGE_SIZE)");
  });
});
