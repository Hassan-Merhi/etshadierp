import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS revision WhatsApp routing", () => {
  it("routes revision images only to the POS source location's assigned group", () => {
    const helper = readFileSync("server/helpers/sendRevisedTransferWhatsApp.ts", "utf8");
    const routes = readFileSync("server/routes/vouchers/immutableStockTransferRevisionRoutes.ts", "utf8");
    const lifecycle = readFileSync("server/services/immutableStockTransferRevisionLifecycle.ts", "utf8");

    // The route passes the source location from the revision items, and the
    // lifecycle enforces that a POS user can only submit their assigned source.
    expect(routes).toContain("queueRevisedTransferWhatsApp(result)");
    expect(routes).toContain("sourceLocationId,");
    expect(lifecycle).toContain("sourceLocationIdLimit");
    expect(lifecycle).toContain("item.sourceLocationId !== input.sourceLocationIdLimit");

    // Recipient selection must use exactly the POS/source location assignment.
    expect(helper).toContain("whatsappGroupChatId: locations.whatsappGroupChatId");
    expect(helper).toContain(".where(eq(locations.id, sourceLocationId))");
    expect(helper).toContain("const chatId = sourceLocation.whatsappGroupChatId?.trim() || null");
    expect(helper).toContain("skipping without fallback");
    expect(helper).toContain("exact POS source group");

    // Regression guard: never silently flip revisions back to transfer destination
    // or company fallback routing. Those settings can point at another group.
    expect(helper).not.toContain("transferWaGroupChatId: locations.transferWaGroupChatId");
    expect(helper).not.toContain("companies.transferWaGroupChatId");
    expect(helper).not.toContain('routingSource = "company fallback"');
    expect(helper).not.toContain(".where(eq(locations.id, destinationId))");
  });
});
