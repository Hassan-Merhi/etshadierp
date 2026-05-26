import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { sql, eq, and, gt, isNull, desc, asc } from "drizzle-orm";
import {
  ledgerAccounts, vouchers, voucherEntries, locations, bankAccounts,
  spContainers, spContainerLines, spPrepaidCharges, spOffloads,
  spOffloadCharges, spStockMovements, spSales, spSaleLines, spProfitSplits,
  stockItemCodeAliases, stockItems,
} from "@shared/schema";
import { adjustInventory } from "../inventoryHelper";
import { getClientDate } from "../lib/dateUtils";

// ── helpers ──────────────────────────────────────────────────────────────────

function getCompanyId(req: any): number | null {
  return (req.session as any)?.currentCompanyId ?? null;
}

async function requireSpCompany(req: any, res: any): Promise<number | null> {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ message: "No company selected" });
    return null;
  }
  const rows = await db.execute(sql`SELECT company_type FROM companies WHERE id = ${companyId} LIMIT 1`);
  const row = (rows as any).rows?.[0] ?? (rows as any)[0];
  if (!row || row.company_type !== "supplier_partner") {
    res.status(403).json({ message: "Not a supplier_partner company" });
    return null;
  }
  return companyId;
}

async function getSpAccount(companyId: number, subType: string) {
  const [acct] = await db
    .select()
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.companyId, companyId),
        eq(ledgerAccounts.subType, subType),
        isNull(ledgerAccounts.deletedAt)
      )
    );
  return acct;
}

function parseNum(v: any): number {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? 0 : n;
}

// ── SP Chart of Accounts setup ───────────────────────────────────────────────

const SP_ACCOUNTS = [
  { code: "SP-OTW",     name: "Goods On The Way",              accountType: "Asset",          subType: "sp_goods_otw",          isHidden: false },
  { code: "SP-OTWCLR",  name: "Goods OTW Clearing",            accountType: "Liability",       subType: "sp_otw_clearing",       isHidden: true  },
  { code: "SP-PREPAID", name: "Prepaid Charges",               accountType: "Asset",          subType: "sp_prepaid",            isHidden: false },
  // SP-STOCK is isHidden=true: it is an internal double-entry counterpart to the ERP
  // inventory table and must NOT appear as a normal postable account in the Accounts UI.
  { code: "SP-STOCK",   name: "Stock on Floor",                accountType: "Asset",          subType: "sp_stock",              isHidden: true  },
  { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing",   accountType: "Liability",       subType: "sp_cost_clearing",      isHidden: true  },
  { code: "SP-PAY",     name: "Supplier Cash Payable",         accountType: "Liability",       subType: "sp_payable",            isHidden: false },
  { code: "SP-SALES",   name: "Sales",                         accountType: "Income",         subType: "sp_sales",              isHidden: false },
  { code: "SP-COGS",    name: "Cost of Goods Sold",            accountType: "Direct Expense", subType: "sp_cogs",               isHidden: false },
  { code: "SP-SHARED",  name: "Shared Charges",                accountType: "Direct Expense", subType: "sp_shared_charges",     isHidden: false },
  { code: "SP-OPNBAL",  name: "Opening Balance Clearing",      accountType: "Equity",         subType: "sp_opnbal",             isHidden: true  },
  { code: "SP-PREEXP",  name: "Prepaid Expenses",              accountType: "Asset",          subType: "sp_prepaid_expenses",   isHidden: false },
  { code: "SP-HADI-IC", name: "HADI L'SHI — Intercompany",    accountType: "Intercompany",   subType: "sp_hadi_intercompany",  isHidden: false },
];

// ── Route Registration ────────────────────────────────────────────────────────

export function registerSpRoutes(app: Express) {

  // ── Setup ─────────────────────────────────────────────────────────────────

  app.post("/api/sp/setup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const created: string[] = [];
      const existing: string[] = [];

      for (const acct of SP_ACCOUNTS) {
        const found = await getSpAccount(companyId, acct.subType);
        if (!found) {
          await db.insert(ledgerAccounts).values({
            companyId,
            code: acct.code,
            name: acct.name,
            accountType: acct.accountType,
            subType: acct.subType,
            isHidden: acct.isHidden,
            active: true,
          });
          created.push(acct.name);
        } else {
          existing.push(acct.name);
        }
      }

      // Ensure a default location exists for inventory tracking
      const locs = await db
        .select()
        .from(locations)
        .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
      if (locs.length === 0) {
        await db.insert(locations).values({
          companyId,
          code: "SP-WH-001",
          name: "Main Warehouse",
          active: true,
        });
        created.push("Default location: Main Warehouse");
      }

      res.json({ created, existing, message: created.length > 0 ? "Setup complete" : "Already configured" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/setup/status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const accounts = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
        )
        .orderBy(asc(ledgerAccounts.code));

      const spAccounts = accounts.filter(a => a.subType?.startsWith("sp_"));
      const isConfigured = SP_ACCOUNTS.every(sa => spAccounts.some(a => a.subType === sa.subType));

      const locs = await db.select().from(locations).where(
        and(eq(locations.companyId, companyId), isNull(locations.deletedAt))
      );

      const banks = await db.select().from(bankAccounts).where(
        eq(bankAccounts.companyId, companyId)
      );

      res.json({ isConfigured, spAccounts, locations: locs, bankAccounts: banks });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Containers ────────────────────────────────────────────────────────────

  app.get("/api/sp/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const containers = await db
        .select()
        .from(spContainers)
        .where(eq(spContainers.companyId, companyId))
        .orderBy(desc(spContainers.createdAt));

      const lines = await db
        .select()
        .from(spContainerLines)
        .where(eq(spContainerLines.companyId, companyId));

      const result = containers.map(c => ({
        ...c,
        lines: lines.filter(l => l.containerId === c.id),
        totalQty: lines.filter(l => l.containerId === c.id).reduce((s, l) => s + parseNum(l.qty), 0),
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { supplierId, supplierName, containerNumber, invoiceNumber, invoiceDate, invoiceTotalUsd, discountPct, freightEstimateUsd, notes, lines, otwAccountId, otwClearingAccountId } = req.body;

      if (!supplierName || !invoiceNumber || !invoiceDate) {
        return res.status(400).json({ message: "supplierName, invoiceNumber, invoiceDate are required" });
      }

      let otwAcct = await getSpAccount(companyId, "sp_goods_otw");
      let otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
      if (!otwAcct || !otwClrAcct) {
        return res.status(400).json({ message: "Chart of accounts not set up. Run /api/sp/setup first." });
      }

      // Allow optional override accounts — validate they belong to this company
      if (otwAccountId) {
        const [customOtw] = await db.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.id, parseInt(otwAccountId)), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
        );
        if (!customOtw) return res.status(400).json({ message: "Goods OTW account not found for this company" });
        otwAcct = customOtw;
      }
      if (otwClearingAccountId) {
        const [customOtwClr] = await db.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.id, parseInt(otwClearingAccountId)), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
        );
        if (!customOtwClr) return res.status(400).json({ message: "OTW Clearing account not found for this company" });
        otwClrAcct = customOtwClr;
      }

      const totalUsd = parseNum(invoiceTotalUsd);
      const supplierIdNum = supplierId ? parseInt(String(supplierId)) : null;

      const result = await db.transaction(async (tx) => {
        const [container] = await tx.insert(spContainers).values({
          companyId,
          supplierId: supplierIdNum,
          supplierName,
          containerNumber: containerNumber || null,
          invoiceNumber,
          invoiceDate,
          invoiceTotalUsd: String(totalUsd),
          discountPct: String(parseNum(discountPct)),
          freightEstimateUsd: String(parseNum(freightEstimateUsd)),
          notes: notes || null,
          status: "open",
        }).returning();

        // Insert lines
        if (lines && lines.length > 0) {
          await tx.insert(spContainerLines).values(
            lines.map((l: any) => ({
              containerId: container.id,
              companyId,
              articleCode: l.articleCode,
              description: l.description || null,
              qty: String(parseNum(l.qty)),
              unitRateUsd: String(parseNum(l.unitRateUsd)),
              stockItemId: l.stockItemId || null,
            }))
          );
        }

        // Voucher: Dr Goods OTW / Cr Goods OTW Clearing
        if (totalUsd > 0) {
          const voucherNum = `SP-OTW-${container.id}-${Date.now()}`;
          const [voucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: voucherNum,
            voucherDate: invoiceDate,
            description: `Goods OTW: ${supplierName} — Invoice ${invoiceNumber}`,
            totalAmount: String(totalUsd),
            currency: "USD",
            exchangeRate: "1",
            sourceModule: "SP",
            supplierId: supplierIdNum,
          }).returning();

          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: otwAcct.id,
            debitAmount: String(totalUsd),
            creditAmount: "0",
            narration: `Goods OTW — ${supplierName} inv ${invoiceNumber}`,
          });

          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: otwClrAcct.id,
            debitAmount: "0",
            creditAmount: String(totalUsd),
            narration: `OTW Clearing — ${supplierName} inv ${invoiceNumber}`,
          });

          await tx.update(spContainers)
            .set({ goodsOtwVoucherId: voucher.id })
            .where(eq(spContainers.id, container.id));
        }

        return container;
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/sp/containers/:id — edit header fields + regenerate OTW voucher
  app.patch("/api/sp/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const containerId = parseInt(req.params.id);
      if (isNaN(containerId)) return res.status(400).json({ message: "Invalid container ID" });

      const [existing] = await db.select().from(spContainers).where(
        and(eq(spContainers.id, containerId), eq(spContainers.companyId, companyId))
      );
      if (!existing) return res.status(404).json({ message: "Container not found" });
      if (existing.status === "offloaded") {
        return res.status(400).json({ message: "Cannot edit an offloaded container" });
      }

      const { supplierId, supplierName, containerNumber, invoiceNumber, invoiceDate, invoiceTotalUsd, discountPct, freightEstimateUsd, notes } = req.body;

      const totalUsd = parseNum(invoiceTotalUsd ?? existing.invoiceTotalUsd);
      const supplierIdNum = supplierId ? parseInt(String(supplierId)) : (existing.supplierId ?? null);
      const newSupplierName = supplierName ?? existing.supplierName;
      const newInvoiceNumber = invoiceNumber ?? existing.invoiceNumber;
      const newInvoiceDate = invoiceDate ?? existing.invoiceDate;

      let otwAcct = await getSpAccount(companyId, "sp_goods_otw");
      let otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
      if (!otwAcct || !otwClrAcct) {
        return res.status(400).json({ message: "Chart of accounts not set up" });
      }

      const updated = await db.transaction(async (tx) => {
        // Update container fields
        const [updatedContainer] = await tx.update(spContainers).set({
          supplierId: supplierIdNum,
          supplierName: newSupplierName,
          containerNumber: containerNumber !== undefined ? (containerNumber || null) : existing.containerNumber,
          invoiceNumber: newInvoiceNumber,
          invoiceDate: newInvoiceDate,
          invoiceTotalUsd: String(totalUsd),
          discountPct: String(parseNum(discountPct ?? existing.discountPct)),
          freightEstimateUsd: String(parseNum(freightEstimateUsd ?? existing.freightEstimateUsd)),
          notes: notes !== undefined ? (notes || null) : existing.notes,
        }).where(and(eq(spContainers.id, containerId), eq(spContainers.companyId, companyId))).returning();

        // Regenerate OTW voucher if amount or supplier changed
        if (existing.goodsOtwVoucherId && totalUsd > 0) {
          // Update voucher header
          await tx.update(vouchers).set({
            voucherDate: newInvoiceDate,
            description: `Goods OTW: ${newSupplierName} — Invoice ${newInvoiceNumber}`,
            totalAmount: String(totalUsd),
            supplierId: supplierIdNum,
          }).where(eq(vouchers.id, existing.goodsOtwVoucherId));

          // Delete old entries and recreate with updated amounts
          await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, existing.goodsOtwVoucherId));

          await tx.insert(voucherEntries).values({
            voucherId: existing.goodsOtwVoucherId,
            ledgerAccountId: otwAcct.id,
            debitAmount: String(totalUsd),
            creditAmount: "0",
            narration: `Goods OTW — ${newSupplierName} inv ${newInvoiceNumber}`,
          });

          await tx.insert(voucherEntries).values({
            voucherId: existing.goodsOtwVoucherId,
            ledgerAccountId: otwClrAcct.id,
            debitAmount: "0",
            creditAmount: String(totalUsd),
            narration: `OTW Clearing — ${newSupplierName} inv ${newInvoiceNumber}`,
          });
        } else if (!existing.goodsOtwVoucherId && totalUsd > 0) {
          // Create new voucher if none existed
          const voucherNum = `SP-OTW-${containerId}-${Date.now()}`;
          const [voucher] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Journal",
            voucherNumber: voucherNum,
            voucherDate: newInvoiceDate,
            description: `Goods OTW: ${newSupplierName} — Invoice ${newInvoiceNumber}`,
            totalAmount: String(totalUsd),
            currency: "USD",
            exchangeRate: "1",
            sourceModule: "SP",
            supplierId: supplierIdNum,
          }).returning();

          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: otwAcct.id,
            debitAmount: String(totalUsd),
            creditAmount: "0",
            narration: `Goods OTW — ${newSupplierName} inv ${newInvoiceNumber}`,
          });

          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: otwClrAcct.id,
            debitAmount: "0",
            creditAmount: String(totalUsd),
            narration: `OTW Clearing — ${newSupplierName} inv ${newInvoiceNumber}`,
          });

          await tx.update(spContainers)
            .set({ goodsOtwVoucherId: voucher.id })
            .where(eq(spContainers.id, containerId));
        }

        return updatedContainer;
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const [container] = await db
        .select()
        .from(spContainers)
        .where(and(eq(spContainers.id, id), eq(spContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });

      const lines = await db
        .select()
        .from(spContainerLines)
        .where(eq(spContainerLines.containerId, id))
        .orderBy(asc(spContainerLines.id));

      const prepaid = await db
        .select()
        .from(spPrepaidCharges)
        .where(and(eq(spPrepaidCharges.containerId, id), eq(spPrepaidCharges.companyId, companyId)))
        .orderBy(asc(spPrepaidCharges.createdAt));

      const [offload] = await db
        .select()
        .from(spOffloads)
        .where(and(eq(spOffloads.containerId, id), eq(spOffloads.companyId, companyId)));

      let offloadCharges: any[] = [];
      if (offload) {
        offloadCharges = await db
          .select()
          .from(spOffloadCharges)
          .where(eq(spOffloadCharges.offloadId, offload.id));
      }

      const movements = await db
        .select()
        .from(spStockMovements)
        .where(and(eq(spStockMovements.containerId, id), eq(spStockMovements.companyId, companyId)));

      res.json({ ...container, lines, prepaid, offload: offload || null, offloadCharges, movements });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/sp/containers/:id/line-preview — enriched per-line preview with alias resolution
  app.get("/api/sp/containers/:id/line-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ message: "Invalid id" });

      const [container] = await db
        .select()
        .from(spContainers)
        .where(and(eq(spContainers.id, id), eq(spContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });

      const lines = await db
        .select()
        .from(spContainerLines)
        .where(eq(spContainerLines.containerId, id))
        .orderBy(asc(spContainerLines.id));

      const aliasResult = await db.execute(sql`
        SELECT a.alias_code, a.stock_item_id, si.code AS item_code, si.name AS item_name
        FROM stock_item_code_aliases a
        JOIN stock_items si ON si.id = a.stock_item_id
        WHERE a.company_id = ${companyId}
      `);
      const aliasMap = new Map<string, { stockItemId: number; itemCode: string; itemName: string }>();
      for (const row of aliasResult.rows as any[]) {
        aliasMap.set(row.alias_code, { stockItemId: row.stock_item_id, itemCode: row.item_code, itemName: row.item_name });
      }

      const discountFactor = 1 - parseFloat(container.discountPct as any || "0") / 100;
      const totalQty = lines.reduce((s, l) => s + parseFloat(l.qty as any || "0"), 0);

      const enriched = lines.map(l => {
        const alias = aliasMap.get(l.articleCode);
        const qty = parseFloat(l.qty as any || "0");
        const unitRate = parseFloat(l.unitRateUsd as any || "0");
        const discountedBaseRate = unitRate * discountFactor;
        return {
          id: l.id,
          articleCode: l.articleCode,
          description: l.description,
          qty,
          unitRateUsd: unitRate,
          discountedBaseRate,
          totalBaseUsd: discountedBaseRate * qty,
          lineProportion: totalQty > 0 ? qty / totalQty : 0,
          aliasResolved: !!alias,
          stockItemId: alias?.stockItemId ?? null,
          stockItemCode: alias?.itemCode ?? null,
          stockItemName: alias?.itemName ?? null,
        };
      });

      res.json({
        lines: enriched,
        totalQty,
        discountFactor,
        discountPct: container.discountPct,
        unmappedCount: enriched.filter(l => !l.aliasResolved).length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Prepaid Charges ───────────────────────────────────────────────────────

  app.get("/api/sp/prepaid", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const containerId = req.query.containerId ? parseInt(req.query.containerId as string) : null;

      const conditions: any[] = [eq(spPrepaidCharges.companyId, companyId)];
      if (containerId) conditions.push(eq(spPrepaidCharges.containerId, containerId));

      const rows = await db
        .select()
        .from(spPrepaidCharges)
        .where(and(...conditions))
        .orderBy(desc(spPrepaidCharges.createdAt));

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/prepaid", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { containerId, prepaidDate, chargeType, agentName, amountPaidUsd, bankAccountId, debitAccountId, notes } = req.body;

      if (!chargeType || !amountPaidUsd) {
        return res.status(400).json({ message: "chargeType, amountPaidUsd required" });
      }

      let prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
      if (!prepaidAcct) return res.status(400).json({ message: "SP accounts not set up" });

      // Allow optional debit account override — validate it belongs to this company
      if (debitAccountId) {
        const [customDebit] = await db.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.id, parseInt(debitAccountId)), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
        );
        if (!customDebit) return res.status(400).json({ message: "Debit account not found for this company" });
        prepaidAcct = customDebit;
      }

      // Validate bank account belongs to this company
      if (bankAccountId) {
        const [bank] = await db.select().from(bankAccounts).where(
          and(eq(bankAccounts.id, parseInt(bankAccountId)), eq(bankAccounts.companyId, companyId))
        );
        if (!bank) return res.status(400).json({ message: "Bank account not found for this company" });
      }

      const amount = parseNum(amountPaidUsd);
      const date = prepaidDate || getClientDate(req);

      const result = await db.transaction(async (tx) => {
        const [charge] = await tx.insert(spPrepaidCharges).values({
          companyId,
          containerId: containerId ? parseInt(containerId) : null,
          prepaidDate: date,
          chargeType,
          agentName: agentName || null,
          amountPaidUsd: String(amount),
          amountUsedUsd: "0",
          notes: notes || null,
        }).returning();

        const voucherNum = `SP-PRE-${charge.id}-${Date.now()}`;
        const desc = `Prepaid ${chargeType}${agentName ? ` — ${agentName}` : ""} for container #${containerId}`;

        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: voucherNum,
          voucherDate: date,
          description: desc,
          totalAmount: String(amount),
          currency: "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        // Dr Prepaid Charges
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: prepaidAcct.id,
          debitAmount: String(amount),
          creditAmount: "0",
          narration: `Prepaid ${chargeType} — ${agentName || ""}`,
        });

        // Cr Bank
        if (bankAccountId) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            bankAccountId: parseInt(bankAccountId),
            debitAmount: "0",
            creditAmount: String(amount),
            narration: `Payment for prepaid ${chargeType}`,
          });
        }

        await tx.update(spPrepaidCharges)
          .set({ voucherId: voucher.id })
          .where(eq(spPrepaidCharges.id, charge.id));

        return { ...charge, voucherId: voucher.id };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Parent Company Agents ────────────────────────────────────────────────

  app.get("/api/sp/parent-agents", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const parentRows = await db.execute(
        sql`SELECT parent_company_id FROM companies WHERE id = ${companyId} LIMIT 1`
      );
      const parentRow = (parentRows as any).rows?.[0] ?? (parentRows as any)[0];
      const parentId = parentRow?.parent_company_id ?? 1;

      const agents = await db.execute(sql`
        SELECT aa.id, aa.account_name, aa.account_id,
               la.id AS ledger_account_id, la.name AS ledger_name, la.account_type
        FROM agent_accounts aa
        JOIN ledger_accounts la ON la.id = CAST(REPLACE(aa.account_id, 'ledger-', '') AS integer)
        WHERE aa.company_id = ${parentId}
          AND la.deleted_at IS NULL
        ORDER BY aa.account_name
      `);

      res.json((agents as any).rows ?? agents);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Offload ───────────────────────────────────────────────────────────────

  app.post("/api/sp/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { containerId, offloadDate, chargeLines, locationId } = req.body;

      if (!containerId || !offloadDate) {
        return res.status(400).json({ message: "containerId and offloadDate are required" });
      }

      if (!locationId) {
        return res.status(400).json({ message: "locationId is required" });
      }
      const [offloadLocation] = await db.select().from(locations)
        .where(and(eq(locations.id, parseInt(locationId)), eq(locations.companyId, companyId), isNull(locations.deletedAt)));
      if (!offloadLocation) {
        return res.status(400).json({ message: "Invalid location for this company" });
      }

      const [container] = await db
        .select()
        .from(spContainers)
        .where(and(eq(spContainers.id, parseInt(containerId)), eq(spContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.status !== "open") return res.status(400).json({ message: "Container is already offloaded" });

      const containerLines = await db
        .select()
        .from(spContainerLines)
        .where(eq(spContainerLines.containerId, container.id));

      if (containerLines.length === 0) {
        return res.status(400).json({ message: "Container has no lines" });
      }

      // Fetch SP accounts
      const otwAcct    = await getSpAccount(companyId, "sp_goods_otw");
      const otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
      const prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
      const stockAcct  = await getSpAccount(companyId, "sp_stock");
      const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");

      if (!otwAcct || !otwClrAcct || !stockAcct || !costClrAcct) {
        return res.status(400).json({ message: "SP accounts not configured. Run setup first." });
      }


      // Discount rate
      const discountPct = parseNum(container.discountPct);
      const discountFactor = 1 - discountPct / 100;

      // Per-line base costs
      const totalQty = containerLines.reduce((s, l) => s + parseNum(l.qty), 0);
      const totalBaseCost = containerLines.reduce(
        (s, l) => s + parseNum(l.qty) * parseNum(l.unitRateUsd) * discountFactor,
        0
      );

      // Landed charges
      const charges: any[] = chargeLines || [];
      const totalLandedCost = charges.reduce((s: number, c: any) => s + parseNum(c.amountUsd), 0);
      const landedPerUnit = totalQty > 0 ? totalLandedCost / totalQty : 0;
      const totalFinalCost = totalBaseCost + totalLandedCost;
      const invoiceTotal = parseNum(container.invoiceTotalUsd);

      const result = await db.transaction(async (tx) => {
        // ── Voucher A: Reverse Goods OTW ──────────────────────────────────────
        const [voucherA] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: `SP-OTW-REV-${container.id}-${Date.now()}`,
          voucherDate: offloadDate,
          description: `Goods OTW Reversal — ${container.supplierName} inv ${container.invoiceNumber}`,
          totalAmount: String(invoiceTotal),
          currency: "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        // Dr Goods OTW Clearing (Liability side reduces)
        await tx.insert(voucherEntries).values({
          voucherId: voucherA.id,
          ledgerAccountId: otwClrAcct.id,
          debitAmount: String(invoiceTotal),
          creditAmount: "0",
          narration: `OTW Clearing reversal — container #${container.id}`,
        });
        // Cr Goods OTW (Asset disappears)
        await tx.insert(voucherEntries).values({
          voucherId: voucherA.id,
          ledgerAccountId: otwAcct.id,
          debitAmount: "0",
          creditAmount: String(invoiceTotal),
          narration: `Goods OTW reversal — container #${container.id}`,
        });

        // ── Voucher B: Create Stock ───────────────────────────────────────────
        const [voucherB] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: `SP-STOCK-${container.id}-${Date.now()}`,
          voucherDate: offloadDate,
          description: `Stock offload — ${container.supplierName} inv ${container.invoiceNumber}`,
          totalAmount: String(totalFinalCost),
          currency: "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        // Dr Stock on Floor (full final cost)
        await tx.insert(voucherEntries).values({
          voucherId: voucherB.id,
          ledgerAccountId: stockAcct.id,
          debitAmount: String(totalFinalCost),
          creditAmount: "0",
          narration: `Stock received — ${totalQty} units from container #${container.id}`,
        });

        // Cr base item cost → Stock Cost Payable Clearing
        await tx.insert(voucherEntries).values({
          voucherId: voucherB.id,
          ledgerAccountId: costClrAcct.id,
          debitAmount: "0",
          creditAmount: String(totalBaseCost),
          narration: `Base supplier item cost — container #${container.id}`,
        });

        // Cr each landed charge line
        for (const charge of charges) {
          const chargeAmt = parseNum(charge.amountUsd);
          if (chargeAmt <= 0) continue;

          if (charge.chargeType === "prepaid_used" && charge.prepaidChargeId) {
            // Validate: cannot use more than remaining prepaid balance
            const prepaidRows = await tx.execute(
              sql`SELECT amount_paid_usd, amount_used_usd FROM sp_prepaid_charges WHERE id = ${parseInt(charge.prepaidChargeId)} FOR UPDATE`
            );
            const prepaidRow = (prepaidRows as any).rows?.[0] ?? (prepaidRows as any)[0];
            if (!prepaidRow) throw new Error(`Prepaid charge #${charge.prepaidChargeId} not found`);
            const alreadyUsed = parseNum(prepaidRow.amount_used_usd);
            const totalPaid   = parseNum(prepaidRow.amount_paid_usd);
            const remaining   = totalPaid - alreadyUsed;
            if (chargeAmt > remaining + 0.0001) {
              throw new Error(
                `Prepaid charge #${charge.prepaidChargeId} has only ${remaining.toFixed(4)} remaining (paid ${totalPaid}, used ${alreadyUsed}), cannot use ${chargeAmt}`
              );
            }

            // Cr Prepaid Charges (asset reduces)
            if (prepaidAcct) {
              await tx.insert(voucherEntries).values({
                voucherId: voucherB.id,
                ledgerAccountId: prepaidAcct.id,
                debitAmount: "0",
                creditAmount: String(chargeAmt),
                narration: `Prepaid used — ${charge.description || "charge"} for container #${container.id}`,
              });
            }
            // Accumulate used amount (add, not overwrite)
            await tx.execute(
              sql`UPDATE sp_prepaid_charges SET amount_used_usd = amount_used_usd + ${chargeAmt} WHERE id = ${parseInt(charge.prepaidChargeId)}`
            );

          } else if (charge.chargeType === "paid_now" && charge.creditBankAccountId) {
            // Validate bank account belongs to company
            const [bankRow] = await db.select().from(bankAccounts).where(
              and(eq(bankAccounts.id, parseInt(charge.creditBankAccountId)), eq(bankAccounts.companyId, companyId))
            );
            if (!bankRow) throw new Error(`Bank account #${charge.creditBankAccountId} not found for this company`);

            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              bankAccountId: parseInt(charge.creditBankAccountId),
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Cash paid at offload — ${charge.description || "charge"}`,
            });

          } else if (charge.chargeType === "unpaid_payable" && charge.creditLedgerAccountId) {
            // Validate ledger account belongs to company
            const [ledgerRow] = await db.select().from(ledgerAccounts).where(
              and(eq(ledgerAccounts.id, parseInt(charge.creditLedgerAccountId)), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
            );
            if (!ledgerRow) throw new Error(`Ledger account #${charge.creditLedgerAccountId} not found for this company`);

            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: parseInt(charge.creditLedgerAccountId),
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Payable — ${charge.description || "charge"}`,
            });

          } else if (charge.chargeType === "other" && charge.creditLedgerAccountId) {
            // Validate ledger account belongs to company
            const [otherRow] = await db.select().from(ledgerAccounts).where(
              and(eq(ledgerAccounts.id, parseInt(charge.creditLedgerAccountId)), eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt))
            );
            if (!otherRow) throw new Error(`Ledger account #${charge.creditLedgerAccountId} not found for this company`);

            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: parseInt(charge.creditLedgerAccountId),
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Other charge — ${charge.description || "charge"}`,
            });

          } else if (charge.chargeType === "parent_agent") {
            // Agent charge via parent company (HADI L'SHI) — Cr Prepaid Expenses in SP Test Co.
            // The HADI L'SHI side (Dr Agent / Cr SP Intercompany) is posted after Voucher B.
            const prepaidExpAcct = await getSpAccount(companyId, "sp_prepaid_expenses");
            if (!prepaidExpAcct) throw new Error("Prepaid Expenses account (SP-PREEXP) not found. Run SP setup or contact admin.");

            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: prepaidExpAcct.id,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Agent charge via HADI L'SHI — ${charge.description || ""}`,
            });

          } else {
            // invoice_freight or fallback → Cr Stock Cost Payable Clearing
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: costClrAcct.id,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Supplier freight/other — ${charge.description || "charge"}`,
            });
          }
        }

        // ── Insert sp_offload record ──────────────────────────────────────────
        const [offload] = await tx.insert(spOffloads).values({
          companyId,
          containerId: container.id,
          offloadDate,
          totalQty: String(totalQty),
          totalBaseCostUsd: String(totalBaseCost),
          totalLandedCostUsd: String(totalLandedCost),
          totalFinalCostUsd: String(totalFinalCost),
          voucherIdReversal: voucherA.id,
          voucherIdStock: voucherB.id,
        }).returning();

        // ── Insert offload charges ────────────────────────────────────────────
        if (charges.length > 0) {
          await tx.insert(spOffloadCharges).values(
            charges.filter(c => parseNum(c.amountUsd) > 0).map((c: any) => ({
              offloadId: offload.id,
              companyId,
              chargeType: c.chargeType,
              description: c.description || null,
              amountUsd: String(parseNum(c.amountUsd)),
              prepaidChargeId: c.prepaidChargeId ? parseInt(c.prepaidChargeId) : null,
              // For parent_agent: store the agent ledger id here for reference/traceability
              creditLedgerAccountId: c.chargeType === "parent_agent" && c.parentAgentAccountId
                ? parseInt(c.parentAgentAccountId)
                : (c.creditLedgerAccountId ? parseInt(c.creditLedgerAccountId) : null),
              creditBankAccountId: c.creditBankAccountId ? parseInt(c.creditBankAccountId) : null,
            }))
          );
        }

        // ── Voucher C: HADI L'SHI agent journals (if any parent_agent charges) ──
        const agentCharges = charges.filter(
          c => c.chargeType === "parent_agent" && parseNum(c.amountUsd) > 0 && c.parentAgentAccountId
        );
        if (agentCharges.length > 0) {
          // Lookup HADI L'SHI intercompany account (lives in HADI L'SHI, company_id=1)
          const [hadiSpInterco] = await tx
            .select()
            .from(ledgerAccounts)
            .where(
              and(
                eq(ledgerAccounts.companyId, 1),
                eq(ledgerAccounts.subType, "hadi_sp_intercompany"),
                isNull(ledgerAccounts.deletedAt)
              )
            );
          if (!hadiSpInterco) {
            throw new Error("HADI L'SHI intercompany account not found (SP-IC). Run startup migrations or contact admin.");
          }

          const totalAgentAmt = agentCharges.reduce((s: number, c: any) => s + parseNum(c.amountUsd), 0);

          // Create Voucher C in HADI L'SHI (company_id=1)
          const [voucherC] = await tx.insert(vouchers).values({
            companyId: 1,
            voucherType: "Journal",
            voucherNumber: `SP-AGENT-${container.id}-${Date.now()}`,
            voucherDate: offloadDate,
            description: `Agent charges for SP offload — ${container.supplierName} inv ${container.invoiceNumber}`,
            totalAmount: String(totalAgentAmt),
            currency: "USD",
            exchangeRate: "1",
            sourceModule: "SP",
          }).returning();

          // Dr each agent account in HADI L'SHI
          for (const ac of agentCharges) {
            const agentLedgerId = parseInt(ac.parentAgentAccountId);
            await tx.insert(voucherEntries).values({
              voucherId: voucherC.id,
              ledgerAccountId: agentLedgerId,
              debitAmount: String(parseNum(ac.amountUsd)),
              creditAmount: "0",
              narration: `Agent charge for SP container #${container.id}${ac.description ? ` — ${ac.description}` : ""}`,
            });
          }

          // Cr SP Test Co — Intercompany (excluded from Net Position by account type)
          await tx.insert(voucherEntries).values({
            voucherId: voucherC.id,
            ledgerAccountId: hadiSpInterco.id,
            debitAmount: "0",
            creditAmount: String(totalAgentAmt),
            narration: `SP offload agent charges total — container #${container.id}`,
          });
        }

        // ── Insert stock movements + adjustInventory ──────────────────────────
        for (const line of containerLines) {
          const qty = parseNum(line.qty);
          const baseUnitCost = parseNum(line.unitRateUsd) * discountFactor;
          const finalUnitCost = baseUnitCost + landedPerUnit;

          await tx.insert(spStockMovements).values({
            companyId,
            containerId: container.id,
            offloadId: offload.id,
            containerLineId: line.id,
            articleCode: line.articleCode,
            description: line.description || null,
            stockItemId: line.stockItemId || null,
            locationId: offloadLocation.id,
            qtyIn: String(qty),
            qtyRemaining: String(qty),
            baseUnitCostUsd: String(baseUnitCost),
            landedUnitCostUsd: String(landedPerUnit),
            finalUnitCostUsd: String(finalUnitCost),
          });

          // Call adjustInventory if stock item + location are configured
          if (line.stockItemId) {
            try {
              await adjustInventory(tx, offloadLocation.id, line.stockItemId, qty, companyId, finalUnitCost, "SP_OFFLOAD", offload.id);
            } catch {
              // Non-blocking for Phase 1 — sp_stock_movements is the primary lot tracker
            }
          }
        }

        // ── Update container status ───────────────────────────────────────────
        await tx.update(spContainers)
          .set({ status: "offloaded" })
          .where(eq(spContainers.id, container.id));

        return offload;
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Sales ─────────────────────────────────────────────────────────────────

  app.get("/api/sp/sales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const sales = await db
        .select()
        .from(spSales)
        .where(eq(spSales.companyId, companyId))
        .orderBy(desc(spSales.createdAt));

      const lines = await db
        .select()
        .from(spSaleLines)
        .where(eq(spSaleLines.companyId, companyId));

      const result = sales.map(s => ({
        ...s,
        lines: lines.filter(l => l.saleId === s.id),
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/sales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { saleDate, customerName, saleLines, bankAccountId, notes } = req.body;

      if (!saleDate || !customerName || !Array.isArray(saleLines) || saleLines.length === 0) {
        return res.status(400).json({ message: "saleDate, customerName, saleLines required" });
      }

      // Validate bank account belongs to this company (if provided)
      if (bankAccountId) {
        const [ba] = await db.select({ id: bankAccounts.id, companyId: bankAccounts.companyId })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.id, parseInt(bankAccountId)), eq(bankAccounts.companyId, companyId)))
          .limit(1);
        if (!ba) {
          return res.status(400).json({ message: "Invalid bank account — account not found for this company" });
        }
      }

      const salesAcct   = await getSpAccount(companyId, "sp_sales");
      const cogsAcct    = await getSpAccount(companyId, "sp_cogs");
      const stockAcct   = await getSpAccount(companyId, "sp_stock");
      const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
      const payableAcct = await getSpAccount(companyId, "sp_payable");

      if (!salesAcct || !cogsAcct || !stockAcct || !costClrAcct || !payableAcct) {
        return res.status(400).json({ message: "SP accounts not configured. Run Setup first." });
      }

      const result = await db.transaction(async (tx) => {
        let totalSalePrice = 0;
        let totalBaseCost  = 0;
        let totalFinalCost = 0;
        const postedLines: any[] = [];

        for (const sl of saleLines) {
          const qtySold   = parseNum(sl.qtySold);
          const salePrice = parseNum(sl.salePricePerUnit);
          if (qtySold <= 0) continue;

          const articleCode = sl.articleCode ? String(sl.articleCode).trim() : null;
          let stockItemId   = sl.stockItemId ? parseInt(sl.stockItemId) : null;

          if (!articleCode && !stockItemId) throw new Error("Each sale line needs articleCode or stockItemId");

          // ── Alias resolution: articleCode → stockItemId ───────────────────
          if (!stockItemId && articleCode) {
            const aliasRows = await db
              .select()
              .from(stockItemCodeAliases)
              .where(and(eq(stockItemCodeAliases.companyId, companyId), eq(stockItemCodeAliases.aliasCode, articleCode)));
            if (aliasRows.length > 0) stockItemId = aliasRows[0].stockItemId;
          }

          // ── FIFO lot selection (server-side) ──────────────────────────────
          let lotsQuery: any;
          if (stockItemId) {
            lotsQuery = await tx.execute(
              sql`SELECT * FROM sp_stock_movements
                  WHERE company_id = ${companyId} AND stock_item_id = ${stockItemId} AND qty_remaining > 0
                  ORDER BY created_at ASC, id ASC FOR UPDATE`
            );
          } else {
            lotsQuery = await tx.execute(
              sql`SELECT * FROM sp_stock_movements
                  WHERE company_id = ${companyId} AND article_code = ${articleCode} AND qty_remaining > 0
                  ORDER BY created_at ASC, id ASC FOR UPDATE`
            );
          }

          const lots = (lotsQuery as any).rows ?? (lotsQuery as any);
          const totalAvail = lots.reduce((s: number, l: any) => s + parseNum(l.qty_remaining), 0);
          if (qtySold > totalAvail + 0.0001) {
            throw new Error(
              `Insufficient stock for ${articleCode || `item #${stockItemId}`}: available ${totalAvail.toFixed(4)}, requested ${qtySold}`
            );
          }

          let qtyLeft = qtySold;
          for (const lot of lots) {
            if (qtyLeft <= 0.0001) break;
            const qtyFromLot    = Math.min(qtyLeft, parseNum(lot.qty_remaining));
            qtyLeft            -= qtyFromLot;
            const baseUC        = parseNum(lot.base_unit_cost_usd);
            const landedUC      = parseNum(lot.landed_unit_cost_usd);
            const finalUC       = parseNum(lot.final_unit_cost_usd);
            const saleTotal     = qtyFromLot * salePrice;
            const baseTotal     = qtyFromLot * baseUC;
            const finalTotal    = qtyFromLot * finalUC;

            totalSalePrice += saleTotal;
            totalBaseCost  += baseTotal;
            totalFinalCost += finalTotal;

            await tx.execute(
              sql`UPDATE sp_stock_movements SET qty_remaining = ${String(parseNum(lot.qty_remaining) - qtyFromLot)} WHERE id = ${lot.id}`
            );

            if (lot.stock_item_id && lot.location_id) {
              try {
                await adjustInventory(tx, parseInt(lot.location_id), parseInt(lot.stock_item_id), -qtyFromLot, companyId);
              } catch { /* non-blocking */ }
            }

            postedLines.push({
              movementId:       lot.id,
              articleCode:      lot.article_code,
              description:      lot.description || null,
              stockItemId:      lot.stock_item_id || null,
              qtySold:          qtyFromLot,
              salePricePerUnit: salePrice,
              baseUnitCostUsd:  baseUC,
              landedUnitCostUsd: landedUC,
              finalUnitCostUsd: finalUC,
              saleTotal,
              baseTotal,
              finalTotal,
            });
          }
        }

        if (postedLines.length === 0) throw new Error("No valid sale lines");

        const grossProfit = totalSalePrice - totalFinalCost;

        const [sale] = await tx.insert(spSales).values({
          companyId,
          saleDate,
          customerName,
          totalSalePriceUsd: String(totalSalePrice),
          totalBaseCostUsd:  String(totalBaseCost),
          totalFinalCostUsd: String(totalFinalCost),
          grossProfitUsd:    String(grossProfit),
          status: "posted",
          notes: notes || null,
        }).returning();

        const voucherNum = `SP-SALE-${sale.id}-${Date.now()}`;
        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType:  "Journal",
          voucherNumber: voucherNum,
          voucherDate:  saleDate,
          description:  `Sale — ${customerName}`,
          totalAmount:  String(totalSalePrice),
          currency:     "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        if (bankAccountId) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            bankAccountId: parseInt(bankAccountId),
            debitAmount:  String(totalSalePrice),
            creditAmount: "0",
            narration: `Sale receipts — ${customerName}`,
          });
        }

        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: salesAcct.id,
          debitAmount: "0", creditAmount: String(totalSalePrice),
          narration: `Sales — ${customerName}`,
        });
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: cogsAcct.id,
          debitAmount: String(totalFinalCost), creditAmount: "0",
          narration: `COGS — ${customerName}`,
        });
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: stockAcct.id,
          debitAmount: "0", creditAmount: String(totalFinalCost),
          narration: `Stock reduction — ${customerName}`,
        });
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: costClrAcct.id,
          debitAmount: String(totalBaseCost), creditAmount: "0",
          narration: `Cost clearing — base cost to payable — ${customerName}`,
        });
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: payableAcct.id,
          debitAmount: "0", creditAmount: String(totalBaseCost),
          narration: `Supplier Cash Payable — ${customerName}`,
        });

        await tx.insert(spSaleLines).values(
          postedLines.map((pl: any) => ({
            saleId:           sale.id,
            companyId,
            movementId:       pl.movementId,
            articleCode:      pl.articleCode,
            description:      pl.description || null,
            stockItemId:      pl.stockItemId || null,
            qtySold:          String(pl.qtySold),
            salePricePerUnit: String(pl.salePricePerUnit),
            baseUnitCostUsd:  String(pl.baseUnitCostUsd),
            landedUnitCostUsd: String(pl.landedUnitCostUsd),
            finalUnitCostUsd: String(pl.finalUnitCostUsd),
          }))
        );

        await tx.update(spSales).set({ voucherId: voucher.id }).where(eq(spSales.id, sale.id));
        return { ...sale, voucherId: voucher.id, lines: postedLines };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Stock Movements ───────────────────────────────────────────────────────

  app.get("/api/sp/stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const movements = await db
        .select()
        .from(spStockMovements)
        .where(and(eq(spStockMovements.companyId, companyId), gt(spStockMovements.qtyRemaining, "0")))
        .orderBy(asc(spStockMovements.createdAt));

      res.json(movements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/stock/all", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const movements = await db
        .select()
        .from(spStockMovements)
        .where(eq(spStockMovements.companyId, companyId))
        .orderBy(asc(spStockMovements.createdAt));

      res.json(movements);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Opening Stock ─────────────────────────────────────────────────────────

  app.get("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(
        sql`SELECT * FROM sp_stock_movements WHERE company_id = ${companyId} AND source_type = 'opening' ORDER BY created_at DESC`
      );
      res.json((rows as any).rows ?? (rows as any));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/opening-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { articleCode, stockItemId, qty, baseUnitCostUsd, landedUnitCostUsd, finalUnitCostUsd, locationId, notes } = req.body;

      if (!articleCode) return res.status(400).json({ message: "articleCode required" });
      const qtyNum  = parseNum(qty);
      if (qtyNum <= 0) return res.status(400).json({ message: "qty must be > 0" });
      const baseUC  = parseNum(baseUnitCostUsd);
      const landUC  = parseNum(landedUnitCostUsd);
      const finalUC = parseNum(finalUnitCostUsd);
      if (finalUC <= 0) return res.status(400).json({ message: "finalUnitCostUsd must be > 0" });

      const stockAcct   = await getSpAccount(companyId, "sp_stock");
      const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
      const opnBalAcct  = await getSpAccount(companyId, "sp_opnbal");
      if (!stockAcct || !costClrAcct || !opnBalAcct) {
        return res.status(400).json({ message: "SP accounts not configured. Run Setup first." });
      }

      let locId: number | null = locationId ? parseInt(locationId) : null;
      if (!locId) {
        const locs = await db.select().from(locations).where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));
        if (locs.length > 0) locId = locs[0].id;
      }

      const finalTotal = qtyNum * finalUC;
      const baseTotal  = qtyNum * baseUC;
      const landTotal  = qtyNum * landUC;

      const result = await db.transaction(async (tx) => {
        const [movement] = await tx.insert(spStockMovements).values({
          companyId,
          sourceType:       "opening",
          articleCode,
          description:      notes || null,
          stockItemId:      stockItemId ? parseInt(stockItemId) : null,
          locationId:       locId,
          qtyIn:            String(qtyNum),
          qtyRemaining:     String(qtyNum),
          baseUnitCostUsd:  String(baseUC),
          landedUnitCostUsd: String(landUC),
          finalUnitCostUsd: String(finalUC),
        }).returning();

        if (stockItemId && locId) {
          try { await adjustInventory(tx, locId, parseInt(stockItemId), qtyNum, companyId); } catch { /* non-blocking */ }
        }

        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType:  "Journal",
          voucherNumber: `SP-OPNSTK-${movement.id}-${Date.now()}`,
          voucherDate:  new Date().toISOString().slice(0, 10),
          description:  `Opening stock — ${articleCode} (${qtyNum} units)`,
          totalAmount:  String(finalTotal),
          currency:     "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        // Dr SP-STOCK = finalTotal
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: stockAcct.id,
          debitAmount: String(finalTotal), creditAmount: "0",
          narration: `Opening stock — ${articleCode} — ${qtyNum} units @ $${finalUC} (final)`,
        });
        // Cr SP-COSTCLR = baseTotal (cleared to supplier payable when sold)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id, ledgerAccountId: costClrAcct.id,
          debitAmount: "0", creditAmount: String(baseTotal),
          narration: `Opening stock base cost clearing — ${articleCode}`,
        });
        // Cr SP-OPNBAL = landTotal (opening equity source for landed portion)
        if (landTotal > 0.00001) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id, ledgerAccountId: opnBalAcct.id,
            debitAmount: "0", creditAmount: String(landTotal),
            narration: `Opening stock landed clearing — ${articleCode}`,
          });
        } else if (Math.abs(finalTotal - baseTotal) > 0.00001) {
          // finalUC was set manually different from base+landed=0, route difference to opnbal
          const diff = finalTotal - baseTotal;
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id, ledgerAccountId: opnBalAcct.id,
            debitAmount: diff < 0 ? String(Math.abs(diff)) : "0",
            creditAmount: diff >= 0 ? String(diff) : "0",
            narration: `Opening stock cost adjustment — ${articleCode}`,
          });
        }

        return { movement, voucherId: voucher.id };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Aliases (article code → stock item mapping) ───────────────────────────

  app.get("/api/sp/aliases", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const rows = await db.execute(sql`
        SELECT a.id, a.alias_code, a.description, a.stock_item_id,
               si.name AS stock_item_name, si.code AS stock_item_code
        FROM stock_item_code_aliases a
        LEFT JOIN stock_items si ON a.stock_item_id = si.id
        WHERE a.company_id = ${companyId}
        ORDER BY a.alias_code ASC
      `);
      res.json((rows as any).rows ?? (rows as any));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/aliases", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      const { aliasCode, stockItemId, description } = req.body;
      if (!aliasCode || !stockItemId) return res.status(400).json({ message: "aliasCode and stockItemId required" });
      const [row] = await db.insert(stockItemCodeAliases).values({
        companyId,
        stockItemId: parseInt(stockItemId),
        aliasCode: String(aliasCode).trim(),
        description: description || null,
      }).returning();
      res.json(row);
    } catch (error: any) {
      if (error.code === "23505") return res.status(400).json({ message: "Alias code already exists for this company" });
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/sp/aliases/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;
      await db.execute(sql`DELETE FROM stock_item_code_aliases WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId}`);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Reports ───────────────────────────────────────────────────────────────

  app.get("/api/sp/report/payable", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const payableAcct = await getSpAccount(companyId, "sp_payable");
      if (!payableAcct) return res.json({ openingBalance: 0, movements: [], closingBalance: 0 });

      // All voucher entries against Supplier Cash Payable account
      const rows = await db.execute(sql`
        SELECT ve.*, v.voucher_date, v.description, v.voucher_number
        FROM voucher_entries ve
        JOIN vouchers v ON ve.voucher_id = v.id
        WHERE ve.ledger_account_id = ${payableAcct.id}
          AND v.company_id = ${companyId}
        ORDER BY v.voucher_date ASC, v.id ASC
      `);

      const entries = (rows as any).rows ?? (rows as any);
      let runningBalance = 0;
      const movements = entries.map((e: any) => {
        const credit = parseNum(e.credit_amount);
        const debit  = parseNum(e.debit_amount);
        runningBalance += credit - debit;
        return {
          date: e.voucher_date,
          description: e.description,
          voucherNumber: e.voucher_number,
          credit,
          debit,
          balance: runningBalance,
        };
      });

      res.json({ openingBalance: 0, movements, closingBalance: runningBalance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/report/profit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { startDate, endDate } = req.query;

      // ── Resolve configured POS accounts from company settings ──────────────
      // SP POS sales no longer use the sp_sales table — they go through the standard
      // ERP POS route (posRoutes.ts) and land in vouchers + voucher_entries.
      // Revenue = credits to the profit account (grandTotal per sale).
      // COGS    = credits to the payable account (supplier cost per sale).
      // Net profit = Revenue − COGS  (e.g. $775 − $482.60 = $292.40).
      const settingsRows = await db.execute(sql`
        SELECT sp_pos_payable_account_id, sp_pos_profit_account_id
        FROM company_settings
        WHERE company_id = ${companyId}
        LIMIT 1
      `);
      const settingsRow = ((settingsRows as any).rows ?? settingsRows)[0];
      const spPosProfitAccountId  = settingsRow?.sp_pos_profit_account_id  ?? null;
      const spPosPayableAccountId = settingsRow?.sp_pos_payable_account_id ?? null;

      let totalRevenue = 0;
      let totalCogs    = 0;
      let saleCount    = 0;

      // Use salesItems as source of truth: totalSales/totalCost/profit are stored
      // at sale time regardless of how the ledger accounts are configured.
      // This correctly handles old sales and eliminates reliance on voucher-entry math.
      const siRows = await db.execute(sql`
        SELECT
          COALESCE(SUM(CAST(si.total_sales AS DECIMAL)), 0) AS total_revenue,
          COALESCE(SUM(CAST(si.total_cost  AS DECIMAL)), 0) AS total_cogs,
          COUNT(DISTINCT v.id)                              AS cnt
        FROM sales_items si
        JOIN vouchers v ON si.voucher_id = v.id
        WHERE v.company_id   = ${companyId}
          AND v.voucher_type = 'Sales'
          AND v.deleted_at   IS NULL
          ${startDate ? sql`AND v.voucher_date >= ${startDate}` : sql``}
          ${endDate   ? sql`AND v.voucher_date <= ${endDate}`   : sql``}
      `);
      const siRow = ((siRows as any).rows ?? siRows)[0];
      totalRevenue = parseNum(siRow?.total_revenue);
      totalCogs    = parseNum(siRow?.total_cogs);
      saleCount    = parseInt(String(siRow?.cnt ?? "0"), 10);

      const grossProfit = totalRevenue - totalCogs;

      // Shared charges: debits to the sp_shared_charges account in the period
      const sharedAcct = await getSpAccount(companyId, "sp_shared_charges");
      let totalSharedCharges = 0;
      if (sharedAcct) {
        const sharedRows = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(ve.debit_amount AS DECIMAL)), 0) as total
          FROM voucher_entries ve
          JOIN vouchers v ON ve.voucher_id = v.id
          WHERE ve.ledger_account_id = ${sharedAcct.id}
            AND v.company_id         = ${companyId}
            AND v.deleted_at IS NULL
            ${startDate ? sql`AND v.voucher_date >= ${startDate}` : sql``}
            ${endDate   ? sql`AND v.voucher_date <= ${endDate}`   : sql``}
        `);
        const sr = ((sharedRows as any).rows ?? sharedRows)[0];
        totalSharedCharges = parseNum(sr?.total);
      }

      const netProfit     = grossProfit - totalSharedCharges;
      const splitPct      = 50;
      const ourShare      = netProfit * (splitPct / 100);
      const supplierShare = netProfit - ourShare;

      res.json({
        totalRevenue,
        totalCogs,
        grossProfit,
        totalSharedCharges,
        netProfit,
        splitPct,
        ourShare,
        supplierShare,
        saleCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/sp/report/stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const movements = await db
        .select()
        .from(spStockMovements)
        .where(eq(spStockMovements.companyId, companyId))
        .orderBy(asc(spStockMovements.articleCode));

      // Group by articleCode
      const groups = new Map<string, any>();
      for (const m of movements) {
        const key = m.articleCode;
        if (!groups.has(key)) {
          groups.set(key, {
            articleCode: key,
            description: m.description,
            totalQtyIn: 0,
            totalQtyRemaining: 0,
            totalValueIn: 0,
            totalValueRemaining: 0,
            movements: [],
          });
        }
        const g = groups.get(key)!;
        const qtyIn = parseNum(m.qtyIn);
        const qtyRem = parseNum(m.qtyRemaining);
        const finalCost = parseNum(m.finalUnitCostUsd);
        g.totalQtyIn        += qtyIn;
        g.totalQtyRemaining += qtyRem;
        g.totalValueIn      += qtyIn  * finalCost;
        g.totalValueRemaining += qtyRem * finalCost;
        g.movements.push(m);
      }

      const result = [...groups.values()].map(g => ({
        ...g,
        avgFinalCost: g.totalQtyRemaining > 0 ? g.totalValueRemaining / g.totalQtyRemaining : 0,
      }));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Sales Detail Report ───────────────────────────────────────────────────

  app.get("/api/sp/report/sales-detail", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { startDate, endDate } = req.query;
      const dateFilter = `
        ${startDate ? `AND s.sale_date >= '${startDate}'` : ""}
        ${endDate   ? `AND s.sale_date <= '${endDate}'`   : ""}
      `;

      // Per-article sales aggregation
      const salesRows = await db.execute(sql`
        SELECT
          sl.article_code,
          MAX(sl.description) AS description,
          SUM(CAST(sl.qty_sold AS DECIMAL))                                          AS sold_qty,
          SUM(CAST(sl.qty_sold AS DECIMAL) * CAST(sl.sale_price_per_unit AS DECIMAL)) AS sales_total,
          SUM(CAST(sl.qty_sold AS DECIMAL) * CAST(sl.final_unit_cost_usd AS DECIMAL)) AS total_final_cost,
          SUM(CAST(sl.qty_sold AS DECIMAL) * CAST(sl.base_unit_cost_usd AS DECIMAL))  AS base_payable,
          AVG(CAST(sl.final_unit_cost_usd AS DECIMAL))                               AS avg_final_cost,
          AVG(CAST(sl.sale_price_per_unit AS DECIMAL))                               AS avg_sale_price
        FROM sp_sale_lines sl
        JOIN sp_sales s ON sl.sale_id = s.id
        WHERE sl.company_id = ${companyId} AND s.status = 'posted'
        ${sql.raw(dateFilter)}
        GROUP BY sl.article_code
        ORDER BY sl.article_code ASC
      `);

      // Current stock remaining per article
      const stockRows = await db.execute(sql`
        SELECT article_code,
               SUM(CAST(qty_in AS DECIMAL))        AS total_qty_in,
               SUM(CAST(qty_remaining AS DECIMAL))  AS qty_remaining
        FROM sp_stock_movements
        WHERE company_id = ${companyId}
        GROUP BY article_code
      `);

      // Total supplier payments (debit on SP-PAY = payment made)
      const payableAcct = await getSpAccount(companyId, "sp_payable");
      let paymentsTotal = 0;
      let payableBalance = 0;
      if (payableAcct) {
        const payRows = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(debit_amount AS DECIMAL)), 0)  AS total_payments,
                 COALESCE(SUM(CAST(credit_amount AS DECIMAL)), 0) AS total_credits
          FROM voucher_entries ve
          JOIN vouchers v ON ve.voucher_id = v.id
          WHERE ve.ledger_account_id = ${payableAcct.id} AND v.company_id = ${companyId}
        `);
        const pr = ((payRows as any).rows ?? payRows)[0];
        paymentsTotal  = parseNum(pr?.total_payments);
        payableBalance = parseNum(pr?.total_credits) - paymentsTotal;
      }

      const salesArr  = (salesRows  as any).rows ?? (salesRows  as any);
      const stockArr  = (stockRows  as any).rows ?? (stockRows  as any);
      const stockMap  = new Map<string, any>();
      for (const s of stockArr) stockMap.set(s.article_code, s);

      const rows = salesArr.map((r: any) => {
        const stk = stockMap.get(r.article_code) || {};
        const soldQty    = parseNum(r.sold_qty);
        const salesTotal = parseNum(r.sales_total);
        const finalCost  = parseNum(r.total_final_cost);
        const basePay    = parseNum(r.base_payable);
        return {
          articleCode:      r.article_code,
          description:      r.description,
          totalQtyIn:       parseNum(stk.total_qty_in),
          currentQtyRemaining: parseNum(stk.qty_remaining),
          soldQty,
          salesTotal,
          avgSalePrice:     parseNum(r.avg_sale_price),
          totalFinalCost:   finalCost,
          avgFinalCost:     parseNum(r.avg_final_cost),
          grossProfit:      salesTotal - finalCost,
          basePayable:      basePay,
        };
      });

      res.json({ rows, paymentsTotal, remainingPayable: payableBalance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Profit Splits ─────────────────────────────────────────────────────────

  app.get("/api/sp/profit-splits", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const splits = await db
        .select()
        .from(spProfitSplits)
        .where(eq(spProfitSplits.companyId, companyId))
        .orderBy(desc(spProfitSplits.periodMonth));

      res.json(splits);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/sp/profit-splits", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { periodMonth, totalRevenue, totalCogs, totalSharedCharges, splitPct } = req.body;

      if (!periodMonth) return res.status(400).json({ message: "periodMonth required (YYYY-MM)" });

      const rev    = parseNum(totalRevenue);
      const cogs   = parseNum(totalCogs);
      const shared = parseNum(totalSharedCharges);
      const gross  = rev - cogs;
      const net    = gross - shared;
      const pct    = parseNum(splitPct) || 50;
      const our    = net * (pct / 100);
      const sup    = net - our;

      const [split] = await db.insert(spProfitSplits).values({
        companyId,
        periodMonth,
        totalRevenue: String(rev),
        totalCogs: String(cogs),
        totalSharedCharges: String(shared),
        grossProfit: String(gross),
        splitPct: String(pct),
        ourShare: String(our),
        supplierShare: String(sup),
        finalizedAt: new Date(),
      }).returning();

      res.json(split);
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(400).json({ message: `Profit split for ${req.body.periodMonth} already exists` });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
