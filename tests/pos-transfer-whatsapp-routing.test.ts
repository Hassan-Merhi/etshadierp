import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS transfer WhatsApp routing", () => {
  it("routes new POS transfers through the assigned location mapping", () => {
    const route = readFileSync("server/routes/fiscal-transfers/create.ts", "utf8");
    const helper = readFileSync("server/helpers/sendTransferWhatsApp.ts", "utf8");

    expect(route).toContain("resolvePosTransferRecipientLocationId(req)");
    expect(route).toContain("getActiveCompanyPermissionContext(req)");
    expect(route).toContain("POS user has no active assigned location; skipping notification");
    expect(route).toContain("recipientLocationId,");
    expect(helper).toContain("recipientLocationId?: number");
    expect(helper).toContain("const routingLocationId = recipientLocationId ?? destinationLocationId");
    expect(helper).toContain(".where(eq(locations.id, routingLocationId))");
    expect(helper).toContain("transferWaGroupChatId: locations.transferWaGroupChatId");
  });

  it("keeps the transfer destination separate from notification routing", () => {
    const route = readFileSync("server/routes/fiscal-transfers/create.ts", "utf8");
    const helper = readFileSync("server/helpers/sendTransferWhatsApp.ts", "utf8");

    expect(route).toContain("destinationLocationId,");
    expect(route).toContain("destLocationName: destLocation.name");
    expect(helper).toContain("destinationLocationId,");
    expect(helper).toContain("recipientLocationId,");
  });
});