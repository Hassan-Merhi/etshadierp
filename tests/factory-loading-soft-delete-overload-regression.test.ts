import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("factory loading proforma overload scope", () => {
  it("excludes soft-deleted orders from individual scan counts", () => {
    const source = read("server/routes/factory/customer-orders/bale-scanning/scan.ts");

    expect(source.match(/isNull\(customerOrders\.deletedAt\)/g)).toHaveLength(1);
  });

  it("excludes soft-deleted orders from both bulk-import count modes", () => {
    const source = read("server/routes/factory/customer-orders/bale-scanning/bulk-import.ts");

    expect(source.match(/isNull\(customerOrders\.deletedAt\)/g)).toHaveLength(2);
  });
});
