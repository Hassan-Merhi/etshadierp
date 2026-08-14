import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("../server/services/whatsappService", () => ({
  sendWhatsAppFileToChatIdPos: vi.fn(async () => ({ success: true })),
  sendWhatsAppTextToChatIdPos: vi.fn(async () => ({ success: true })),
}));

vi.mock("../server/helpers/generateTransferImage", () => ({
  generateTransferImageBuffer: vi.fn(async () => Buffer.from("png")),
}));

vi.mock("../server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { companies, locations, stockItems } from "@shared/schema";

import { db } from "../server/db";
import { generateTransferImageBuffer } from "../server/helpers/generateTransferImage";
import { sendTransferWhatsApp } from "../server/helpers/sendTransferWhatsApp";
import { sendWhatsAppFileToChatIdPos, sendWhatsAppTextToChatIdPos } from "../server/services/whatsappService";

const POS_LOCATION_ID = 41;
const DESTINATION_LOCATION_ID = 77;
const COMPANY_ID = 17;

const POS_GROUP = "pos-assigned-group@g.us";
const DESTINATION_GROUP = "destination-group@g.us";
const COMPANY_GROUP = "company-settings-group@g.us";

/**
 * Stand in for the three reads sendTransferWhatsApp performs, keyed by the
 * Drizzle table so the helper's own query order is not baked into the test.
 * `locationRows` is keyed by location id so an assertion can tell which
 * location the helper actually routed to.
 */
function stubDatabase(options: {
  locationRows: Record<number, { companyId: number | null; transferWaGroupChatId: string | null }>;
  companyGroupChatId?: string | null;
}) {
  const requestedLocationIds: number[] = [];

  vi.mocked(db.select).mockImplementation(
    (fields?: Record<string, unknown>) =>
      ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            if (table === locations) {
              // Drizzle hides the bound id inside the condition, so recover it
              // from the serialized comparison rather than guessing.
              const id = extractComparedId(condition);
              requestedLocationIds.push(id);
              const row = options.locationRows[id];
              return Promise.resolve(row ? [row] : []);
            }
            if (table === companies) {
              return Promise.resolve([{ transferWaGroupChatId: options.companyGroupChatId ?? null }]);
            }
            if (table === stockItems) {
              return Promise.resolve([{ id: 5, name: "Bale Wrap", uom: "kg" }]);
            }
            throw new Error(`Unexpected table read in sendTransferWhatsApp: ${String(table)}`);
          },
        }),
        // `fields` is unused by the stub but kept so the call shape matches.
        _fields: fields,
      }) as never
  );

  return { requestedLocationIds };
}

function extractComparedId(condition: unknown): number {
  const params = (condition as { queryChunks?: unknown[] })?.queryChunks;
  if (Array.isArray(params)) {
    for (const chunk of params) {
      const value = (chunk as { value?: unknown })?.value;
      if (typeof value === "number") return value;
    }
  }
  throw new Error("Could not read the compared id from the Drizzle condition");
}

function transferOptions(overrides: Partial<Parameters<typeof sendTransferWhatsApp>[0]> = {}) {
  return {
    destinationLocationId: DESTINATION_LOCATION_ID,
    sourceLocationName: "Main Warehouse",
    destLocationName: "Downtown Shop",
    items: [{ stockItemId: 5, quantity: 12 }],
    voucherNumber: "TRF-001",
    voucherDate: "2026-08-11",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateTransferImageBuffer).mockResolvedValue(Buffer.from("png"));
  vi.mocked(sendWhatsAppFileToChatIdPos).mockResolvedValue({ success: true } as never);
  vi.mocked(sendWhatsAppTextToChatIdPos).mockResolvedValue({ success: true } as never);
});

describe("POS transfer WhatsApp routing", () => {
  it("routes to the POS user's assigned location, not the transfer destination", async () => {
    const { requestedLocationIds } = stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: POS_GROUP },
        [DESTINATION_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: DESTINATION_GROUP },
      },
    });

    await sendTransferWhatsApp(transferOptions({ recipientLocationId: POS_LOCATION_ID }));

    expect(requestedLocationIds).toEqual([POS_LOCATION_ID]);
    expect(sendWhatsAppFileToChatIdPos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendWhatsAppFileToChatIdPos).mock.calls[0][0]).toBe(POS_GROUP);
  });

  it("falls back to the destination location when no recipient is supplied", async () => {
    const { requestedLocationIds } = stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: POS_GROUP },
        [DESTINATION_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: DESTINATION_GROUP },
      },
    });

    await sendTransferWhatsApp(transferOptions());

    expect(requestedLocationIds).toEqual([DESTINATION_LOCATION_ID]);
    expect(vi.mocked(sendWhatsAppFileToChatIdPos).mock.calls[0][0]).toBe(DESTINATION_GROUP);
  });

  it("falls back to the company group only when the routed location has none", async () => {
    stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: null },
      },
      companyGroupChatId: COMPANY_GROUP,
    });

    await sendTransferWhatsApp(transferOptions({ recipientLocationId: POS_LOCATION_ID }));

    expect(vi.mocked(sendWhatsAppFileToChatIdPos).mock.calls[0][0]).toBe(COMPANY_GROUP);
  });

  it("sends nothing when neither the routed location nor its company has a group", async () => {
    stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: null },
      },
      companyGroupChatId: null,
    });

    await sendTransferWhatsApp(transferOptions({ recipientLocationId: POS_LOCATION_ID }));

    expect(sendWhatsAppFileToChatIdPos).not.toHaveBeenCalled();
    expect(sendWhatsAppTextToChatIdPos).not.toHaveBeenCalled();
  });

  it("keeps the rendered destination separate from the notification recipient", async () => {
    stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: POS_GROUP },
      },
    });

    await sendTransferWhatsApp(transferOptions({ recipientLocationId: POS_LOCATION_ID }));

    // The image is built from the transfer's own source/destination even though
    // the message is delivered to the POS user's group.
    expect(vi.mocked(generateTransferImageBuffer).mock.calls[0][0]).toMatchObject({
      sourceLocationName: "Main Warehouse",
      destLocationName: "Downtown Shop",
    });
  });

  it("falls back to a text message naming the destination when the image cannot be built", async () => {
    stubDatabase({
      locationRows: {
        [POS_LOCATION_ID]: { companyId: COMPANY_ID, transferWaGroupChatId: POS_GROUP },
      },
    });
    vi.mocked(generateTransferImageBuffer).mockRejectedValue(new Error("chromium unavailable"));

    await sendTransferWhatsApp(transferOptions({ recipientLocationId: POS_LOCATION_ID }));

    expect(sendWhatsAppFileToChatIdPos).not.toHaveBeenCalled();
    const [chatId, caption] = vi.mocked(sendWhatsAppTextToChatIdPos).mock.calls[0];
    expect(chatId).toBe(POS_GROUP);
    expect(caption).toContain("Downtown Shop");
  });
});
