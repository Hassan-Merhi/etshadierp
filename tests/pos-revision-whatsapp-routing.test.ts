import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS revision WhatsApp routing", () => {
  it("routes revision images only to the POS source location's assigned WhatsApp group", () => {
    const helper = readFileSync("server/helpers/sendRevisedTransferWhatsApp.ts", "utf8");
    const routes = readFileSync("server/routes/vouchers/immutableStockTransferRevisionRoutes.ts", "utf8");

    // The immutable routes own POS revision creation and pass both source and
    // destination context. Delivery must use the POS source location assignment,
    // not the transfer destination/company fallback used for original transfers.
    expect(routes).toContain("queueRevisedTransferWhatsApp(result)");
    expect(routes).toContain("sourceLocationId,");
    expect(routes).toContain("destinationLocationId: result.destinationLocationId");

    expect(helper).toContain("whatsappGroupChatId: locations.whatsappGroupChatId");
    expect(helper).toContain(".where(eq(locations.id, sourceLocationId))");
    expect(helper).toContain("const chatId = sourceLoc.whatsappGroupChatId?.trim() || null");
    expect(helper).toContain("No POS WhatsApp group assigned to source location");
    expect(helper).not.toContain("transferWaGroupChatId: locations.transferWaGroupChatId");
    expect(helper).not.toContain("companies.transferWaGroupChatId");
  });
});
