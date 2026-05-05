import type { Express } from "express";
import { db } from "../db";
import { requireAuth, requireRole } from "../auth";
import {
  employees,
  propertyMonthlyLedger,
  propertyPayments,
  voucherEntries,
  vouchers,
} from "../../shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export function registerBalanceRepairRoutes(app: Express) {

  // ── GET /api/admin/repair-balances/scan ──────────────────────────────────
  // Dry-run: compute discrepancies for employee balances and property monthly
  // ledger paid amounts without writing anything.
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
          id: number;
          name: string;
          storedBalance: number;
          computedBalance: number;
          storedDeposits: number;
          computedDeposits: number;
          storedWithdrawals: number;
          computedWithdrawals: number;
          diff: number;
        }[] = [];

        for (const emp of allEmps) {
          const sums = empSumMap.get(emp.id) ?? { credits: 0, debits: 0 };
          const openingBal    = parseFloat(emp.openingBalance ?? "0");
          const computedBal   = openingBal + sums.credits - sums.debits;
          const storedBal     = parseFloat(emp.currentBalance   ?? "0");
          const storedDep     = parseFloat(emp.totalDeposits    ?? "0");
          const storedWith    = parseFloat(emp.totalWithdrawals ?? "0");
          const diff          = Math.abs(computedBal - storedBal);
          if (diff > 0.005) {
            employeeDiscrepancies.push({
              id:                 emp.id,
              name:               `${emp.firstName} ${emp.lastName}`.trim(),
              storedBalance:      storedBal,
              computedBalance:    computedBal,
              storedDeposits:     storedDep,
              computedDeposits:   sums.credits,
              storedWithdrawals:  storedWith,
              computedWithdrawals: sums.debits,
              diff,
            });
          }
        }

        // ── 2. Property monthly ledger ────────────────────────────────────
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
          id: number;
          contractId: number;
          year: number;
          month: number;
          storedPaid: number;
          computedPaid: number;
          diff: number;
        }[] = [];

        for (const row of allLedger) {
          const computed   = pmtMap.get(row.id) ?? 0;
          const stored     = parseFloat(row.paidAmount ?? "0");
          const diff       = Math.abs(computed - stored);
          if (diff > 0.005) {
            ledgerDiscrepancies.push({
              id:           row.id,
              contractId:   row.contractId,
              year:         row.year,
              month:        row.month,
              storedPaid:   stored,
              computedPaid: computed,
              diff,
            });
          }
        }

        res.json({
          employeeDiscrepancies,
          ledgerDiscrepancies,
          totalDiscrepancies: employeeDiscrepancies.length + ledgerDiscrepancies.length,
        });
      } catch (err: any) {
        console.error("[BalanceRepair] scan error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/admin/repair-balances/apply ────────────────────────────────
  // Apply all fixes and return a snapshot so the caller can undo.
  app.post(
    "/api/admin/repair-balances/apply",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const companyId: number | undefined = req.session.currentCompanyId;
        if (!companyId)
          return res.status(400).json({ message: "No company selected" });

        // ── 1. Employee balances (re-run same scan logic) ─────────────────
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

        const employeeSnapshots: {
          id: number;
          name: string;
          oldBalance: number;
          oldDeposits: number;
          oldWithdrawals: number;
          newBalance: number;
          newDeposits: number;
          newWithdrawals: number;
        }[] = [];

        for (const emp of allEmps) {
          const sums = empSumMap.get(emp.id) ?? { credits: 0, debits: 0 };
          const openingBal    = parseFloat(emp.openingBalance ?? "0");
          const computedBal   = openingBal + sums.credits - sums.debits;
          const storedBal     = parseFloat(emp.currentBalance   ?? "0");
          const diff          = Math.abs(computedBal - storedBal);
          if (diff > 0.005) {
            employeeSnapshots.push({
              id:            emp.id,
              name:          `${emp.firstName} ${emp.lastName}`.trim(),
              oldBalance:    storedBal,
              oldDeposits:   parseFloat(emp.totalDeposits    ?? "0"),
              oldWithdrawals: parseFloat(emp.totalWithdrawals ?? "0"),
              newBalance:    computedBal,
              newDeposits:   sums.credits,
              newWithdrawals: sums.debits,
            });
            await db.update(employees).set({
              currentBalance:   computedBal.toFixed(2),
              totalDeposits:    sums.credits.toFixed(2),
              totalWithdrawals: sums.debits.toFixed(2),
            }).where(eq(employees.id, emp.id));
          }
        }

        // ── 2. Property monthly ledger ─────────────────────────────────────
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

        const ledgerSnapshots: {
          id: number;
          contractId: number;
          year: number;
          month: number;
          oldPaidAmount: number;
          newPaidAmount: number;
        }[] = [];

        for (const row of allLedger) {
          const computed = pmtMap.get(row.id) ?? 0;
          const stored   = parseFloat(row.paidAmount ?? "0");
          const diff     = Math.abs(computed - stored);
          if (diff > 0.005) {
            ledgerSnapshots.push({
              id:            row.id,
              contractId:    row.contractId,
              year:          row.year,
              month:         row.month,
              oldPaidAmount: stored,
              newPaidAmount: computed,
            });
            await db.update(propertyMonthlyLedger)
              .set({ paidAmount: computed.toFixed(2) })
              .where(eq(propertyMonthlyLedger.id, row.id));
          }
        }

        res.json({
          employeesFixed:  employeeSnapshots.length,
          ledgerRowsFixed: ledgerSnapshots.length,
          snapshot: { employeeSnapshots, ledgerSnapshots },
        });
      } catch (err: any) {
        console.error("[BalanceRepair] apply error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST /api/admin/repair-balances/undo ────────────────────────────────
  // Restore a previously saved snapshot.
  app.post(
    "/api/admin/repair-balances/undo",
    requireAuth,
    requireRole("Admin"),
    async (req: any, res: any) => {
      try {
        const { snapshot } = req.body as {
          snapshot: {
            employeeSnapshots: {
              id: number;
              oldBalance: number;
              oldDeposits: number;
              oldWithdrawals: number;
            }[];
            ledgerSnapshots: {
              id: number;
              oldPaidAmount: number;
            }[];
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

        res.json({
          employeesRestored:  (snapshot.employeeSnapshots ?? []).length,
          ledgerRowsRestored: (snapshot.ledgerSnapshots   ?? []).length,
        });
      } catch (err: any) {
        console.error("[BalanceRepair] undo error:", err);
        res.status(500).json({ message: err.message });
      }
    },
  );
}
