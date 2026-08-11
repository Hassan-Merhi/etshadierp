import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const queryResults: unknown[][] = [];
  const where = vi.fn(async () => queryResults.shift() ?? []);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const eq = vi.fn((column: unknown, value: unknown) => ({ kind: "eq", column, value }));
  const inArray = vi.fn((column: unknown, values: unknown[]) => ({ kind: "inArray", column, values }));
  const generateTransferImageBuffer = vi.fn();
  const sendWhatsAppFileToChatIdPos = vi.fn();
  const sendWhatsAppTextToChatIdPos = vi.fn();

  return {
    queryResults,
    where,
    from,
    select,
    eq,
    inArray,
    generateTransferImageBuffer,
    sendWhatsAppFileToChatIdPos,
    sendWhatsAppTextToChatIdPos,
    logger: { info: vi.fn(), warn: vi.fn() },
  };
});

vi.mock("../server/db", () => ({ db: { select: harness.select } }));
vi.mock("@shared/schema", () => ({
  stockItems: { id: "stockItems.id", name: "stockItems.name", uom: "stockItems.uom" },
  locations: {
    id: "locations.id",
    companyId: "locations.companyId",
    transferWaGroupChatId: "locations.transferWaGroupChatId",
  },
  companies: { id: "companies.id", transferWaGroupChatId: "companies.transferWaGroupChatId" },
}));
vi.mock("drizzle-orm", () => ({ eq: harness.eq, inArray: harness.inArray }));
vi.mock("../server/helpers/generateTransferImage", () => ({
  generateTransferImageBuffer: harness.generateTransferImageBuffer,
}));
vi.mock("../server/services/whatsappService", () => ({
  sendWhatsAppFileToChatIdPos: harness.sendWhatsAppFileToChatIdPos,
  sendWhatsAppTextToChatIdPos: harness.sendWhatsAppTextToChatIdPos,
}));
vi.mock("../server/lib/logger", () => ({ logger: harness.logger }));

import { sendTransferWhatsApp } from "../server/helpers/sendTransferWhatsApp";

const baseTransfer = {
  destinationLocationId: 23,
  sourceLocationName: "Main Warehouse",
  destLocationName: "Riverside Shop",
  items: [{ stockItemId: 5, quantity: 3 }],
  voucherNumber: "TX/42",
  voucherDate: "2026-08-11",
};

describe("POS transfer WhatsApp routing", () => {
  beforeEach(() => {
    harness.queryResults.splice(0);
    for (const mock of [
      harness.where,
      harness.from,
      harness.select,
      harness.eq,
      harness.inArray,
      harness.generateTransferImageBuffer,
      harness.sendWhatsAppFileToChatIdPos,
      harness.sendWhatsAppTextToChatIdPos,
      harness.logger.info,
      harness.logger.warn,
    ]) {
      mock.mockClear();
    }
    harness.generateTransferImageBuffer.mockResolvedValue(Buffer.from("png"));
    harness.sendWhatsAppFileToChatIdPos.mockResolvedValue({ success: true });
    harness.sendWhatsAppTextToChatIdPos.mockResolvedValue({ success: true });
  });

  it("routes a POS transfer to its assigned location while preserving the inventory destination", async () => {
    harness.queryResults.push(
      [{ companyId: 4, transferWaGroupChatId: "assigned-location-chat" }],
      [{ id: 5, name: "Blue Widget", uom: "pcs" }]
    );

    await sendTransferWhatsApp({ ...baseTransfer, recipientLocationId: 17 });

    expect(harness.eq).toHaveBeenCalledWith("locations.id", 17);
    expect(harness.eq).not.toHaveBeenCalledWith("locations.id", baseTransfer.destinationLocationId);
    expect(harness.generateTransferImageBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLocationName: baseTransfer.sourceLocationName,
        destLocationName: baseTransfer.destLocationName,
        items: [{ name: "Blue Widget", quantity: 3, uom: "pcs" }],
      })
    );
    expect(harness.sendWhatsAppFileToChatIdPos).toHaveBeenCalledWith(
      "assigned-location-chat",
      expect.any(Buffer),
      "Transfer_TX_42.png",
      "",
      "image/png"
    );
  });

  it("keeps destination routing for a non-POS caller", async () => {
    harness.queryResults.push(
      [{ companyId: 4, transferWaGroupChatId: "destination-chat" }],
      [{ id: 5, name: "Blue Widget", uom: "pcs" }]
    );

    await sendTransferWhatsApp(baseTransfer);

    expect(harness.eq).toHaveBeenCalledWith("locations.id", baseTransfer.destinationLocationId);
    expect(harness.sendWhatsAppFileToChatIdPos).toHaveBeenCalledWith(
      "destination-chat",
      expect.any(Buffer),
      "Transfer_TX_42.png",
      "",
      "image/png"
    );
  });

  it("uses the assigned location's company group when that location has no direct group", async () => {
    harness.queryResults.push(
      [{ companyId: 9, transferWaGroupChatId: null }],
      [{ transferWaGroupChatId: "assigned-company-chat" }],
      [{ id: 5, name: "Blue Widget", uom: "pcs" }]
    );

    await sendTransferWhatsApp({ ...baseTransfer, recipientLocationId: 17 });

    expect(harness.eq).toHaveBeenNthCalledWith(1, "locations.id", 17);
    expect(harness.eq).toHaveBeenNthCalledWith(2, "companies.id", 9);
    expect(harness.sendWhatsAppFileToChatIdPos).toHaveBeenCalledWith(
      "assigned-company-chat",
      expect.any(Buffer),
      "Transfer_TX_42.png",
      "",
      "image/png"
    );
  });
});
