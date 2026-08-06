import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS revision WhatsApp routing", () => {
  it("routes revised transfer images to the transfer destination group", () => {
    const source = readFileSync("server/helpers/sendRevisedTransferWhatsApp.ts", "utf8");

    expect(source).toContain("stockTransferVouchers.destinationLocationId");
    expect(source).toContain("const targetLocationId = transferTarget?.destinationLocationId ?? sourceLocationId");
    expect(source).toContain("where(eq(locations.id, targetLocationId))");
  });
});
