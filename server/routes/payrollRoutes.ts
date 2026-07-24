/**
 * Payroll routes.
 *
 * Employee/worker deposits, bonuses, withdrawals, payments, and payroll-run
 * lifecycle (create/list/update/delete/undo/diagnostic/migrate) plus payroll
 * summaries. Extracted from employeeRoutes.ts as a sub-registrar; behaviour is
 * unchanged.
 */
import type { Express } from "express";
import { logger } from "../lib/logger";
import { eq, and, desc, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireNonPOS } from "../auth";
import { syncEmployeeBalancesFromEntries } from "./_helpers";
import { triggerAccountWhatsAppStatement } from "./factoryWhatsappRoutes";
import {
  bankAccounts,
  employeeGroupMembers,
  employeeGroups,
  employees,
  erpPayrollRunItems,
  erpPayrollRuns,
  locations,
  salaryAdvanceDeductions,
  salaryAdvances,
  salesItems,
  voucherEntries,
  vouchers,
} from "@shared/schema";

export function registerPayrollRoutes(app: Express) {
  // Payroll - Employee Balance Deposit
  app.post("/api/payroll/deposit-employee", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, date, notes } = req.body;

      if (!employeeId || !amount || !date) {
        return res.status(400).json({ message: "Employee, amount, and date are required" });
      }

      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Look up the employee's group for per-group salary expense splitting
      const depGroupRows = await db
        .select({ groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(
          and(
            eq(employeeGroupMembers.employeeId, employee.id),
            eq(employeeGroups.companyId, req.session.currentCompanyId!),
            eq(employeeGroups.active, true)
          )
        )
        .limit(1);
      const depGrp = depGroupRows[0]?.groupName?.trim() || "__default__";
      const depIsDefault = depGrp === "__default__";
      const depExpCode = depIsDefault
        ? "SALARY_EXPENSE"
        : `SAL_EXP_${depGrp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
      const depExpName = depIsDefault ? "Salary Expense" : `Salary Expense - ${depGrp}`;

      const allDepAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let depSalaryAccount = allDepAccounts.find((a: any) => a.code === depExpCode);
      if (!depSalaryAccount) {
        depSalaryAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: depExpCode,
          name: depExpName,
          accountType: "Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher
      const voucherNumber = `SAL-DEP-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Salary deposit for ${employee.firstName} ${employee.lastName}`,
          totalAmount: depositAmount.toFixed(2),
        })
        .returning();

      // Create voucher entries (double-entry)
      // Debit: Salary Expense - {Group} (or Salary Expense for ungrouped)
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: depSalaryAccount.id,
        debitAmount: depositAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary deposit - ${voucherNumber}`,
      });

      // Credit: Employee (using employeeId field directly instead of separate ledger account)
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: employee.id,
        debitAmount: "0",
        creditAmount: depositAmount.toFixed(2),
        narration: `Salary deposit - ${voucherNumber}`,
      });

      // Sync employee balance from voucher entries (instead of direct update)
      // This ensures consistent behavior with voucher edit/delete operations
      await syncEmployeeBalancesFromEntries(
        [
          {
            ledgerAccountId: null,
            employeeId: employee.id,
            debitAmount: "0",
            creditAmount: depositAmount.toFixed(2),
          },
        ],
        req.session.currentCompanyId!
      );

      // Get updated employee balance after sync
      const [updatedDepositEmployee] = await db.select().from(employees).where(eq(employees.id, employeeId));

      res.json({
        voucher,
        employee: updatedDepositEmployee || employee,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Bulk Employee Salary Deposit
  app.post("/api/payroll/bulk-deposit-employees", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { deposits, date, notes } = req.body;

      if (!deposits || !Array.isArray(deposits) || deposits.length === 0) {
        return res.status(400).json({ message: "No deposits provided" });
      }

      if (!date) {
        return res.status(400).json({ message: "Date is required" });
      }

      // Validate all deposit amounts
      for (const deposit of deposits) {
        const amount = parseFloat(deposit.amount);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            message: "All deposit amounts must be positive numbers",
          });
        }
      }

      // Build group-membership lookup: employeeId → groupName
      const bulkDepGroupMemberships = await db
        .select({ employeeId: employeeGroupMembers.employeeId, groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(and(eq(employeeGroups.companyId, req.session.currentCompanyId!), eq(employeeGroups.active, true)));
      const bulkDepEmpGroupMap = new Map<number, string>();
      for (const row of bulkDepGroupMemberships) {
        if (!bulkDepEmpGroupMap.has(row.employeeId)) bulkDepEmpGroupMap.set(row.employeeId, row.groupName);
      }

      // Calculate total amount
      const totalAmount = deposits.reduce((sum: number, d: any) => sum + parseFloat(d.amount), 0);

      // Create single voucher for all deposits
      const voucherNumber = `SAL-DEP-BULK-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Bulk salary deposit for ${deposits.length} employees`,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      // Group deposits by employee group and create one debit per group
      const bulkDepByGroup = new Map<string, number>();
      for (const d of deposits) {
        const grp = (bulkDepEmpGroupMap.get(d.employeeId) || "").trim() || "__default__";
        bulkDepByGroup.set(grp, (bulkDepByGroup.get(grp) || 0) + parseFloat(d.amount));
      }
      const bulkDepFreshAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      for (const [grp, grpTotal] of bulkDepByGroup) {
        const isDefault = grp === "__default__";
        const expCode = isDefault
          ? "SALARY_EXPENSE"
          : `SAL_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
        const expName = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;
        let expAccount = bulkDepFreshAccounts.find((a: any) => a.code === expCode);
        if (!expAccount) {
          expAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId!,
            code: expCode,
            name: expName,
            accountType: "Expense",
            openingBalance: "0",
            active: true,
          });
        }
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: expAccount.id,
          debitAmount: grpTotal.toFixed(2),
          creditAmount: "0",
          narration: isDefault
            ? `Bulk salary deposit - ${deposits.length} employees - ${voucherNumber}`
            : `Salary expense - ${grp} - ${voucherNumber}`,
        });
      }

      // Process each employee deposit
      const results = [];
      for (const deposit of deposits) {
        const [employee] = await db.select().from(employees).where(eq(employees.id, deposit.employeeId));

        if (!employee) {
          continue; // Skip if employee not found
        }

        // Verify employee belongs to current company
        if (employee.companyId !== req.session.currentCompanyId) {
          continue;
        }

        const depositAmount = parseFloat(deposit.amount);

        // Credit employee (using employeeId field directly instead of separate ledger account)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: null,
          employeeId: employee.id,
          debitAmount: "0",
          creditAmount: depositAmount.toFixed(2),
          narration: `Salary deposit for ${employee.firstName} ${employee.lastName} - ${voucherNumber}`,
        });

        results.push({
          employeeId: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          amount: depositAmount,
        });
      }

      // Sync all employee balances from voucher entries
      const allDepositEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));

      await syncEmployeeBalancesFromEntries(
        allDepositEntries.map((e) => ({
          ledgerAccountId: e.ledgerAccountId,
          employeeId: e.employeeId,
          debitAmount: e.debitAmount,
          creditAmount: e.creditAmount,
        })),
        req.session.currentCompanyId!
      );

      // Get updated balances for all employees
      const updatedResults = [];
      for (const result of results) {
        const [updatedEmp] = await db.select().from(employees).where(eq(employees.id, result.employeeId));
        updatedResults.push({
          ...result,
          newBalance: updatedEmp ? parseFloat(updatedEmp.currentBalance) : 0,
        });
      }

      res.json({
        voucher,
        deposits: updatedResults,
        totalAmount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Bulk Employee Bonus Deposit
  app.post("/api/payroll/bulk-bonus-employees", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { bonuses, date, notes } = req.body;

      if (!bonuses || !Array.isArray(bonuses) || bonuses.length === 0) {
        return res.status(400).json({ message: "No bonuses provided" });
      }

      if (!date) {
        return res.status(400).json({ message: "Date is required" });
      }

      // Filter out empty/zero amounts and validate
      const validBonuses = bonuses.filter((b: any) => {
        const amount = parseFloat(b.amount);
        return !isNaN(amount) && amount > 0;
      });

      if (validBonuses.length === 0) {
        return res.status(400).json({ message: "No valid bonus amounts provided" });
      }

      // Build group-membership lookup: employeeId → groupName
      const bonusGroupMemberships = await db
        .select({ employeeId: employeeGroupMembers.employeeId, groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(and(eq(employeeGroups.companyId, req.session.currentCompanyId!), eq(employeeGroups.active, true)));
      const bonusEmpGroupMap = new Map<number, string>();
      for (const row of bonusGroupMemberships) {
        if (!bonusEmpGroupMap.has(row.employeeId)) bonusEmpGroupMap.set(row.employeeId, row.groupName);
      }

      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);

      // Calculate total amount
      const totalAmount = validBonuses.reduce((sum: number, b: any) => sum + parseFloat(b.amount), 0);

      // Create single voucher for all bonuses
      const voucherNumber = `BONUS-BULK-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Bulk bonus deposit for ${validBonuses.length} employees`,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      // Group bonuses by worker group and create one debit entry per group
      const bonusByGroup = new Map<string, number>();
      for (const b of validBonuses) {
        const grp = (bonusEmpGroupMap.get(b.employeeId) || "").trim() || "__default__";
        bonusByGroup.set(grp, (bonusByGroup.get(grp) || 0) + parseFloat(b.amount));
      }
      const freshAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      for (const [grp, grpTotal] of bonusByGroup) {
        const isDefault = grp === "__default__";
        const bonusCode = isDefault
          ? "BONUS_EXPENSE"
          : `BONUS_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
        const bonusName = isDefault ? "Bonus Expense" : `Bonus Expense - ${grp}`;
        let bonusAccount = freshAccounts.find((a: any) => a.code === bonusCode);
        if (!bonusAccount) {
          bonusAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId!,
            code: bonusCode,
            name: bonusName,
            accountType: "Indirect Expense",
            openingBalance: "0",
            active: true,
          });
        }
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: bonusAccount.id,
          debitAmount: grpTotal.toFixed(2),
          creditAmount: "0",
          narration: isDefault
            ? `Bulk bonus deposit - ${validBonuses.length} employees - ${voucherNumber}`
            : `Bonus expense - ${grp} - ${voucherNumber}`,
        });
      }

      // Process each employee bonus
      const results = [];
      for (const bonus of validBonuses) {
        const [employee] = await db.select().from(employees).where(eq(employees.id, bonus.employeeId));

        if (!employee) {
          continue; // Skip if employee not found
        }

        // Verify employee belongs to current company
        if (employee.companyId !== req.session.currentCompanyId) {
          continue;
        }

        const bonusAmount = parseFloat(bonus.amount);

        // Credit employee (using employeeId field directly instead of separate ledger account)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: null,
          employeeId: employee.id,
          debitAmount: "0",
          creditAmount: bonusAmount.toFixed(2),
          narration: `Bonus for ${employee.firstName} ${employee.lastName} - ${voucherNumber}`,
        });

        results.push({
          employeeId: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          amount: bonusAmount,
        });
      }

      // Sync all employee balances from voucher entries
      const allBonusEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));

      await syncEmployeeBalancesFromEntries(
        allBonusEntries.map((e) => ({
          ledgerAccountId: e.ledgerAccountId,
          employeeId: e.employeeId,
          debitAmount: e.debitAmount,
          creditAmount: e.creditAmount,
        })),
        req.session.currentCompanyId!
      );

      // Get updated balances for all employees
      const updatedBonusResults = [];
      for (const result of results) {
        const [updatedEmp] = await db.select().from(employees).where(eq(employees.id, result.employeeId));
        updatedBonusResults.push({
          ...result,
          newBalance: updatedEmp ? parseFloat(updatedEmp.currentBalance) : 0,
        });
      }

      res.json({
        voucher,
        bonuses: updatedBonusResults,
        totalAmount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Bulk Employee Withdrawal
  app.post("/api/payroll/bulk-withdraw-employees", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { withdrawals, date, notes, paymentAccountType, paymentAccountId } = req.body;

      if (!withdrawals || !Array.isArray(withdrawals) || withdrawals.length === 0) {
        return res.status(400).json({ message: "No withdrawals provided" });
      }

      if (!date || !paymentAccountType || !paymentAccountId) {
        return res.status(400).json({ message: "Date, account type, and account are required" });
      }

      // Filter out empty/zero amounts and validate
      const validWithdrawals = withdrawals.filter((w: any) => {
        const amount = parseFloat(w.amount);
        return !isNaN(amount) && amount > 0;
      });

      if (validWithdrawals.length === 0) {
        return res.status(400).json({ message: "No valid withdrawal amounts provided" });
      }

      // Calculate total amount
      const totalAmount = validWithdrawals.reduce((sum: number, w: any) => sum + parseFloat(w.amount), 0);

      // Get payment account (bank or cash)
      let paymentAccount;
      if (paymentAccountType === "bank") {
        [paymentAccount] = await db
          .select()
          .from(bankAccounts)
          .where(eq(bankAccounts.id, parseInt(paymentAccountId)));
      } else {
        const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
        paymentAccount = allAccounts.find((a: any) => a.id === parseInt(paymentAccountId));
      }

      if (!paymentAccount) {
        return res.status(404).json({ message: "Payment account not found" });
      }

      // Create single voucher for all withdrawals
      const voucherNumber = `WD-BULK-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Bulk withdrawal for ${validWithdrawals.length} employees`,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      // Create CREDIT entry for payment account (cash going OUT for withdrawal)
      const paymentAccountId_num = parseInt(paymentAccountId);
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let paymentLedgerAccount;

      if (paymentAccountType === "bank") {
        // For bank accounts, find the corresponding ledger account
        paymentLedgerAccount = allAccounts.find((a: any) => a.bankAccountId === paymentAccountId_num);
        if (!paymentLedgerAccount) {
          return res.status(404).json({ message: "Ledger account for bank account not found" });
        }
      } else {
        // For cash accounts (ledger accounts), find directly
        paymentLedgerAccount = allAccounts.find((a: any) => a.id === paymentAccountId_num);
        if (!paymentLedgerAccount) {
          return res.status(404).json({ message: "Cash account not found" });
        }
      }

      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: paymentLedgerAccount.id,
        debitAmount: "0",
        creditAmount: totalAmount.toFixed(2),
        narration: `Bulk withdrawal - ${validWithdrawals.length} employees - ${voucherNumber}`,
      });

      // Process each employee withdrawal
      const results = [];
      for (const withdrawal of validWithdrawals) {
        const [employee] = await db.select().from(employees).where(eq(employees.id, withdrawal.employeeId));

        if (!employee) continue;
        if (employee.companyId !== req.session.currentCompanyId) continue;

        const withdrawAmount = parseFloat(withdrawal.amount);

        // Debit employee (using employeeId field directly instead of separate ledger account)
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: null,
          employeeId: employee.id,
          debitAmount: withdrawAmount.toFixed(2),
          creditAmount: "0",
          narration: `Withdrawal for ${employee.firstName} ${employee.lastName} - ${voucherNumber}`,
        });

        results.push({
          employeeId: employee.id,
          name: `${employee.firstName} ${employee.lastName}`,
          amount: withdrawAmount,
        });
      }

      // Sync all employee balances from voucher entries
      const allWithdrawEntries = await db.select().from(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));

      await syncEmployeeBalancesFromEntries(
        allWithdrawEntries.map((e) => ({
          ledgerAccountId: e.ledgerAccountId,
          employeeId: e.employeeId,
          debitAmount: e.debitAmount,
          creditAmount: e.creditAmount,
        })),
        req.session.currentCompanyId!
      );

      // Get updated balances for all employees
      const updatedWithdrawResults = [];
      for (const result of results) {
        const [updatedEmp] = await db.select().from(employees).where(eq(employees.id, result.employeeId));
        updatedWithdrawResults.push({
          ...result,
          newBalance: updatedEmp ? parseFloat(updatedEmp.currentBalance) : 0,
        });
      }

      res.json({
        voucher,
        withdrawals: updatedWithdrawResults,
        totalAmount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Sales Summary for bonus calculation
  app.get("/api/payroll/sales-summary", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const sessionCompanyId = req.session.currentCompanyId;
      if (!sessionCompanyId) return res.status(400).json({ message: "No company selected" });
      const { locationId, startDate, endDate, sourceCompanyId } = req.query;
      if (!locationId || !startDate || !endDate) {
        return res.status(400).json({ message: "locationId, startDate, and endDate are required" });
      }
      const locId = parseInt(locationId as string);
      // Allow querying another company's sales if sourceCompanyId is provided
      const companyId = sourceCompanyId ? parseInt(sourceCompanyId as string) : sessionCompanyId;
      const conditions = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.locationId, locId),
        eq(vouchers.voucherType, "Sales"),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
        eq(vouchers.isCreditSale, false),
        sql`${vouchers.voucherDate} >= ${startDate}`,
        sql`${vouchers.voucherDate} <= ${endDate}`,
      ];
      const result = await db
        .select({
          totalSalesAmount: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`,
          totalQuantity: sql<string>`COALESCE(SUM(${salesItems.quantity}), 0)`,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...conditions));
      const loc = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, locId)).limit(1);
      return res.json({
        totalSalesAmount: result[0]?.totalSalesAmount ?? "0",
        totalQuantity: result[0]?.totalQuantity ?? "0",
        locationName: loc[0]?.name ?? "",
      });
    } catch (error: any) {
      logger.error("[/api/payroll/sales-summary]", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Auto-calculate bonuses server-side (single call instead of N×M client fetches)
  app.post("/api/payroll/auto-calculate-bonuses", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate, pctLocationId } = req.body;
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required" });

      // Fetch all active employees
      const allEmployees = await storage.getAllEmployees(companyId);
      const activeEmployees = allEmployees.filter((e: any) => e.status !== "inactive");

      // Cache sales queries by "companyId|locationId"
      const salesCache = new Map<string, { totalQuantity: string; totalSalesAmount: string; locationName: string }>();
      const querySales = async (locId: number, srcCompanyId: number) => {
        const cacheKey = `${srcCompanyId}|${locId}`;
        if (salesCache.has(cacheKey)) return salesCache.get(cacheKey)!;
        const conds = [
          eq(vouchers.companyId, srcCompanyId),
          eq(vouchers.locationId, locId),
          eq(vouchers.voucherType, "Sales"),
          isNull(vouchers.deletedAt),
          eq(vouchers.optional, false),
          eq(vouchers.isCreditSale, false),
          sql`${vouchers.voucherDate} >= ${startDate}`,
          sql`${vouchers.voucherDate} <= ${endDate}`,
        ];
        const [result] = await db
          .select({
            totalSalesAmount: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`,
            totalQuantity: sql<string>`COALESCE(SUM(${salesItems.quantity}), 0)`,
          })
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .where(and(...conds));
        const [loc] = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, locId)).limit(1);
        const entry = {
          totalQuantity: result?.totalQuantity ?? "0",
          totalSalesAmount: result?.totalSalesAmount ?? "0",
          locationName: loc?.name ?? "",
        };
        salesCache.set(cacheKey, entry);
        return entry;
      };

      // Prefetch pct location if provided
      let pctSales: { totalSalesAmount: string; locationName: string } | null = null;
      if (pctLocationId) {
        try {
          // Determine company for the pct location
          const [locRow] = await db
            .select({ companyId: locations.companyId })
            .from(locations)
            .where(eq(locations.id, parseInt(pctLocationId)))
            .limit(1);
          const pctCompanyId = locRow?.companyId ?? companyId;
          pctSales = await querySales(parseInt(pctLocationId), pctCompanyId);
        } catch {}
      }

      const results: Array<{ employeeId: number; amount: string; breakdown: string[] }> = [];

      for (const emp of activeEmployees) {
        const lines: string[] = [];
        let total = 0;

        // Per-location bale rates (employee_bale_rates table) — flat $/bale
        const baleRates = await storage.getEmployeeBaleRates(emp.id, companyId);
        for (const entry of baleRates) {
          const rate = parseFloat(entry.rate as string);
          if (!rate || rate <= 0 || !entry.locationId) continue;
          try {
            const srcId = (entry.sourceCompanyId as number | null) ?? companyId;
            const data = await querySales(entry.locationId as number, srcId);
            const qty = parseFloat(data.totalQuantity);
            if (qty > 0) {
              const sub = qty * rate;
              total += sub;
              lines.push(`${qty} bales × $${rate} (${data.locationName}) = $${sub.toFixed(2)}`);
            }
          } catch {}
        }

        // Per-location sales % rates (employee_bale_pct_rates table) — % of sales amount
        const balePctRates = await storage.getEmployeeBalePctRates(emp.id, companyId);
        for (const entry of balePctRates) {
          const pct = parseFloat(entry.pct as string);
          if (!pct || pct <= 0 || !entry.locationId) continue;
          try {
            const srcId = (entry.sourceCompanyId as number | null) ?? companyId;
            const data = await querySales(entry.locationId as number, srcId);
            const sales = parseFloat(data.totalSalesAmount);
            if (sales > 0) {
              const sub = (sales * pct) / 100;
              total += sub;
              lines.push(`$${sales.toFixed(2)} sales × ${pct}% (${data.locationName}) = $${sub.toFixed(2)}`);
            }
          } catch {}
        }

        // Legacy single bale rate field — only if no per-location rates
        if (baleRates.length === 0 && emp.balesBonusRate != null && parseFloat(emp.balesBonusRate as string) > 0) {
          const locId = emp.salesBonusPctLocationId as number | null;
          const srcId = (emp.salesBonusPctSourceCompanyId as number | null) ?? companyId;
          if (locId) {
            try {
              const data = await querySales(locId, srcId);
              const qty = parseFloat(data.totalQuantity);
              const rate = parseFloat(emp.balesBonusRate as string);
              if (qty > 0) {
                const sub = qty * rate;
                total += sub;
                lines.push(`${qty} bales × $${rate} (${data.locationName}) = $${sub.toFixed(2)}`);
              }
            } catch {}
          }
        }

        // Legacy single-location sales % bonus (emp.salesBonusPct + pctLocationId from UI dropdown)
        if (pctSales && emp.salesBonusPct != null && parseFloat(emp.salesBonusPct as string) > 0) {
          const sales = parseFloat(pctSales.totalSalesAmount);
          const pct = parseFloat(emp.salesBonusPct as string);
          if (sales > 0) {
            const sub = (sales * pct) / 100;
            total += sub;
            lines.push(`$${sales.toFixed(2)} sales × ${pct}% (${pctSales.locationName}) = $${sub.toFixed(2)}`);
          }
        }

        if (total > 0) {
          results.push({ employeeId: emp.id, amount: total.toFixed(2), breakdown: lines });
        }
      }

      return res.json({ results });
    } catch (error: any) {
      logger.error("[/api/payroll/auto-calculate-bonuses]", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Employee Bonus
  app.post("/api/payroll/bonus-employee", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, date, notes } = req.body;

      if (!employeeId || !amount || !date) {
        return res.status(400).json({ message: "Employee, amount, and date are required" });
      }

      const bonusAmount = parseFloat(amount);
      if (isNaN(bonusAmount) || bonusAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      // Look up the employee's group for per-group bonus expense splitting
      const bonusDepGroupRows = await db
        .select({ groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(
          and(
            eq(employeeGroupMembers.employeeId, employee.id),
            eq(employeeGroups.companyId, req.session.currentCompanyId!),
            eq(employeeGroups.active, true)
          )
        )
        .limit(1);
      const bonusSingleGrp = bonusDepGroupRows[0]?.groupName?.trim() || "__default__";
      const bonusSingleIsDefault = bonusSingleGrp === "__default__";
      const bonusSingleCode = bonusSingleIsDefault
        ? "BONUS_EXPENSE"
        : `BONUS_EXP_${bonusSingleGrp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
      const bonusSingleName = bonusSingleIsDefault ? "Bonus Expense" : `Bonus Expense - ${bonusSingleGrp}`;

      const bonusSingleAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let bonusSingleAccount = bonusSingleAccounts.find((a: any) => a.code === bonusSingleCode);
      if (!bonusSingleAccount) {
        bonusSingleAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId!,
          code: bonusSingleCode,
          name: bonusSingleName,
          accountType: "Indirect Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher
      const voucherNumber = `BONUS-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Bonus for ${employee.firstName} ${employee.lastName}`,
          totalAmount: bonusAmount.toFixed(2),
        })
        .returning();

      // Create voucher entries (double-entry)
      // Debit: Bonus Expense - {Group} (or Bonus Expense for ungrouped)
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: bonusSingleAccount.id,
        debitAmount: bonusAmount.toFixed(2),
        creditAmount: "0",
        narration: `Bonus payment - ${voucherNumber}`,
      });

      // Credit: Employee (using employeeId field directly instead of separate ledger account)
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: employee.id,
        debitAmount: "0",
        creditAmount: bonusAmount.toFixed(2),
        narration: `Bonus payment - ${voucherNumber}`,
      });

      // Sync employee balance from voucher entries (instead of direct update)
      await syncEmployeeBalancesFromEntries(
        [
          {
            ledgerAccountId: null,
            employeeId: employee.id,
            debitAmount: "0",
            creditAmount: bonusAmount.toFixed(2),
          },
        ],
        req.session.currentCompanyId!
      );

      // Get updated employee balance
      const [updatedBonusEmployee] = await db.select().from(employees).where(eq(employees.id, employeeId));

      res.json({
        voucher,
        employee: updatedBonusEmployee || employee,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Employee Withdrawal
  app.post("/api/payroll/withdraw-employee", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, paymentAccountType, paymentAccountId, bankAccountId, date, notes } = req.body;

      // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || bankAccountId;

      if (!employeeId || !amount || !accountId || !date) {
        return res.status(400).json({
          message: "Employee, amount, payment account, and date are required",
        });
      }

      const withdrawalAmount = parseFloat(amount);
      if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const currentBalance = parseFloat(employee.currentBalance);

      // Create voucher
      const voucherNumber = `SAL-WD-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate: date,
          description: notes || `Salary withdrawal for ${employee.firstName} ${employee.lastName}`,
          totalAmount: withdrawalAmount.toFixed(2),
        })
        .returning();

      // Create voucher entries (double-entry)
      // Debit: Employee (using employeeId field directly instead of separate ledger account)
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: employee.id,
        debitAmount: withdrawalAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary withdrawal - ${voucherNumber}`,
      });

      // Credit: Bank/Cash Account
      const creditEntry: any = {
        voucherId: voucher.id,
        debitAmount: "0",
        creditAmount: withdrawalAmount.toFixed(2),
        narration: `Salary withdrawal - ${voucherNumber}`,
      };

      if (accountType === "cash") {
        creditEntry.ledgerAccountId = accountId;
      } else {
        creditEntry.bankAccountId = accountId;
      }

      await db.insert(voucherEntries).values(creditEntry);

      // Sync employee balance from voucher entries (instead of direct update)
      await syncEmployeeBalancesFromEntries(
        [
          {
            ledgerAccountId: null,
            employeeId: employee.id,
            debitAmount: withdrawalAmount.toFixed(2),
            creditAmount: "0",
          },
        ],
        req.session.currentCompanyId!
      );

      // Get updated employee balance
      const [updatedEmployee] = await db.select().from(employees).where(eq(employees.id, employeeId));

      res.json({
        voucher,
        employee: updatedEmployee || employee,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Worker Direct Payment
  app.post("/api/payroll/pay-worker", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { employeeId, amount, bankAccountId, date, notes } = req.body;

      if (!employeeId || !amount || !bankAccountId || !date) {
        return res.status(400).json({
          message: "Employee, amount, bank account, and date are required",
        });
      }

      const paymentAmount = parseFloat(amount);
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }

      // Get employee/worker
      const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
      if (!employee) {
        return res.status(404).json({ message: "Worker not found" });
      }

      // Get or create SALARY_EXPENSE ledger account
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      let salaryExpenseAccount = allAccounts.find((a: any) => a.code === "SALARY_EXPENSE");

      if (!salaryExpenseAccount) {
        salaryExpenseAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: "SALARY_EXPENSE",
          name: "Salary Expense",
          accountType: "Expense",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher
      const voucherNumber = `SAL-PAY-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate: date,
          description: notes || `Salary payment for ${employee.firstName} ${employee.lastName}`,
          totalAmount: paymentAmount.toFixed(2),
        })
        .returning();

      // Create voucher entries (double-entry)
      // Debit: Salary Expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: salaryExpenseAccount.id,
        debitAmount: paymentAmount.toFixed(2),
        creditAmount: "0",
        narration: `Salary payment - ${voucherNumber}`,
      });

      // Credit: Bank/Cash Account
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        bankAccountId,
        debitAmount: "0",
        creditAmount: paymentAmount.toFixed(2),
        narration: `Salary payment - ${voucherNumber}`,
      });

      res.json({
        voucher,
        employee,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Payroll - Bulk Worker Payment
  app.post("/api/payroll/bulk-pay-workers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { payments, paymentAccountType, paymentAccountId, bankAccountId, date, notes } = req.body;

      // Support both old (bankAccountId) and new (paymentAccountType/paymentAccountId) parameters
      const accountType = paymentAccountType || "bank";
      const accountId = paymentAccountId || bankAccountId;

      if (!payments || !Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ message: "No payments provided" });
      }

      if (!accountId || !date) {
        return res.status(400).json({ message: "Payment account and date are required" });
      }

      // Validate all payment amounts
      for (const payment of payments) {
        const amount = parseFloat(payment.amount);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            message: "All payment amounts must be positive numbers",
          });
        }
      }

      // Build group-membership lookup: employeeId → groupName
      const bulkPayGroupMemberships = await db
        .select({ employeeId: employeeGroupMembers.employeeId, groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(and(eq(employeeGroups.companyId, req.session.currentCompanyId!), eq(employeeGroups.active, true)));
      const bulkPayEmpGroupMap = new Map<number, string>();
      for (const row of bulkPayGroupMemberships) {
        if (!bulkPayEmpGroupMap.has(row.employeeId)) bulkPayEmpGroupMap.set(row.employeeId, row.groupName);
      }

      // Calculate total amount
      const totalAmount = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);

      // Create single voucher for all payments
      const voucherNumber = `SAL-BULK-${Date.now()}`;
      const [voucher] = await db
        .insert(vouchers)
        .values({
          companyId: req.session.currentCompanyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate: date,
          description: notes || `Bulk salary payment for ${payments.length} workers`,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      // Group payments by employee group and create one debit per group
      const bulkPayByGroup = new Map<string, number>();
      for (const p of payments) {
        const grp = (bulkPayEmpGroupMap.get(p.employeeId) || "").trim() || "__default__";
        bulkPayByGroup.set(grp, (bulkPayByGroup.get(grp) || 0) + parseFloat(p.amount));
      }
      const bulkPayFreshAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      for (const [grp, grpTotal] of bulkPayByGroup) {
        const isDefault = grp === "__default__";
        const expCode = isDefault
          ? "SALARY_EXPENSE"
          : `SAL_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
        const expName = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;
        let expAccount = bulkPayFreshAccounts.find((a: any) => a.code === expCode);
        if (!expAccount) {
          expAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId!,
            code: expCode,
            name: expName,
            accountType: "Expense",
            openingBalance: "0",
            active: true,
          });
        }
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: expAccount.id,
          debitAmount: grpTotal.toFixed(2),
          creditAmount: "0",
          narration: isDefault
            ? `Bulk salary payment - ${payments.length} workers - ${voucherNumber}`
            : `Salary expense - ${grp} - ${voucherNumber}`,
        });
      }

      // Create credit entry for bank/cash account
      const creditEntry: any = {
        voucherId: voucher.id,
        debitAmount: "0",
        creditAmount: totalAmount.toFixed(2),
        narration: `Bulk salary payment - ${payments.length} workers - ${voucherNumber}`,
      };

      if (accountType === "cash") {
        creditEntry.ledgerAccountId = parseInt(accountId);
      } else {
        creditEntry.bankAccountId = parseInt(accountId);
      }

      await db.insert(voucherEntries).values(creditEntry);

      res.json({
        voucher,
        paymentsProcessed: payments.length,
        totalAmount: totalAmount.toFixed(2),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── ERP Payroll Runs (draft → paid workflow) ──────────────────────────────

  // Create a new payroll run (saves as DRAFT, no ledger entries yet)
  app.post("/api/payroll/runs", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date, notes, items } = req.body;
      if (!date || !Array.isArray(items) || items.length === 0)
        return res.status(400).json({ message: "date and items are required" });
      const createdAt = new Date().toISOString();
      const [run] = await db
        .insert(erpPayrollRuns)
        .values({ companyId, status: "DRAFT", date, notes: notes || null, createdAt })
        .returning();
      await db.insert(erpPayrollRunItems).values(
        items.map((it: any) => ({
          runId: run.id,
          employeeId: it.employeeId,
          employeeName: it.employeeName,
          groupName: it.groupName || null,
          baseSalary: parseFloat(it.baseSalary).toFixed(2),
          deduction: parseFloat(it.deduction || 0).toFixed(2),
          netPay: parseFloat(it.netPay).toFixed(2),
        }))
      );
      res.json({ ...run, items });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // List payroll runs for current company
  app.get("/api/payroll/runs", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      // Accept companyId from query param (explicit) or fall back to session
      const paramCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
      const sessionCompanyId = req.session.currentCompanyId;
      const companyId = paramCompanyId || sessionCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Validate that the requesting user has access to this company
      if (paramCompanyId && paramCompanyId !== sessionCompanyId) {
        const userRoles = await storage.getUserCompaniesWithRoles(req.session.userId);
        const hasAccess = userRoles.some((r: any) => r.companyId === paramCompanyId);
        if (!hasAccess) return res.status(403).json({ message: "Access denied to this company" });
      }

      const runs = await db
        .select()
        .from(erpPayrollRuns)
        .where(eq(erpPayrollRuns.companyId, companyId))
        .orderBy(desc(erpPayrollRuns.createdAt));
      // Attach item counts + totals
      const result = await Promise.all(
        runs.map(async (run) => {
          const items = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, run.id));
          const totalNet = items.reduce((s, i) => s + parseFloat(i.netPay), 0);
          const totalBase = items.reduce((s, i) => s + parseFloat(i.baseSalary), 0);
          return {
            ...run,
            itemCount: items.length,
            totalNet: totalNet.toFixed(2),
            totalBase: totalBase.toFixed(2),
            items,
          };
        })
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Update a DRAFT run's items / mark as PAID
  app.patch("/api/payroll/runs/:id", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const runId = parseInt(req.params.id);
      const [run] = await db
        .select()
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.id, runId), eq(erpPayrollRuns.companyId, companyId)));
      if (!run) return res.status(404).json({ message: "Payroll run not found" });

      const { action, items, paymentAccountId, date, notes } = req.body;

      if (action === "pay") {
        // Mark as PAID + create ledger entries
        if (run.status === "PAID") return res.status(400).json({ message: "Already paid" });
        if (!paymentAccountId) return res.status(400).json({ message: "Payment account required" });

        const runItems = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, runId));
        const totalAmount = runItems.reduce((s, i) => s + parseFloat(i.netPay), 0);
        if (totalAmount <= 0) return res.status(400).json({ message: "Total net pay must be > 0" });

        const allAccounts = await storage.getAllLedgerAccounts(companyId);

        // Group run items by worker group name so each group gets its own expense account
        const itemsByGroup = new Map<string, number>();
        for (const item of runItems) {
          const grp = (item.groupName || "").trim() || "__default__";
          itemsByGroup.set(grp, (itemsByGroup.get(grp) || 0) + parseFloat(item.netPay));
        }

        const payDate = run.date;
        const voucherNumber = `SAL-${runId}-${Date.now()}`;
        const [voucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber,
            voucherType: "Payment",
            voucherDate: payDate,
            description: run.notes || `Payroll run #${runId} — ${runItems.length} workers`,
            totalAmount: totalAmount.toFixed(2),
          })
          .returning();

        // Create one debit entry per worker group
        for (const [grp, grpTotal] of itemsByGroup) {
          const isDefault = grp === "__default__";
          const expCode = isDefault
            ? "SALARY_EXPENSE"
            : `SAL_EXP_${grp
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "_")
                .substring(0, 25)}`;
          const expName = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;

          let expAccount = allAccounts.find((a: any) => a.code === expCode);
          if (!expAccount) {
            expAccount = await storage.createLedgerAccount({
              companyId,
              code: expCode,
              name: expName,
              accountType: "Expense",
              openingBalance: "0",
              active: true,
            });
          }
          await db.insert(voucherEntries).values({
            voucherId: voucher.id,
            ledgerAccountId: expAccount.id,
            debitAmount: grpTotal.toFixed(2),
            creditAmount: "0",
            narration: isDefault
              ? `Salary expense — payroll run #${runId}`
              : `Salary expense - ${grp} — run #${runId}`,
          });
        }

        // Single credit entry for the total payment out
        await db.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: parseInt(paymentAccountId),
          debitAmount: "0",
          creditAmount: totalAmount.toFixed(2),
          narration: `Cash paid — payroll run #${runId}`,
        });
        const [updated] = await db
          .update(erpPayrollRuns)
          .set({ status: "PAID", paymentAccountId: parseInt(paymentAccountId), paidAt: new Date().toISOString() })
          .where(eq(erpPayrollRuns.id, runId))
          .returning();

        // Deduct advance balances FIFO for each employee who has a deduction in this payroll
        const payMonth = payDate.substring(0, 7);
        for (const item of runItems) {
          const deductAmt = parseFloat(item.deduction || "0");
          if (deductAmt <= 0 || !item.employeeId) continue;

          const outstanding = await db
            .select()
            .from(salaryAdvances)
            .where(
              and(
                eq(salaryAdvances.employeeId, item.employeeId),
                eq(salaryAdvances.companyId, companyId),
                eq(salaryAdvances.fullyPaid, false)
              )
            )
            .orderBy(salaryAdvances.advanceDate);

          let remaining = deductAmt;
          for (const adv of outstanding) {
            if (remaining <= 0.001) break;
            const bal = parseFloat(adv.remainingBalance || "0");
            if (bal <= 0) continue;
            const toDeduct = Math.min(remaining, bal);
            const newBal = Math.max(0, bal - toDeduct);
            const fullyPaid = newBal <= 0.01;

            await db.insert(salaryAdvanceDeductions).values({
              salaryAdvanceId: adv.id,
              payrollMonth: payMonth,
              deductionAmount: toDeduct.toFixed(2),
            });
            await db
              .update(salaryAdvances)
              .set({ remainingBalance: newBal.toFixed(2), fullyPaid })
              .where(eq(salaryAdvances.id, adv.id));
            remaining -= toDeduct;
          }
        }

        // WhatsApp auto-statement trigger (non-fatal) — uses the same per-account
        // rule configured in Accounts → WhatsApp settings
        let waResult: { sent: boolean; error?: string } = { sent: false };
        try {
          waResult = await triggerAccountWhatsAppStatement({
            companyId,
            accountId: parseInt(paymentAccountId),
            accountType: "ledger",
            voucherType: "Payment",
            voucherDate: payDate,
          });
        } catch (waErr: any) {
          logger.error("[payroll-wa] WhatsApp trigger error (non-fatal):", { error: waErr });
        }

        return res.json({ ...updated, voucher, whatsapp: waResult });
      }

      if (action === "update" || !action) {
        // Update items/notes while still DRAFT
        if (run.status === "PAID") return res.status(400).json({ message: "Cannot edit a paid run" });
        const updates: any = {};
        if (notes !== undefined) updates.notes = notes;
        if (date) updates.date = date;
        if (Object.keys(updates).length)
          await db.update(erpPayrollRuns).set(updates).where(eq(erpPayrollRuns.id, runId));
        if (Array.isArray(items) && items.length > 0) {
          await db.delete(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, runId));
          await db.insert(erpPayrollRunItems).values(
            items.map((it: any) => ({
              runId,
              employeeId: it.employeeId,
              employeeName: it.employeeName,
              groupName: it.groupName || null,
              baseSalary: parseFloat(it.baseSalary).toFixed(2),
              deduction: parseFloat(it.deduction || 0).toFixed(2),
              netPay: parseFloat(it.netPay).toFixed(2),
            }))
          );
        }
        const [updated] = await db.select().from(erpPayrollRuns).where(eq(erpPayrollRuns.id, runId));
        const updatedItems = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, runId));
        return res.json({ ...updated, items: updatedItems });
      }

      res.status(400).json({ message: "Unknown action" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Delete a DRAFT payroll run
  app.delete("/api/payroll/runs/:id", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const runId = parseInt(req.params.id);
      const [run] = await db
        .select()
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.id, runId), eq(erpPayrollRuns.companyId, companyId)));
      if (!run) return res.status(404).json({ message: "Payroll run not found" });
      if (run.status === "PAID") return res.status(400).json({ message: "Cannot delete a paid run" });
      await db.delete(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, runId));
      await db.delete(erpPayrollRuns).where(eq(erpPayrollRuns.id, runId));
      res.json({ message: "Deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Undo a PAID payroll run ───────────────────────────────────────────────
  app.post("/api/payroll/runs/:id/undo", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const runId = parseInt(req.params.id);
      const [run] = await db
        .select()
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.id, runId), eq(erpPayrollRuns.companyId, companyId)));
      if (!run) return res.status(404).json({ message: "Payroll run not found" });
      if (run.status !== "PAID") return res.status(400).json({ message: "Only PAID runs can be undone" });

      await db.transaction(async (tx) => {
        // 1. Find and soft-delete the SAL- voucher tied to this run
        const salVouchers = await tx
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              sql`${vouchers.voucherNumber} LIKE ${"SAL-" + runId + "-%"}`,
              isNull(vouchers.deletedAt)
            )
          );
        for (const v of salVouchers) {
          await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, v.id));
        }

        // 2. Reverse advance deductions for each run item
        const runItems = await tx.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, runId));
        const payMonth = run.date.substring(0, 7);

        for (const item of runItems) {
          const deductAmt = parseFloat(item.deduction || "0");
          if (deductAmt <= 0 || !item.employeeId) continue;

          // Find advance deductions recorded for this payroll month for this employee's advances
          const empAdvances = await tx
            .select({ id: salaryAdvances.id })
            .from(salaryAdvances)
            .where(and(eq(salaryAdvances.employeeId, item.employeeId), eq(salaryAdvances.companyId, companyId)));
          const advanceIds = empAdvances.map((a) => a.id);
          if (advanceIds.length === 0) continue;

          const deductions = await tx
            .select()
            .from(salaryAdvanceDeductions)
            .where(
              and(
                inArray(salaryAdvanceDeductions.salaryAdvanceId, advanceIds),
                eq(salaryAdvanceDeductions.payrollMonth, payMonth)
              )
            );

          for (const ded of deductions) {
            const dedAmt = parseFloat(ded.deductionAmount || "0");
            const [adv] = await tx.select().from(salaryAdvances).where(eq(salaryAdvances.id, ded.salaryAdvanceId));
            if (!adv) continue;
            const restoredBal = parseFloat(adv.remainingBalance || "0") + dedAmt;
            const originalAmt = parseFloat(adv.amount || "0");
            const newBal = Math.min(restoredBal, originalAmt);
            await tx
              .update(salaryAdvances)
              .set({ remainingBalance: newBal.toFixed(2), fullyPaid: false })
              .where(eq(salaryAdvances.id, adv.id));
            await tx.delete(salaryAdvanceDeductions).where(eq(salaryAdvanceDeductions.id, ded.id));
          }
        }

        // 3. Reset run to DRAFT
        await tx
          .update(erpPayrollRuns)
          .set({ status: "DRAFT", paymentAccountId: null, paidAt: null })
          .where(eq(erpPayrollRuns.id, runId));
      });

      res.json({ message: "Payroll run reversed to draft" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Diagnostic: what does the server see for paid payroll runs? ──
  app.get("/api/payroll/runs/diagnostic", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allRuns = await db.select().from(erpPayrollRuns).where(eq(erpPayrollRuns.companyId, companyId));
      const paidRuns = allRuns.filter((r) => r.status === "PAID");

      const allAccounts = await storage.getAllLedgerAccounts(companyId);
      const salaryExpenseAccount = allAccounts.find((a: any) => a.code === "SALARY_EXPENSE");

      const runDetails = await Promise.all(
        paidRuns.map(async (run) => {
          const items = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, run.id));
          const salVouchers = await db
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, companyId),
                sql`${vouchers.voucherNumber} LIKE ${"SAL-" + run.id + "-%"}`,
                isNull(vouchers.deletedAt)
              )
            );
          const allVouchersForRun = await db
            .select()
            .from(vouchers)
            .where(
              and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${"SAL-" + run.id + "-%"}`)
            );
          return {
            runId: run.id,
            status: run.status,
            date: run.date,
            itemCount: items.length,
            itemGroupNames: [...new Set(items.map((i) => i.groupName || "(none)"))],
            salVouchersActive: salVouchers.map((v) => ({ id: v.id, number: v.voucherNumber })),
            allVouchersIncDeleted: allVouchersForRun.map((v) => ({
              id: v.id,
              number: v.voucherNumber,
              deleted: !!v.deletedAt,
            })),
          };
        })
      );

      res.json({
        companyId,
        totalRuns: allRuns.length,
        paidRuns: paidRuns.length,
        salaryExpenseAccount: salaryExpenseAccount
          ? { id: salaryExpenseAccount.id, code: salaryExpenseAccount.code }
          : null,
        runs: runDetails,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Migrate old PAID runs to per-group Salary Expense - {Group} accounts ──
  app.post("/api/payroll/runs/migrate-group-expenses", requireAuth, requireNonPOS, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Shared group-membership lookup: employeeId → groupName (current assignments)
      const groupMemberships = await db
        .select({ employeeId: employeeGroupMembers.employeeId, groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(and(eq(employeeGroups.companyId, companyId), eq(employeeGroups.active, true)));
      const empGroupMap = new Map<number, string>();
      for (const row of groupMemberships) {
        if (!empGroupMap.has(row.employeeId)) empGroupMap.set(row.employeeId, row.groupName);
      }

      // Helper: get or create a ledger account by code
      async function getOrCreateAccount(code: string, name: string): Promise<any> {
        const accs = await storage.getAllLedgerAccounts(companyId);
        let acc = accs.find((a: any) => a.code === code);
        if (!acc) {
          const isBonus = code === "BONUS_EXPENSE" || code.startsWith("BONUS_EXP_");
          acc = await storage.createLedgerAccount({
            companyId,
            code,
            name,
            accountType: isBonus ? "Indirect Expense" : "Expense",
            openingBalance: "0",
            active: true,
          });
        }
        return acc;
      }

      // ── 1. Worker payroll runs (SAL-{runId}-*) ───────────────────────────────
      const allAccounts = await storage.getAllLedgerAccounts(companyId);
      const oldSalaryIds = new Set(
        allAccounts
          .filter((a: any) => a.code === "SALARY_EXPENSE" || a.code.startsWith("WORKER_PAY_"))
          .map((a: any) => a.id)
      );

      const paidRuns = await db
        .select()
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.companyId, companyId), eq(erpPayrollRuns.status, "PAID")));

      let migrated = 0;
      let alreadyCorrect = 0;
      let noGroups = 0;
      let noVoucher = 0;

      for (const run of paidRuns) {
        const salVouchers = await pool.query(
          `SELECT * FROM vouchers WHERE company_id = $1 AND voucher_number LIKE $2 AND deleted_at IS NULL`,
          [companyId, `SAL-${run.id}-%`]
        );
        if (salVouchers.rows.length === 0) { noVoucher++; continue; }
        const oldVoucher = salVouchers.rows[0];

        const debitRes = await pool.query(
          `SELECT * FROM voucher_entries WHERE voucher_id = $1 AND debit_amount::numeric > 0`,
          [oldVoucher.id]
        );
        const hasOldDebit = debitRes.rows.some((e: any) => oldSalaryIds.has(e.ledger_account_id));
        if (!hasOldDebit) { alreadyCorrect++; continue; }

        const runItems = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, run.id));
        const totalAmount = runItems.reduce((s, i) => s + parseFloat(i.netPay), 0);
        const itemsByGroup = new Map<string, number>();
        for (const item of runItems) {
          const stored = (item.groupName || "").trim();
          const grp = stored || (item.employeeId ? empGroupMap.get(item.employeeId) || "__default__" : "__default__");
          itemsByGroup.set(grp, (itemsByGroup.get(grp) || 0) + parseFloat(item.netPay));
        }
        const hasNamedGroups = [...itemsByGroup.keys()].some((k) => k !== "__default__");
        if (!hasNamedGroups) { noGroups++; continue; }

        await db.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, oldVoucher.id));
        const newVoucherNumber = `SAL-${run.id}-${Date.now()}`;
        const [newVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherNumber: newVoucherNumber,
          voucherType: "Payment",
          voucherDate: run.date,
          description: run.notes || `Payroll run #${run.id}`,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        for (const [grp, grpTotal] of itemsByGroup) {
          const isDefault = grp === "__default__";
          const code = isDefault ? "SALARY_EXPENSE" : `SAL_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
          const name = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;
          const acc = await getOrCreateAccount(code, name);
          await db.insert(voucherEntries).values({
            voucherId: newVoucher.id,
            ledgerAccountId: acc.id,
            debitAmount: grpTotal.toFixed(2),
            creditAmount: "0",
            narration: isDefault ? `Salary expense — payroll run #${run.id}` : `Salary expense - ${grp} — run #${run.id}`,
          });
        }
        if (run.paymentAccountId) {
          await db.insert(voucherEntries).values({
            voucherId: newVoucher.id,
            ledgerAccountId: run.paymentAccountId,
            debitAmount: "0",
            creditAmount: totalAmount.toFixed(2),
            narration: `Cash paid — payroll run #${run.id}`,
          });
        }
        migrated++;
      }

      // ── 2. Salary deposit vouchers (SAL-DEP-*) ───────────────────────────────
      // Old codes: PAYROLL_DEPOSIT_EXPENSE (very old) or a single SALARY_EXPENSE (no per-group split)
      const freshAccs2 = await storage.getAllLedgerAccounts(companyId);
      const oldDepIds = new Set(
        freshAccs2
          .filter((a: any) => a.code === "PAYROLL_DEPOSIT_EXPENSE" || a.code === "SALARY_EXPENSE")
          .map((a: any) => a.id)
      );
      const accCodeById = new Map(freshAccs2.map((a: any) => [a.id, a.code]));

      const depVouchersRes = await pool.query(
        `SELECT * FROM vouchers WHERE company_id = $1 AND voucher_number LIKE 'SAL-DEP-%' AND deleted_at IS NULL ORDER BY id`,
        [companyId]
      );

      let depositsMigrated = 0;
      let depositsAlreadyCorrect = 0;

      for (const dv of depVouchersRes.rows) {
        const debitRes = await pool.query(
          `SELECT * FROM voucher_entries WHERE voucher_id = $1 AND debit_amount::numeric > 0`,
          [dv.id]
        );
        const creditRes = await pool.query(
          `SELECT * FROM voucher_entries WHERE voucher_id = $1 AND credit_amount::numeric > 0`,
          [dv.id]
        );

        const hasOldDebit = debitRes.rows.some((e: any) => oldDepIds.has(e.ledger_account_id));
        if (!hasOldDebit) { depositsAlreadyCorrect++; continue; }

        // Determine if any old debit is truly wrong (PAYROLL_DEPOSIT_EXPENSE, or SALARY_EXPENSE without per-group)
        const hasPayrollDepExpense = debitRes.rows.some((e: any) => accCodeById.get(e.ledger_account_id) === "PAYROLL_DEPOSIT_EXPENSE");

        // Group employees from credit entries to determine new per-group debits
        const byGroup = new Map<string, number>();
        for (const entry of creditRes.rows) {
          const empId = entry.employee_id ? parseInt(entry.employee_id) : null;
          const grp = empId ? (empGroupMap.get(empId) || "__default__") : "__default__";
          byGroup.set(grp, (byGroup.get(grp) || 0) + parseFloat(entry.credit_amount));
        }

        const hasNamedDepGroups = [...byGroup.keys()].some((k) => k !== "__default__");

        // Skip if already SALARY_EXPENSE (not PAYROLL_DEPOSIT_EXPENSE) and no named groups
        if (!hasPayrollDepExpense && !hasNamedDepGroups) {
          depositsAlreadyCorrect++;
          continue;
        }

        // Delete old debit entries that use old-style accounts
        for (const de of debitRes.rows) {
          if (oldDepIds.has(de.ledger_account_id)) {
            await pool.query(`DELETE FROM voucher_entries WHERE id = $1`, [de.id]);
          }
        }

        // Insert new per-group debit entries
        for (const [grp, grpTotal] of byGroup) {
          const isDefault = grp === "__default__";
          const code = isDefault ? "SALARY_EXPENSE" : `SAL_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
          const name = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;
          const acc = await getOrCreateAccount(code, name);
          await db.insert(voucherEntries).values({
            voucherId: dv.id,
            ledgerAccountId: acc.id,
            debitAmount: grpTotal.toFixed(2),
            creditAmount: "0",
            narration: isDefault ? `Salary deposit - ${dv.voucher_number}` : `Salary deposit - ${grp} - ${dv.voucher_number}`,
          });
        }
        depositsMigrated++;
      }

      // ── 3. Bonus vouchers (BONUS-*) ───────────────────────────────────────────
      // Handles two cases:
      //   A) Old code: SALARY_EXPENSE used for bonuses (pre-Phase 5)
      //   B) Generic BONUS_EXPENSE used (Phase 5) but not yet split per group
      const freshAccs3 = await storage.getAllLedgerAccounts(companyId);
      // IDs that need replacing: both the old SALARY_EXPENSE and the unsplit generic BONUS_EXPENSE
      const oldBonusIds = new Set(
        freshAccs3
          .filter((a: any) => a.code === "SALARY_EXPENSE" || a.code === "BONUS_EXPENSE")
          .map((a: any) => a.id)
      );
      // IDs that are already per-group (BONUS_EXP_*) — vouchers with only these are already correct
      const perGroupBonusIds = new Set(
        freshAccs3
          .filter((a: any) => a.code.startsWith("BONUS_EXP_"))
          .map((a: any) => a.id)
      );

      const bonusVouchersRes = await pool.query(
        `SELECT * FROM vouchers WHERE company_id = $1 AND voucher_number LIKE 'BONUS-%' AND deleted_at IS NULL ORDER BY id`,
        [companyId]
      );

      let bonusesMigrated = 0;
      let bonusesAlreadyCorrect = 0;

      for (const bv of bonusVouchersRes.rows) {
        const debitRes = await pool.query(
          `SELECT * FROM voucher_entries WHERE voucher_id = $1 AND debit_amount::numeric > 0`,
          [bv.id]
        );
        const creditRes = await pool.query(
          `SELECT * FROM voucher_entries WHERE voucher_id = $1 AND credit_amount::numeric > 0`,
          [bv.id]
        );

        // Determine what kind of debit entries exist on this voucher
        const hasOldOrGenericDebit = debitRes.rows.some((e: any) => oldBonusIds.has(e.ledger_account_id));
        const hasPerGroupDebit = debitRes.rows.some((e: any) => perGroupBonusIds.has(e.ledger_account_id));
        const creditTotal = creditRes.rows.reduce((s: number, e: any) => s + parseFloat(e.credit_amount), 0);

        // Skip only when per-group debits exist AND no old/generic debit remains
        // (vouchers with NO debit entries at all must be processed — previous migration may have
        //  deleted the old entry but failed to insert the replacement)
        if (!hasOldOrGenericDebit && (hasPerGroupDebit || creditTotal <= 0)) {
          bonusesAlreadyCorrect++;
          continue;
        }

        // Group employees from credit entries by their current group membership
        const byGroup = new Map<string, number>();
        for (const entry of creditRes.rows) {
          const empId = entry.employee_id ? parseInt(entry.employee_id) : null;
          const grp = empId ? (empGroupMap.get(empId) || "__default__") : "__default__";
          byGroup.set(grp, (byGroup.get(grp) || 0) + parseFloat(entry.credit_amount));
        }

        // If no groups derived from credits, fall back to debit total (or credit total if
        // debit entries were already deleted by a previous failed migration run)
        if (byGroup.size === 0) {
          const totalFromDebits = debitRes.rows
            .filter((e: any) => oldBonusIds.has(e.ledger_account_id))
            .reduce((s: number, e: any) => s + parseFloat(e.debit_amount), 0);
          const fallbackTotal = totalFromDebits > 0 ? totalFromDebits : creditTotal;
          if (fallbackTotal > 0) byGroup.set("__default__", fallbackTotal);
        }

        // Check if there are any named groups — if only __default__, still fix account code
        const hasNamedGroups = [...byGroup.keys()].some((k) => k !== "__default__");

        // Delete old/generic debit entries (SALARY_EXPENSE or unsplit BONUS_EXPENSE)
        for (const de of debitRes.rows) {
          if (oldBonusIds.has(de.ledger_account_id)) {
            await pool.query(`DELETE FROM voucher_entries WHERE id = $1`, [de.id]);
          }
        }

        // Insert new per-group BONUS_EXP_* debit entries (or BONUS_EXPENSE if no groups)
        for (const [grp, grpTotal] of byGroup) {
          const isDefault = grp === "__default__";
          const code = isDefault ? "BONUS_EXPENSE" : `BONUS_EXP_${grp.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 25)}`;
          const name = isDefault ? "Bonus Expense" : `Bonus Expense - ${grp}`;
          const acc = await getOrCreateAccount(code, name);
          await db.insert(voucherEntries).values({
            voucherId: bv.id,
            ledgerAccountId: acc.id,
            debitAmount: grpTotal.toFixed(2),
            creditAmount: "0",
            narration: isDefault ? `Bonus expense - ${bv.voucher_number}` : `Bonus expense - ${grp} - ${bv.voucher_number}`,
          });
        }
        bonusesMigrated++;
      }

      res.json({
        migrated,
        alreadyCorrect,
        noGroups,
        noVoucher,
        total: paidRuns.length,
        depositsMigrated,
        depositsAlreadyCorrect,
        bonusesMigrated,
        bonusesAlreadyCorrect,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── End ERP Payroll Runs ──────────────────────────────────────────────────

  // Get employees with calculated balances from transactions
  app.get("/api/payroll/employees-with-balances", requireAuth, async (req, res) => {
    // Disable HTTP caching - employee balances are dynamically calculated
    res.set("Cache-Control", "no-store");
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const employeesWithBalances = await storage.getEmployeesWithBalances(req.session.currentCompanyId);
      res.json(employeesWithBalances);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get worker payment summary (total paid to each worker)
  app.get("/api/payroll/worker-payments-summary", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all employees of type Worker for current company
      const allEmployees = await storage.getAllEmployees(req.session.currentCompanyId);
      const workers = allEmployees.filter((emp: any) => emp.employeeType === "Worker");

      // Get all ledger accounts for current company
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);

      // Calculate total paid per worker by checking their employee liability account
      const workerPayments = await Promise.all(
        workers.map(async (worker: any) => {
          // Find employee's liability account (code: EMP-{worker.code})
          const employeeAccountCode = `EMP-${worker.code}`;
          const employeeAccount = allAccounts.find((a: any) => a.code === employeeAccountCode);

          let totalPaid = 0;

          if (employeeAccount) {
            // Get all voucher entries that credit this employee account (withdrawals/payments)
            const entries = await db
              .select({
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(
                and(
                  eq(vouchers.companyId, req.session.currentCompanyId!),
                  eq(voucherEntries.ledgerAccountId, employeeAccount.id),
                  isNull(vouchers.deletedAt),
                  eq(vouchers.optional, false)
                )
              );

            // Sum all credits (payments to worker)
            totalPaid = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.creditAmount || "0"), 0);
          }

          return {
            workerId: worker.id,
            workerCode: worker.code,
            workerName: `${worker.firstName} ${worker.lastName}`,
            totalPaid: totalPaid.toFixed(2),
          };
        })
      );

      // Calculate grand total
      const grandTotal = workerPayments.reduce((sum: number, wp: any) => sum + parseFloat(wp.totalPaid), 0);

      res.json({
        workerPayments,
        grandTotal: grandTotal.toFixed(2),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

}
