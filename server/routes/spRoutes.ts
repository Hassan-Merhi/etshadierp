import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { sql, eq, and, gt, isNull, desc, asc } from "drizzle-orm";
import {
  ledgerAccounts, vouchers, voucherEntries, locations, bankAccounts,
  spContainers, spContainerLines, spPrepaidCharges, spOffloads,
  spOffloadCharges, spStockMovements, spSales, spSaleLines, spProfitSplits,
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
  { code: "SP-OTW",     name: "Goods On The Way",              accountType: "Asset",          subType: "sp_goods_otw",      isHidden: false },
  { code: "SP-OTWCLR",  name: "Goods OTW Clearing",            accountType: "Liability",       subType: "sp_otw_clearing",   isHidden: true  },
  { code: "SP-PREPAID", name: "Prepaid Charges",               accountType: "Asset",          subType: "sp_prepaid",        isHidden: false },
  { code: "SP-STOCK",   name: "Stock on Floor",                accountType: "Asset",          subType: "sp_stock",          isHidden: false },
  { code: "SP-COSTCLR", name: "Stock Cost Payable Clearing",   accountType: "Liability",       subType: "sp_cost_clearing",  isHidden: true  },
  { code: "SP-PAY",     name: "Supplier Cash Payable",         accountType: "Liability",       subType: "sp_payable",        isHidden: false },
  { code: "SP-SALES",   name: "Sales",                         accountType: "Income",         subType: "sp_sales",          isHidden: false },
  { code: "SP-COGS",    name: "Cost of Goods Sold",            accountType: "Direct Expense", subType: "sp_cogs",           isHidden: false },
  { code: "SP-SHARED",  name: "Shared Charges",                accountType: "Direct Expense", subType: "sp_shared_charges", isHidden: false },
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

      const { supplierName, invoiceNumber, invoiceDate, invoiceTotalUsd, discountPct, notes, lines } = req.body;

      if (!supplierName || !invoiceNumber || !invoiceDate) {
        return res.status(400).json({ message: "supplierName, invoiceNumber, invoiceDate are required" });
      }

      const otwAcct = await getSpAccount(companyId, "sp_goods_otw");
      const otwClrAcct = await getSpAccount(companyId, "sp_otw_clearing");
      if (!otwAcct || !otwClrAcct) {
        return res.status(400).json({ message: "Chart of accounts not set up. Run /api/sp/setup first." });
      }

      const totalUsd = parseNum(invoiceTotalUsd);

      const result = await db.transaction(async (tx) => {
        const [container] = await tx.insert(spContainers).values({
          companyId,
          supplierName,
          invoiceNumber,
          invoiceDate,
          invoiceTotalUsd: String(totalUsd),
          discountPct: String(parseNum(discountPct)),
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

      const { containerId, chargeType, agentName, amountPaidUsd, bankAccountId, notes } = req.body;

      if (!containerId || !chargeType || !amountPaidUsd) {
        return res.status(400).json({ message: "containerId, chargeType, amountPaidUsd required" });
      }

      const prepaidAcct = await getSpAccount(companyId, "sp_prepaid");
      if (!prepaidAcct) return res.status(400).json({ message: "SP accounts not set up" });

      const amount = parseNum(amountPaidUsd);
      const date = getClientDate(req);

      const result = await db.transaction(async (tx) => {
        const [charge] = await tx.insert(spPrepaidCharges).values({
          companyId,
          containerId: parseInt(containerId),
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

  // ── Offload ───────────────────────────────────────────────────────────────

  app.post("/api/sp/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { containerId, offloadDate, chargeLines } = req.body;

      if (!containerId || !offloadDate) {
        return res.status(400).json({ message: "containerId and offloadDate are required" });
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

      // Get default location for this company
      const [defaultLocation] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)))
        .orderBy(asc(locations.id))
        .limit(1);

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
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              bankAccountId: parseInt(charge.creditBankAccountId),
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Cash paid at offload — ${charge.description || "charge"}`,
            });

          } else if (charge.chargeType === "unpaid_payable" && charge.creditLedgerAccountId) {
            await tx.insert(voucherEntries).values({
              voucherId: voucherB.id,
              ledgerAccountId: parseInt(charge.creditLedgerAccountId),
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `Payable — ${charge.description || "charge"}`,
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
              creditLedgerAccountId: c.creditLedgerAccountId ? parseInt(c.creditLedgerAccountId) : null,
              creditBankAccountId: c.creditBankAccountId ? parseInt(c.creditBankAccountId) : null,
            }))
          );
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
            locationId: defaultLocation?.id || null,
            qtyIn: String(qty),
            qtyRemaining: String(qty),
            baseUnitCostUsd: String(baseUnitCost),
            landedUnitCostUsd: String(landedPerUnit),
            finalUnitCostUsd: String(finalUnitCost),
          });

          // Call adjustInventory if stock item + location are configured
          if (line.stockItemId && defaultLocation) {
            try {
              await adjustInventory(tx, defaultLocation.id, line.stockItemId, qty, companyId, finalUnitCost, "SP_OFFLOAD", offload.id);
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

      if (!saleDate || !customerName || !saleLines || saleLines.length === 0) {
        return res.status(400).json({ message: "saleDate, customerName, saleLines required" });
      }

      const salesAcct   = await getSpAccount(companyId, "sp_sales");
      const cogsAcct    = await getSpAccount(companyId, "sp_cogs");
      const stockAcct   = await getSpAccount(companyId, "sp_stock");
      const costClrAcct = await getSpAccount(companyId, "sp_cost_clearing");
      const payableAcct = await getSpAccount(companyId, "sp_payable");

      if (!salesAcct || !cogsAcct || !stockAcct || !costClrAcct || !payableAcct) {
        return res.status(400).json({ message: "SP accounts not configured" });
      }

      const result = await db.transaction(async (tx) => {
        let totalSalePrice = 0;
        let totalBaseCost  = 0;
        let totalFinalCost = 0;
        const postedLines: any[] = [];

        for (const sl of saleLines) {
          const movementId = parseInt(sl.movementId);
          const qtySold    = parseNum(sl.qtySold);
          const salePrice  = parseNum(sl.salePricePerUnit);

          if (qtySold <= 0) continue;

          // Lock and read the movement
          const mvRows = await tx.execute(
            sql`SELECT * FROM sp_stock_movements WHERE id = ${movementId} AND company_id = ${companyId} FOR UPDATE`
          );
          const mv = (mvRows as any).rows?.[0] ?? (mvRows as any)[0];
          if (!mv) throw new Error(`Stock movement #${movementId} not found`);

          const qtyRemaining = parseNum(mv.qty_remaining);
          if (qtySold > qtyRemaining) {
            throw new Error(`Insufficient stock in movement #${movementId}: have ${qtyRemaining}, selling ${qtySold}`);
          }

          const baseUnitCost   = parseNum(mv.base_unit_cost_usd);
          const landedUnitCost = parseNum(mv.landed_unit_cost_usd);
          const finalUnitCost  = parseNum(mv.final_unit_cost_usd);

          const saleTotal = qtySold * salePrice;
          const baseTotal = qtySold * baseUnitCost;
          const finalTotal = qtySold * finalUnitCost;

          totalSalePrice += saleTotal;
          totalBaseCost  += baseTotal;
          totalFinalCost += finalTotal;

          // Deduct from stock movement
          await tx.execute(
            sql`UPDATE sp_stock_movements SET qty_remaining = ${String(qtyRemaining - qtySold)} WHERE id = ${movementId}`
          );

          // Deduct from inventory if linked
          if (mv.stock_item_id && mv.location_id) {
            try {
              await adjustInventory(tx, parseInt(mv.location_id), parseInt(mv.stock_item_id), -qtySold, companyId);
            } catch {
              // Non-blocking
            }
          }

          postedLines.push({
            movementId,
            articleCode: mv.article_code,
            description: mv.description,
            stockItemId: mv.stock_item_id || null,
            qtySold,
            salePricePerUnit: salePrice,
            baseUnitCostUsd: baseUnitCost,
            landedUnitCostUsd: landedUnitCost,
            finalUnitCostUsd: finalUnitCost,
            saleTotal,
            baseTotal,
            finalTotal,
          });
        }

        if (postedLines.length === 0) throw new Error("No valid sale lines");

        const grossProfit = totalSalePrice - totalFinalCost;

        // ── Voucher A: Revenue ────────────────────────────────────────────────
        const [sale] = await tx.insert(spSales).values({
          companyId,
          saleDate,
          customerName,
          totalSalePriceUsd: String(totalSalePrice),
          totalBaseCostUsd: String(totalBaseCost),
          totalFinalCostUsd: String(totalFinalCost),
          grossProfitUsd: String(grossProfit),
          status: "posted",
          notes: notes || null,
        }).returning();

        const voucherNum = `SP-SALE-${sale.id}-${Date.now()}`;

        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: voucherNum,
          voucherDate: saleDate,
          description: `Sale — ${customerName}`,
          totalAmount: String(totalSalePrice),
          currency: "USD",
          exchangeRate: "1",
          sourceModule: "SP",
        }).returning();

        // Dr Cash/Bank (or leave debit side open for now; use bank if provided)
        if (bankAccountId) {
          await tx.insert(voucherEntries).values({
            voucherId: voucher.id,
            bankAccountId: parseInt(bankAccountId),
            debitAmount: String(totalSalePrice),
            creditAmount: "0",
            narration: `Sale receipts — ${customerName}`,
          });
        }

        // Cr Sales
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: salesAcct.id,
          debitAmount: "0",
          creditAmount: String(totalSalePrice),
          narration: `Sales — ${customerName}`,
        });

        // ── Voucher B: COGS (Dr COGS / Cr Stock) ─────────────────────────────
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: cogsAcct.id,
          debitAmount: String(totalFinalCost),
          creditAmount: "0",
          narration: `COGS — ${customerName}`,
        });

        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: stockAcct.id,
          debitAmount: "0",
          creditAmount: String(totalFinalCost),
          narration: `Stock reduction — ${customerName}`,
        });

        // ── Voucher C: Transfer base cost → Supplier Cash Payable ─────────────
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: costClrAcct.id,
          debitAmount: String(totalBaseCost),
          creditAmount: "0",
          narration: `Cost clearing — base cost to payable — ${customerName}`,
        });

        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: payableAcct.id,
          debitAmount: "0",
          creditAmount: String(totalBaseCost),
          narration: `Supplier Cash Payable — ${customerName}`,
        });

        // ── Sale lines ────────────────────────────────────────────────────────
        await tx.insert(spSaleLines).values(
          postedLines.map((pl: any) => ({
            saleId: sale.id,
            companyId,
            movementId: pl.movementId,
            articleCode: pl.articleCode,
            description: pl.description || null,
            stockItemId: pl.stockItemId || null,
            qtySold: String(pl.qtySold),
            salePricePerUnit: String(pl.salePricePerUnit),
            baseUnitCostUsd: String(pl.baseUnitCostUsd),
            landedUnitCostUsd: String(pl.landedUnitCostUsd),
            finalUnitCostUsd: String(pl.finalUnitCostUsd),
          }))
        );

        await tx.update(spSales)
          .set({ voucherId: voucher.id })
          .where(eq(spSales.id, sale.id));

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

      const conditions: any[] = [eq(spSales.companyId, companyId), eq(spSales.status, "posted")];
      if (startDate) conditions.push(sql`${spSales.saleDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${spSales.saleDate} <= ${endDate}`);

      const sales = await db
        .select()
        .from(spSales)
        .where(and(...conditions));

      const totalRevenue    = sales.reduce((s, r) => s + parseNum(r.totalSalePriceUsd), 0);
      const totalCogs       = sales.reduce((s, r) => s + parseNum(r.totalFinalCostUsd), 0);
      const grossProfit     = totalRevenue - totalCogs;

      // Shared charges from voucher entries
      const sharedAcct = await getSpAccount(companyId, "sp_shared_charges");
      let totalSharedCharges = 0;
      if (sharedAcct) {
        const sharedRows = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(ve.debit_amount AS DECIMAL)), 0) as total
          FROM voucher_entries ve
          JOIN vouchers v ON ve.voucher_id = v.id
          WHERE ve.ledger_account_id = ${sharedAcct.id}
            AND v.company_id = ${companyId}
            ${startDate ? sql`AND v.voucher_date >= ${startDate}` : sql``}
            ${endDate ? sql`AND v.voucher_date <= ${endDate}` : sql``}
        `);
        const sr = ((sharedRows as any).rows ?? sharedRows)[0];
        totalSharedCharges = parseNum(sr?.total);
      }

      const netProfit = grossProfit - totalSharedCharges;
      const splitPct = 50;
      const ourShare       = netProfit * (splitPct / 100);
      const supplierShare  = netProfit - ourShare;

      res.json({
        totalRevenue,
        totalCogs,
        grossProfit,
        totalSharedCharges,
        netProfit,
        splitPct,
        ourShare,
        supplierShare,
        saleCount: sales.length,
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
