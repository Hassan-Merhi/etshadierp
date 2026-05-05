import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  propertyMonthlyLedger,
  propertyContracts,
  propertyUnits,
  vouchers,
} from "../../shared/schema";
import { eq, sql } from "drizzle-orm";

export function registerBalanceRepairRoutes(app: Express) {

  // ── GET /api/admin/repair-balances/scan ──────────────────────────────────
  // Dry-run: compute discrepancies without writing anything.
  // Covers:
  //   1. property_monthly_ledger paid_amount drift (Properties / ERP Shops / Factory)
  //   2. guarantee_posted_to_statement flag vs actual voucher existence
  app.get(
    "/api/admin/repair-balances/scan",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId: number | undefined = req.session.currentCompanyId;
        if (!companyId)
          return res.status(400).json({ message: "No company selected" });

        // ── 1. Property monthly ledger paid_amount ────────────────────────
        const allLedger = await db
          .select()
          .from(propertyMonthlyLedger)
          .where(eq(propertyMonthlyLedger.companyId, companyId));

        const pmtSumsRows = await db.execute(sql`
          SELECT
            ledger_row_id,
            COALESCE(SUM(amount::numeric), 0) AS total_paid
          FROM property_payments
          WHERE company_id = ${companyId}
            AND ledger_row_id IS NOT NULL
          GROUP BY ledger_row_id
        `);

        const pmtMap = new Map<number, number>();
        for (const row of (pmtSumsRows as any).rows ?? pmtSumsRows) {
          pmtMap.set(Number(row.ledger_row_id), parseFloat(row.total_paid ?? "0"));
        }

        const ledgerDiscrepancies: {
          id: number; contractId: number; year: number; month: number;
          module: string; storedPaid: number; computedPaid: number; diff: number;
        }[] = [];

        for (const row of allLedger) {
          const computed = pmtMap.get(row.id) ?? 0;
          const stored   = parseFloat(row.paidAmount ?? "0");
          const diff     = Math.abs(computed - stored);
          if (diff > 0.005) {
            ledgerDiscrepancies.push({
              id: row.id, contractId: row.contractId,
              year: row.year, month: row.month,
              module: row.module ?? "PROPERTIES",
              storedPaid: stored, computedPaid: computed, diff,
            });
          }
        }

        // ── 2. Guarantee deposit flag vs actual voucher ───────────────────
        const allContracts = await db
          .select({
            id:                         propertyContracts.id,
            module:                     propertyContracts.module,
            tenantName:                 propertyContracts.tenantName,
            unitId:                     propertyContracts.unitId,
            guaranteeAmount:            propertyContracts.guaranteeAmount,
            guaranteePostedToStatement: propertyContracts.guaranteePostedToStatement,
            guaranteePostedAmount:      propertyContracts.guaranteePostedAmount,
          })
          .from(propertyContracts)
          .where(eq(propertyContracts.companyId, companyId));

        const allUnits = await db
          .select({ id: propertyUnits.id, locationGroup: propertyUnits.locationGroup, unitNumber: propertyUnits.unitNumber })
          .from(propertyUnits)
          .where(eq(propertyUnits.companyId, companyId));
        const unitMap = new Map(allUnits.map(u => [u.id, `${u.locationGroup}/${u.unitNumber}`]));

        const guarVouchersRows = await db.execute(sql`
          SELECT voucher_number
          FROM vouchers
          WHERE company_id = ${companyId}
            AND deleted_at IS NULL
            AND voucher_number LIKE 'GUAR-%'
        `);

        const guarContractIds = new Set<number>();
        for (const row of (guarVouchersRows as any).rows ?? guarVouchersRows) {
          const vn: string = row.voucher_number ?? "";
          const parts = vn.split("-");
          const cid = parseInt(parts[parts.length - 1]);
          if (!isNaN(cid)) guarContractIds.add(cid);
        }

        const depositDiscrepancies: {
          contractId: number; tenantName: string; unitLabel: string; module: string;
          guaranteeAmount: number; flagValue: boolean; voucherExists: boolean;
          issue: "STALE_FLAG" | "MISSING_FLAG";
        }[] = [];

        for (const c of allContracts) {
          const gAmt   = parseFloat(c.guaranteeAmount ?? "0");
          const flagOn = c.guaranteePostedToStatement;
          const hasVouc = guarContractIds.has(c.id);

          if (flagOn && !hasVouc) {
            depositDiscrepancies.push({
              contractId:      c.id,
              tenantName:      c.tenantName,
              unitLabel:       unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module:          c.module,
              guaranteeAmount: parseFloat(c.guaranteePostedAmount ?? String(gAmt)),
              flagValue:       true,
              voucherExists:   false,
              issue:           "STALE_FLAG",
            });
          } else if (!flagOn && hasVouc && gAmt > 0) {
            depositDiscrepancies.push({
              contractId:      c.id,
              tenantName:      c.tenantName,
              unitLabel:       unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module:          c.module,
              guaranteeAmount: gAmt,
              flagValue:       false,
              voucherExists:   true,
              issue:           "MISSING_FLAG",
            });
          }
        }

        res.json({
          ledgerDiscrepancies,
          depositDiscrepancies,
          totalDiscrepancies: ledgerDiscrepancies.length + depositDiscrepancies.length,
        });
      } catch (err: any) {
        console.error("[BalanceRepair] scan error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/admin/repair-balances/apply ────────────────────────────────
  app.post(
    "/api/admin/repair-balances/apply",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId: number | undefined = req.session.currentCompanyId;
        if (!companyId)
          return res.status(400).json({ message: "No company selected" });

        // ── 1. Property monthly ledger ────────────────────────────────────
        const allLedger = await db.select().from(propertyMonthlyLedger).where(eq(propertyMonthlyLedger.companyId, companyId));
        const pmtSumsRows = await db.execute(sql`
          SELECT ledger_row_id, COALESCE(SUM(amount::numeric), 0) AS total_paid
          FROM property_payments
          WHERE company_id = ${companyId} AND ledger_row_id IS NOT NULL
          GROUP BY ledger_row_id
        `);
        const pmtMap = new Map<number, number>();
        for (const row of (pmtSumsRows as any).rows ?? pmtSumsRows) {
          pmtMap.set(Number(row.ledger_row_id), parseFloat(row.total_paid ?? "0"));
        }

        const ledgerSnapshots: {
          id: number; contractId: number; year: number; month: number;
          module: string; oldPaidAmount: number; newPaidAmount: number;
        }[] = [];

        for (const row of allLedger) {
          const computed = pmtMap.get(row.id) ?? 0;
          const stored   = parseFloat(row.paidAmount ?? "0");
          if (Math.abs(computed - stored) > 0.005) {
            ledgerSnapshots.push({
              id: row.id, contractId: row.contractId,
              year: row.year, month: row.month,
              module: row.module ?? "PROPERTIES",
              oldPaidAmount: stored, newPaidAmount: computed,
            });
            await db.update(propertyMonthlyLedger)
              .set({ paidAmount: computed.toFixed(2) })
              .where(eq(propertyMonthlyLedger.id, row.id));
          }
        }

        // ── 2. Guarantee deposit flags ────────────────────────────────────
        const allContracts = await db.select({
          id: propertyContracts.id, module: propertyContracts.module,
          tenantName: propertyContracts.tenantName, unitId: propertyContracts.unitId,
          guaranteeAmount: propertyContracts.guaranteeAmount,
          guaranteePostedToStatement: propertyContracts.guaranteePostedToStatement,
          guaranteePostedAmount: propertyContracts.guaranteePostedAmount,
        }).from(propertyContracts).where(eq(propertyContracts.companyId, companyId));

        const allUnits = await db.select({ id: propertyUnits.id, locationGroup: propertyUnits.locationGroup, unitNumber: propertyUnits.unitNumber })
          .from(propertyUnits).where(eq(propertyUnits.companyId, companyId));
        const unitMap = new Map(allUnits.map(u => [u.id, `${u.locationGroup}/${u.unitNumber}`]));

        const guarVouchersRows = await db.execute(sql`
          SELECT voucher_number FROM vouchers
          WHERE company_id = ${companyId} AND deleted_at IS NULL AND voucher_number LIKE 'GUAR-%'
        `);
        const guarContractIds = new Set<number>();
        for (const row of (guarVouchersRows as any).rows ?? guarVouchersRows) {
          const vn: string = row.voucher_number ?? "";
          const parts = vn.split("-");
          const cid = parseInt(parts[parts.length - 1]);
          if (!isNaN(cid)) guarContractIds.add(cid);
        }

        const depositSnapshots: {
          contractId: number; tenantName: string; unitLabel: string; module: string;
          guaranteeAmount: number;
          oldFlag: boolean; newFlag: boolean;
          oldPostedAmount: number; newPostedAmount: number;
          issue: "STALE_FLAG" | "MISSING_FLAG";
        }[] = [];

        for (const c of allContracts) {
          const gAmt    = parseFloat(c.guaranteeAmount ?? "0");
          const flagOn  = c.guaranteePostedToStatement;
          const hasVouc = guarContractIds.has(c.id);
          const oldPosted = parseFloat(c.guaranteePostedAmount ?? "0");

          if (flagOn && !hasVouc) {
            depositSnapshots.push({
              contractId: c.id, tenantName: c.tenantName,
              unitLabel: unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module: c.module, guaranteeAmount: gAmt,
              oldFlag: true, newFlag: false,
              oldPostedAmount: oldPosted, newPostedAmount: 0,
              issue: "STALE_FLAG",
            });
            await db.update(propertyContracts)
              .set({ guaranteePostedToStatement: false, guaranteePostedAmount: "0" })
              .where(eq(propertyContracts.id, c.id));
          } else if (!flagOn && hasVouc && gAmt > 0) {
            depositSnapshots.push({
              contractId: c.id, tenantName: c.tenantName,
              unitLabel: unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module: c.module, guaranteeAmount: gAmt,
              oldFlag: false, newFlag: true,
              oldPostedAmount: 0, newPostedAmount: gAmt,
              issue: "MISSING_FLAG",
            });
            await db.update(propertyContracts)
              .set({ guaranteePostedToStatement: true, guaranteePostedAmount: String(gAmt) })
              .where(eq(propertyContracts.id, c.id));
          }
        }

        res.json({
          ledgerRowsFixed: ledgerSnapshots.length,
          depositsFixed:   depositSnapshots.length,
          snapshot: { ledgerSnapshots, depositSnapshots },
        });
      } catch (err: any) {
        console.error("[BalanceRepair] apply error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/admin/repair-balances/undo ────────────────────────────────
  app.post(
    "/api/admin/repair-balances/undo",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const { snapshot } = req.body as {
          snapshot: {
            ledgerSnapshots:  { id: number; oldPaidAmount: number }[];
            depositSnapshots: { contractId: number; oldFlag: boolean; oldPostedAmount: number }[];
          };
        };
        if (!snapshot)
          return res.status(400).json({ message: "No snapshot provided" });

        for (const s of snapshot.ledgerSnapshots ?? []) {
          await db.update(propertyMonthlyLedger)
            .set({ paidAmount: s.oldPaidAmount.toFixed(2) })
            .where(eq(propertyMonthlyLedger.id, s.id));
        }

        for (const s of snapshot.depositSnapshots ?? []) {
          await db.update(propertyContracts)
            .set({
              guaranteePostedToStatement: s.oldFlag,
              guaranteePostedAmount:      s.oldPostedAmount.toFixed(2),
            })
            .where(eq(propertyContracts.id, s.contractId));
        }

        res.json({
          ledgerRowsRestored: (snapshot.ledgerSnapshots  ?? []).length,
          depositsRestored:   (snapshot.depositSnapshots ?? []).length,
        });
      } catch (err: any) {
        console.error("[BalanceRepair] undo error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
