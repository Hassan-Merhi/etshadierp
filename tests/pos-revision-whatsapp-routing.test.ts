import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS revision WhatsApp routing", () => {
  it("routes revision images to the destination location transfer group with company fallback", () => {
    const helper = readFileSync("server/helpers/sendRevisedTransferWhatsApp.ts", "utf8");
    const routes = readFileSync("server/routes/vouchers/immutableStockTransferRevisionRoutes.ts", "utf8");

    // POS revisions must use the same destination mapping shown in
    // Settings → Stock Transfers — WhatsApp as the original transfer.
    expect(routes).toContain("queueRevisedTransferWhatsApp(result)");
    expect(routes).toContain("destinationLocationId: result.destinationLocationId");

    expect(helper).toContain("transferWaGroupChatId: locations.transferWaGroupChatId");
    expect(helper).toContain(".where(eq(locations.id, destinationId))");
    expect(helper).toContain("transferWaGroupChatId: companies.transferWaGroupChatId");
    expect(helper).toContain("routingSource = \"company fallback\"");
    expect(helper).toContain("destination mapping shown in Settings");

    // Never route stock-transfer revisions through the normal POS stock/invoice
    // WhatsApp group; that is a different setting and can point to another chat.
    expect(helper).not.toContain("whatsappGroupChatId: locations.whatsappGroupChatId");
    expect(helper).not.toContain(".where(eq(locations.id, sourceLocationId))");
  });
});
