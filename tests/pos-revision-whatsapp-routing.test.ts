import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("POS revision WhatsApp routing", () => {
  it("sends revised transfer images to the destination group from the route that owns POS revisions", () => {
    const helper = readFileSync("server/helpers/sendRevisedTransferWhatsApp.ts", "utf8");
    // The immutable routes are registered ahead of the legacy fiscal-transfer
    // handlers, so they are the ones that must broadcast the image.
    const routes = readFileSync("server/routes/vouchers/immutableStockTransferRevisionRoutes.ts", "utf8");

    expect(helper).toContain("const targetLocationId = resolvedDestinationId ?? sourceLocationId");
    expect(routes).toContain("queueRevisedTransferWhatsApp(result)");
    expect(routes).toContain("destinationLocationId: result.destinationLocationId");
  });
});
