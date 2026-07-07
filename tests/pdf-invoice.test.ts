/**
 * POS Invoice PDF generation tests.
 *
 * Tests:
 *   A. Small sale  — normal + WhatsApp compact PDF generation
 *   B. Large sale  — 100-item compact, pageCount reasonable
 *   C. Long names  — no explosion, no throw
 *   D. Profit cols — compact mode hides CONFIG / P/L BALE / TOTAL P/L
 *   E. Normal ERP  — GET /api/pos/invoice/:voucherId/pdf still works
 *   F. Validation  — bad voucherId throws; compact buffer always valid
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { seedTestData, cleanupTestData, closeTestServer, type TestContext } from "./setup";
import { db } from "../server/db";
import { eq, and } from "drizzle-orm";
import * as schema from "../shared/schema";
import { generateInvoicePdfMeta, generateInvoicePdf } from "../server/helpers/generateInvoicePdf";

const TEST_PREFIX = "pdfinvoicetest";

let ctx: TestContext;
let agent: request.SuperAgentTest;

// Extra stock items created for large-sale tests
const extraStockItemIds: number[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAsTestUser() {
  const r = await agent
    .post("/api/auth/login")
    .send({ username: `${TEST_PREFIX}_testuser`, password: "testpassword123" });
  if (r.status !== 200) throw new Error(`Login failed: ${r.status} ${JSON.stringify(r.body)}`);
  await agent.post("/api/auth/set-company").send({ companyId: ctx.companyId });
}

/**
 * Ensure we have at least `needed` distinct stock items available.
 * Creates additional items in the DB as needed (up to 150 extra).
 */
async function ensureStockItems(needed: number): Promise<number[]> {
  const ids = [...ctx.stockItemIds, ...extraStockItemIds];
  while (ids.length < needed) {
    const idx = ids.length + 1;
    const [item] = await db
      .insert(schema.stockItems)
      .values({
        companyId: ctx.companyId,
        code: `${TEST_PREFIX}-EXT${idx}`,
        name: `Extended Item ${idx}`,
        uom: "PCS",
        stockGroupId: ctx.stockGroupId,
        active: true,
      })
      .returning();
    extraStockItemIds.push(item.id);
    ids.push(item.id);

    // Give it inventory
    await db.insert(schema.inventory).values({
      companyId: ctx.companyId,
      locationId: ctx.locationId,
      stockItemId: item.id,
      quantity: "99999.000",
      averageRate: "5.00",
      totalValue: "499995.00",
    });
  }
  return ids;
}

/**
 * Create a POS sale with `count` line items (one per distinct stock item).
 * Returns the voucherId of the created sale.
 */
async function seedSale(
  count: number,
  opts: { longNames?: boolean; configuredPrice?: number } = {},
): Promise<number> {
  // Ensure enough stock items exist
  const stockIds = await ensureStockItems(count);

  // Ensure inventory is adequate for each item
  for (const stockItemId of stockIds.slice(0, count)) {
    const [inv] = await db
      .select()
      .from(schema.inventory)
      .where(
        and(
          eq(schema.inventory.companyId, ctx.companyId),
          eq(schema.inventory.locationId, ctx.locationId),
          eq(schema.inventory.stockItemId, stockItemId),
        ),
      )
      .limit(1);
    if (!inv) {
      await db.insert(schema.inventory).values({
        companyId: ctx.companyId,
        locationId: ctx.locationId,
        stockItemId,
        quantity: "99999.000",
        averageRate: "5.00",
        totalValue: "499995.00",
      });
    } else if (parseFloat(inv.quantity) < count) {
      await db
        .update(schema.inventory)
        .set({ quantity: "99999.000" })
        .where(eq(schema.inventory.id, inv.id));
    }
  }

  // Build items list using the correct API payload format
  const items = stockIds.slice(0, count).map((stockItemId) => ({
    stockItemId,
    quantity: 1,
    rate: 10.5,
  }));

  const today = new Date().toISOString().split("T")[0];
  const saleRes = await agent.post("/api/pos/sales").send({
    locationId: ctx.locationId,
    items,
    paymentAccountType: "ledger",
    paymentAccountId: ctx.cashAccountId,
    voucherDate: today,
  });

  if (saleRes.status < 200 || saleRes.status >= 300) {
    throw new Error(
      `Sale creation failed (${saleRes.status}): ${JSON.stringify(saleRes.body)}`,
    );
  }

  const voucherId =
    saleRes.body?.voucher?.id ?? saleRes.body?.voucherId ?? saleRes.body?.id;
  if (!voucherId)
    throw new Error(`No voucherId in response: ${JSON.stringify(saleRes.body)}`);

  // If longNames requested, rename the stock items so the PDF sees long names
  if (opts.longNames) {
    for (let i = 0; i < count; i++) {
      await db
        .update(schema.stockItems)
        .set({ name: `A Very Long Stock Item Description That Should Be Truncated With Ellipsis In Compact PDF Mode — Item ${i + 1}` })
        .where(eq(schema.stockItems.id, stockIds[i]));
    }
  }

  // If configuredPrice requested, update sales_items configured_price
  if (opts.configuredPrice !== undefined && opts.configuredPrice > 0) {
    await db
      .update(schema.salesItems)
      .set({ configuredPrice: String(opts.configuredPrice) })
      .where(eq(schema.salesItems.voucherId, voucherId));
  }

  return voucherId;
}

async function cleanupSales() {
  const vs = await db
    .select({ id: schema.vouchers.id })
    .from(schema.vouchers)
    .where(
      and(eq(schema.vouchers.companyId, ctx.companyId), eq(schema.vouchers.voucherType, "Sales")),
    );
  for (const v of vs) {
    await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, v.id));
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, v.id));
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, v.id));
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx   = await seedTestData(TEST_PREFIX);
  agent = request.agent(ctx.app);
  await loginAsTestUser();
}, 90000);

afterAll(async () => {
  await cleanupSales();
  // Remove extra stock items created for large-sale tests
  for (const id of extraStockItemIds) {
    await db.delete(schema.inventory).where(
      and(
        eq(schema.inventory.companyId, ctx.companyId),
        eq(schema.inventory.stockItemId, id),
      ),
    );
    await db.delete(schema.stockItems).where(eq(schema.stockItems.id, id));
  }
  await cleanupTestData(TEST_PREFIX);
  closeTestServer();
}, 30000);

// ── Test suites ───────────────────────────────────────────────────────────────

describe("A. Small sale — PDF generation", () => {
  it("normal PDF buffer is valid (non-compact)", async () => {
    const voucherId = await seedSale(5);
    const buffer = await generateInvoicePdf(voucherId, ctx.companyId, "testuser");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 30000);

  it("compact WhatsApp PDF buffer is valid and smaller in page count than large invoice", async () => {
    const voucherId = await seedSale(5);
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });
    expect(Buffer.isBuffer(meta.buffer)).toBe(true);
    expect(meta.buffer.length).toBeGreaterThan(1000);
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(meta.itemCount).toBe(5);
    expect(meta.pageCount).toBeGreaterThanOrEqual(1);
    expect(meta.pageCount).toBeLessThanOrEqual(2);
  }, 30000);
});

describe("B. Large sale — 100 items, compact mode", () => {
  it("generates compact PDF with reasonable page count (not 24-30+ pages)", async () => {
    const voucherId = await seedSale(100);
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });

    expect(Buffer.isBuffer(meta.buffer)).toBe(true);
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(meta.itemCount).toBe(100);
    // 100 items in compact mode should fit in ≤5 pages (target: 2–4)
    expect(meta.pageCount).toBeGreaterThanOrEqual(1);
    expect(meta.pageCount).toBeLessThanOrEqual(5);
    expect(meta.buffer.length).toBeGreaterThan(5000);
  }, 120000);

  it("80-item compact PDF — itemCount matches and pageCount is sane", async () => {
    const voucherId = await seedSale(80);
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });
    expect(meta.itemCount).toBe(80);
    expect(meta.pageCount).toBeLessThanOrEqual(4);
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 120000);
});

describe("C. Long item names — no page explosion", () => {
  it("compact PDF with long names stays within reasonable page count", async () => {
    const voucherId = await seedSale(50, { longNames: true });
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });
    expect(meta.itemCount).toBe(50);
    // Long names are truncated to 1 line — still ≤4 pages
    expect(meta.pageCount).toBeLessThanOrEqual(4);
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 120000);

  it("does not throw on very long item names", async () => {
    const voucherId = await seedSale(20, { longNames: true });
    await expect(
      generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", { compactMode: true }),
    ).resolves.toBeDefined();
  }, 60000);
});

describe("D. Profit/cost columns hidden in compact mode", () => {
  it("compact PDF is a valid PDF and stays on 1 page for 5 items", async () => {
    const voucherId = await seedSale(5, { configuredPrice: 8.0 });
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
    // Compact forces 4-col layout (profit cols hidden) → should easily fit 5 items on 1 page
    expect(meta.pageCount).toBe(1);
    expect(meta.itemCount).toBe(5);
  }, 30000);

  it("normal PDF with configuredPrice generates more content than compact PDF (7-col vs 4-col)", async () => {
    // PDFKit compresses streams with FlateDecode so we cannot search for text strings
    // directly in the binary. Instead we verify that the normal (7-column) PDF is
    // larger than the compact (4-column) one for the same set of items, since more
    // drawn text → larger compressed output.
    const voucherId = await seedSale(5, { configuredPrice: 8.0 });
    const compactMeta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
      whatsappMode: true,
    });
    const normalMeta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser");
    // Normal (7-col) should produce a larger PDF than compact (4-col) for the same data
    expect(normalMeta.buffer.length).toBeGreaterThan(compactMeta.buffer.length);
    // Both must be valid PDFs
    expect(normalMeta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(compactMeta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 30000);
});

describe("E. Normal ERP invoice PDF download still works", () => {
  it("GET /api/pos/invoice/:voucherId/pdf returns a valid PDF", async () => {
    const voucherId = await seedSale(5);
    const res = await agent
      .get(`/api/pos/invoice/${voucherId}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
    const buf = res.body as Buffer;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  }, 30000);
});

describe("F. Validation guard", () => {
  it("generateInvoicePdfMeta throws for non-existent voucher", async () => {
    await expect(
      generateInvoicePdfMeta(999999999, ctx.companyId, "testuser", { compactMode: true }),
    ).rejects.toThrow("Voucher not found");
  }, 15000);

  it("compact buffer always starts with %PDF and is >1000 bytes", async () => {
    const voucherId = await seedSale(3);
    const meta = await generateInvoicePdfMeta(voucherId, ctx.companyId, "testuser", {
      compactMode: true,
    });
    expect(meta.buffer.slice(0, 4).toString("ascii")).toBe("%PDF");
    expect(meta.buffer.length).toBeGreaterThan(1000);
  }, 30000);

  it("route returns 400 for invalid (NaN) voucherId", async () => {
    const res = await agent
      .post("/api/pos/send-invoice-pdf-backend")
      .send({ voucherId: "abc", locationId: ctx.locationId, dryRun: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid voucherid/i);
  }, 15000);

  it("route dryRun=true returns metadata JSON and does NOT send to WhatsApp", async () => {
    // This tests that the dryRun short-circuit fires before any WhatsApp call.
    // The test location has no WA group configured; dryRun should still succeed
    // since the WA group check is skipped for dry-run.
    const voucherId = await seedSale(5);
    const res = await agent
      .post("/api/pos/send-invoice-pdf-backend")
      .send({ voucherId, locationId: ctx.locationId, dryRun: true });

    // The route should return dry-run metadata (not attempt WA send)
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.pageCount).toBe("number");
    expect(res.body.pageCount).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.pdfSize).toBe("number");
    expect(res.body.pdfSize).toBeGreaterThan(1000);
    expect(res.body.itemCount).toBe(5);
    expect(res.body.compactMode).toBe(true);
    expect(res.body.whatsappMode).toBe(true);
  }, 30000);

  it("route returns 404 for non-existent voucher in dryRun mode", async () => {
    const res = await agent
      .post("/api/pos/send-invoice-pdf-backend")
      .send({ voucherId: 999999999, locationId: ctx.locationId, dryRun: true });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/voucher not found/i);
  }, 15000);
});
