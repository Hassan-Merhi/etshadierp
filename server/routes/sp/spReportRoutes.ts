import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql, eq, asc, desc } from "drizzle-orm";
import { spStockMovements, spProfitSplits } from "@shared/schema";
import { requireSpCompany, getSpAccount, parseNum } from "./spHelpers";

// ── Reports + Profit Splits ───────────────────────────────────────────────────

export function registerSpReportRoutes(app: Express) {
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
        const debit = parseNum(e.debit_amount);
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
      const spPosProfitAccountId = settingsRow?.sp_pos_profit_account_id ?? null;
      const spPosPayableAccountId = settingsRow?.sp_pos_payable_account_id ?? null;

      let totalRevenue = 0;
      let totalCogs = 0;
      let saleCount = 0;

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
          ${endDate ? sql`AND v.voucher_date <= ${endDate}` : sql``}
      `);
      const siRow = ((siRows as any).rows ?? siRows)[0];
      totalRevenue = parseNum(siRow?.total_revenue);
      totalCogs = parseNum(siRow?.total_cogs);
      saleCount = parseInt(String(siRow?.cnt ?? "0"), 10);

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
            ${endDate ? sql`AND v.voucher_date <= ${endDate}` : sql``}
        `);
        const sr = ((sharedRows as any).rows ?? sharedRows)[0];
        totalSharedCharges = parseNum(sr?.total);
      }

      const netProfit = grossProfit - totalSharedCharges;
      const splitPct = 50;
      const ourShare = netProfit * (splitPct / 100);
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
        g.totalQtyIn += qtyIn;
        g.totalQtyRemaining += qtyRem;
        g.totalValueIn += qtyIn * finalCost;
        g.totalValueRemaining += qtyRem * finalCost;
        g.movements.push(m);
      }

      const result = [...groups.values()].map((g) => ({
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
        ${startDate ? sql`AND s.sale_date >= ${startDate}` : sql``}
        ${endDate ? sql`AND s.sale_date <= ${endDate}` : sql``}
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
        paymentsTotal = parseNum(pr?.total_payments);
        payableBalance = parseNum(pr?.total_credits) - paymentsTotal;
      }

      const salesArr = (salesRows as any).rows ?? (salesRows as any);
      const stockArr = (stockRows as any).rows ?? (stockRows as any);
      const stockMap = new Map<string, any>();
      for (const s of stockArr) stockMap.set(s.article_code, s);

      const rows = salesArr.map((r: any) => {
        const stk = stockMap.get(r.article_code) || {};
        const soldQty = parseNum(r.sold_qty);
        const salesTotal = parseNum(r.sales_total);
        const finalCost = parseNum(r.total_final_cost);
        const basePay = parseNum(r.base_payable);
        return {
          articleCode: r.article_code,
          description: r.description,
          totalQtyIn: parseNum(stk.total_qty_in),
          currentQtyRemaining: parseNum(stk.qty_remaining),
          soldQty,
          salesTotal,
          avgSalePrice: parseNum(r.avg_sale_price),
          totalFinalCost: finalCost,
          avgFinalCost: parseNum(r.avg_final_cost),
          grossProfit: salesTotal - finalCost,
          basePayable: basePay,
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

      const rev = parseNum(totalRevenue);
      const cogs = parseNum(totalCogs);
      const shared = parseNum(totalSharedCharges);
      const gross = rev - cogs;
      const net = gross - shared;
      const pct = parseNum(splitPct) || 50;
      const our = net * (pct / 100);
      const sup = net - our;

      const [split] = await db
        .insert(spProfitSplits)
        .values({
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
        })
        .returning();

      res.json(split);
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(400).json({ message: `Profit split for ${req.body.periodMonth} already exists` });
      }
      res.status(500).json({ message: error.message });
    }
  });
}
