import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  employees,
  propertyMonthlyLedger,
  propertyPayments,
  propertyContracts,
  propertyUnits,
  voucherEntries,
  vouchers,
} from "../../shared/schema";
import { eq, and, isNull, sql, isNotNull } from "drizzle-orm";

export function registerBalanceRepairRoutes(app: Express) {

  // ── GET /api/admin/repair-balances/scan ──────────────────────────────────
  // Dry-run: compute discrepancies without writing anything.
  // Covers:
  //   1. Employee currentBalance drift
  //   2. property_monthly_ledger paid_amount drift
  //   3. guarantee_posted_to_statement flag vs actual voucher existence
  app.get(
    "/api/admin/repair-balances/scan",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId: number | undefined = req.session.currentCompanyId;
        if (!companyId)
          return res.status(400).json({ message: "No company selected" });

        // ── 1. Employee balances ──────────────────────────────────────────
        const allEmps = await db
          .select()
          .from(employees)
          .where(
            and(
              eq(employees.companyId, companyId),
              eq(employees.employeeType, "Employee"),
              isNull(employees.deletedAt),
            ),
          );

        const empSumsRows = await db.execute(sql`
          SELECT
            ve.employee_id,
            COALESCE(SUM(ve.credit_amount::numeric), 0) AS total_credits,
            COALESCE(SUM(ve.debit_amount::numeric),  0) AS total_debits
          FROM voucher_entries ve
          INNER JOIN vouchers v ON v.id = ve.voucher_id
          INNER JOIN employees e ON e.id = ve.employee_id
          WHERE e.company_id  = ${companyId}
            AND e.employee_type = 'Employee'
            AND e.deleted_at   IS NULL
            AND v.deleted_at   IS NULL
          GROUP BY ve.employee_id
        `);

        const empSumMap = new Map<number, { credits: number; debits: number }>();
        for (const row of (empSumsRows as any).rows ?? empSumsRows) {
          empSumMap.set(Number(row.employee_id), {
            credits: parseFloat(row.total_credits ?? "0"),
            debits:  parseFloat(row.total_debits  ?? "0"),
          });
        }

        const employeeDiscrepancies: {
          id: number; name: string;
          storedBalance: number; computedBalance: number;
          storedDeposits: number; computedDeposits: number;
          storedWithdrawals: number; computedWithdrawals: number;
          diff: number;
        }[] = [];

        for (const emp of allEmps) {
          const sums        = empSumMap.get(emp.id) ?? { credits: 0, debits: 0 };
          const openingBal  = parseFloat(emp.openingBalance ?? "0");
          const computedBal = openingBal + sums.credits - sums.debits;
          const storedBal   = parseFloat(emp.currentBalance   ?? "0");
          const diff        = Math.abs(computedBal - storedBal);
          if (diff > 0.005) {
            employeeDiscrepancies.push({
              id: emp.id,
              name: `${emp.firstName} ${emp.lastName}`.trim(),
              storedBalance:       storedBal,
              computedBalance:     computedBal,
              storedDeposits:      parseFloat(emp.totalDeposits    ?? "0"),
              computedDeposits:    sums.credits,
              storedWithdrawals:   parseFloat(emp.totalWithdrawals ?? "0"),
              computedWithdrawals: sums.debits,
              diff,
            });
          }
        }

        // ── 2. Property monthly ledger paid_amount ────────────────────────
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

        // ── 3. Guarantee deposit flag vs actual voucher ───────────────────
        // A guarantee voucher is created with voucherNumber starting with
        // "GUAR-" and ending with "-{contractId}".
        const allContracts = await db
          .select({
            id:                       propertyContracts.id,
            companyId:                propertyContracts.companyId,
            module:                   propertyContracts.module,
            tenantName:               propertyContracts.tenantName,
            unitId:                   propertyContracts.unitId,
            guaranteeAmount:          propertyContracts.guaranteeAmount,
            guaranteePostedToStatement: propertyContracts.guaranteePostedToStatement,
            guaranteePostedAmount:    propertyContracts.guaranteePostedAmount,
          })
          .from(propertyContracts)
          .where(eq(propertyContracts.companyId, companyId));

        // Load unit labels
        const allUnits = await db.select({ id: propertyUnits.id, locationGroup: propertyUnits.locationGroup, unitNumber: propertyUnits.unitNumber })
          .from(propertyUnits)
          .where(eq(propertyUnits.companyId, companyId));
        const unitMap = new Map(allUnits.map(u => [u.id, `${u.locationGroup}/${u.unitNumber}`]));

        // Find all active guarantee vouchers for this company in one query
        const guarVouchersRows = await db.execute(sql`
          SELECT id, voucher_number
          FROM vouchers
          WHERE company_id = ${companyId}
            AND deleted_at IS NULL
            AND voucher_number LIKE 'GUAR-%'
        `);

        // Build set: contractId → voucher exists
        const guarContractIds = new Set<number>();
        for (const row of (guarVouchersRows as any).rows ?? guarVouchersRows) {
          const vn: string = row.voucher_number ?? "";
          const parts = vn.split("-");
          const lastPart = parts[parts.length - 1];
          const cid = parseInt(lastPart);
          if (!isNaN(cid)) guarContractIds.add(cid);
        }

        const depositDiscrepancies: {
          contractId: number;
          tenantName: string;
          unitLabel: string;
          module: string;
          guaranteeAmount: number;
          flagValue: boolean;
          voucherExists: boolean;
          issue: "STALE_FLAG" | "MISSING_FLAG";
        }[] = [];

        for (const c of allContracts) {
          const gAmt    = parseFloat(c.guaranteeAmount ?? "0");
          const flagOn  = c.guaranteePostedToStatement;
          const hasVouc = guarContractIds.has(c.id);

          if (flagOn && !hasVouc) {
            // Flag says "posted" but no voucher exists — stale
            depositDiscrepancies.push({
              contractId:     c.id,
              tenantName:     c.tenantName,
              unitLabel:      unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module:         c.module,
              guaranteeAmount: parseFloat(c.guaranteePostedAmount ?? String(gAmt)),
              flagValue:      true,
              voucherExists:  false,
              issue:          "STALE_FLAG",
            });
          } else if (!flagOn && hasVouc && gAmt > 0) {
            // Flag says "not posted" but a voucher exists — flag was never set
            depositDiscrepancies.push({
              contractId:     c.id,
              tenantName:     c.tenantName,
              unitLabel:      unitMap.get(c.unitId) ?? `Unit#${c.unitId}`,
              module:         c.module,
              guaranteeAmount: gAmt,
              flagValue:      false,
              voucherExists:  true,
              issue:          "MISSING_FLAG",
            });
          }
        }

        res.json({
          employeeDiscrepancies,
          ledgerDiscrepancies,
          depositDiscrepancies,
          totalDiscrepancies:
            employeeDiscrepancies.length +
            ledgerDiscrepancies.length +
            depositDiscrepancies.length,
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

        // ── 1. Employee balances ──────────────────────────────────────────
        const allEmps = await db
          .select()
          .from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), isNull(employees.deletedAt)));

        const empSumsRows = await db.execute(sql`
          SELECT ve.employee_id,
            COALESCE(SUM(ve.credit_amount::numeric), 0) AS total_credits,
            COALESCE(SUM(ve.debit_amount::numeric),  0) AS total_debits
          FROM voucher_entries ve
          INNER JOIN vouchers v ON v.id = ve.voucher_id
          INNER JOIN employees e ON e.id = ve.employee_id
          WHERE e.company_id = ${companyId} AND e.employee_type = 'Employee'
            AND e.deleted_at IS NULL AND v.deleted_at IS NULL
          GROUP BY ve.employee_id
        `);
        const empSumMap = new Map<number, { credits: number; debits: number }>();
        for (const row of (empSumsRows as any).rows ?? empSumsRows) {
          empSumMap.set(Number(row.employee_id), { credits: parseFloat(row.total_credits ?? "0"), debits: parseFloat(row.total_debits ?? "0") });
        }

        const employeeSnapshots: {
          id: number; name: string;
          oldBalance: number; oldDeposits: number; oldWithdrawals: number;
          newBalance: number; newDeposits: number; newWithdrawals: number;
        }[] = [];

        for (const emp of allEmps) {
          const sums        = empSumMap.get(emp.id) ?? { credits: 0, debits: 0 };
          const openingBal  = parseFloat(emp.openingBalance ?? "0");
          const computedBal = openingBal + sums.credits - sums.debits;
          const storedBal   = parseFloat(emp.currentBalance ?? "0");
          if (Math.abs(computedBal - storedBal) > 0.005) {
            employeeSnapshots.push({
              id: emp.id, name: `${emp.firstName} ${emp.lastName}`.trim(),
              oldBalance:     storedBal,
              oldDeposits:    parseFloat(emp.totalDeposits    ?? "0"),
              oldWithdrawals: parseFloat(emp.totalWithdrawals ?? "0"),
              newBalance:     computedBal,
              newDeposits:    sums.credits,
              newWithdrawals: sums.debits,
            });
            await db.update(employees).set({
              currentBalance:   computedBal.toFixed(2),
              totalDeposits:    sums.credits.toFixed(2),
              totalWithdrawals: sums.debits.toFixed(2),
            }).where(eq(employees.id, emp.id));
          }
        }

        // ── 2. Property monthly ledger ────────────────────────────────────
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

        // ── 3. Guarantee deposit flags ────────────────────────────────────
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
          SELECT id, voucher_number FROM vouchers
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
          const gAmt   = parseFloat(c.guaranteeAmount ?? "0");
          const flagOn = c.guaranteePostedToStatement;
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
          employeesFixed:  employeeSnapshots.length,
          ledgerRowsFixed: ledgerSnapshots.length,
          depositsFixed:   depositSnapshots.length,
          snapshot: { employeeSnapshots, ledgerSnapshots, depositSnapshots },
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
            employeeSnapshots: { id: number; oldBalance: number; oldDeposits: number; oldWithdrawals: number }[];
            ledgerSnapshots:   { id: number; oldPaidAmount: number }[];
            depositSnapshots:  { contractId: number; oldFlag: boolean; oldPostedAmount: number }[];
          };
        };
        if (!snapshot)
          return res.status(400).json({ message: "No snapshot provided" });

        for (const s of snapshot.employeeSnapshots ?? []) {
          await db.update(employees).set({
            currentBalance:   s.oldBalance.toFixed(2),
            totalDeposits:    s.oldDeposits.toFixed(2),
            totalWithdrawals: s.oldWithdrawals.toFixed(2),
          }).where(eq(employees.id, s.id));
        }

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
          employeesRestored:  (snapshot.employeeSnapshots ?? []).length,
          ledgerRowsRestored: (snapshot.ledgerSnapshots   ?? []).length,
          depositsRestored:   (snapshot.depositSnapshots  ?? []).length,
        });
      } catch (err: any) {
        console.error("[BalanceRepair] undo error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
