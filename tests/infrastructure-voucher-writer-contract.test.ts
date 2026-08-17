import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { auditWriteEvidence } from "../scripts/audit-write-evidence.mjs";

const infrastructureWriters = [
  "server/routes/payroll/_payrollAccountingHelper.ts",
  "server/services/accounting/voucherPostingService.ts",
  "server/services/containers/offload-lifecycle/charge-vouchers.ts",
  "server/services/containers/offload-lifecycle/sp-journals.ts",
  "server/services/factory/post-offload-charge/apply.ts",
  "server/services/pos/createSaleVoucher.ts",
  "server/services/rental/rentalPaymentPostingService.ts",
  "server/storage/accounting/fiscal-periods.ts",
  "server/storage/accounting/vouchers.ts",
  "server/storage/containers-store/offload.ts",
  "server/storage/containers-store/purchase-orders.ts",
] as const;

function source(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

function serverTypeScriptFiles(directory = path.join(process.cwd(), "server"), files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) serverTypeScriptFiles(absolute, files);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path.relative(process.cwd(), absolute).split(path.sep).join("/"));
    }
  }
  return files;
}

describe("Phase 3 infrastructure voucher writer contract", () => {
  it("removes all 11 reviewed infrastructure writers from the no-identity backlog", () => {
    const measured = auditWriteEvidence() as { voucherWritesWithoutRequestIdentity: string[] };
    const backlog = new Set(measured.voucherWritesWithoutRequestIdentity);

    expect(infrastructureWriters.filter((file) => backlog.has(file))).toEqual([]);
  });

  it("routes the ten domain/storage writers through the durable infrastructure identity boundary", () => {
    for (const file of infrastructureWriters.filter(
      (candidate) => candidate !== "server/services/accounting/voucherPostingService.ts"
    )) {
      expect(source(file), `${file} does not use the Phase 3 identity boundary`).toMatch(
        /insertInfrastructureVoucher(?:Tx)?\(/
      );
    }
  });

  it("keeps the raw voucher+entries insert primitive internal to the central posting engine", () => {
    const callers = serverTypeScriptFiles().filter((file) => {
      if (file === "server/services/accounting/voucherPostingService.ts") return false;
      return /\binsertVoucherWithEntriesTx\s*\(/.test(source(file));
    });

    expect(callers).toEqual(["server/services/accounting/centralPostingEngine.ts"]);
    expect(source("server/services/accounting/centralPostingEngine.ts")).toContain(
      "insertVoucherWithEntriesTx(tx, request.voucher, request.entries, request.source)"
    );
  });

  it("requires the raw insert primitive to validate source identity before inserting", () => {
    const rawWriter = source("server/services/accounting/voucherPostingService.ts");
    const validationIndex = rawWriter.indexOf("requireSourceIdentity(source)");
    const insertIndex = rawWriter.indexOf(".insert(vouchers)");

    expect(validationIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(validationIndex);
  });

  it("uses deterministic source identity rather than timestamps as the idempotency key", () => {
    const helper = source("server/services/accounting/infrastructureVoucherIdentity.ts");
    const posWriter = source("server/services/pos/createSaleVoucher.ts");

    expect(helper).toContain("infra:${normalizedType}:${normalizedId}:${normalizedPhase}");
    expect(helper).not.toMatch(/idempotencyKey:\s*[^\n]*(?:Date\.now|Math\.random)/);
    expect(posWriter).toContain('infrastructurePostingIdentity("pos-sale", clientSaleId, "sales-voucher")');
    expect(posWriter).not.toMatch(/clientSaleId\s*\|\|\s*voucherNumber/);
  });
});
