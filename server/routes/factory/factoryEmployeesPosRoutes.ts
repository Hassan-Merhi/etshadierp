import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerFactoryEmployeesPosRoutes(app: Express) {
  app.get("/api/factory/employees", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            eq(employees.employeeType, "Employee"),
            sql`${employees.deletedAt} IS NULL`
          )
        )
        .orderBy(employees.firstName);

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/employees/:id - single employee
  app.get("/api/factory/employees/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee")));

      if (!emp) return res.status(404).json({ message: "Employee not found" });
      res.json(emp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees - create employee with employeeType = "Employee"
  app.post("/api/factory/employees", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { firstName, lastName, code, department, phone, monthlySalary, joinDate, active } = req.body;
      if (!firstName || !lastName) return res.status(400).json({ message: "First name and last name are required" });
      if (!joinDate) return res.status(400).json({ message: "Join date is required" });

      // Auto-generate code if not provided
      let empCode = code;
      if (!empCode) {
        const firstPart = firstName.trim().substring(0, 3).toUpperCase();
        const lastPart = lastName.trim().substring(0, 3).toUpperCase();
        let baseCode = firstPart + lastPart || "EMP";
        empCode = baseCode;
        let suffix = 1;
        const existing = await db.select({ code: employees.code }).from(employees).where(eq(employees.companyId, companyId));
        const existingCodes = new Set(existing.map((e: any) => e.code));
        while (existingCodes.has(empCode)) {
          empCode = `${baseCode}${suffix}`;
          suffix++;
        }
      } else {
        const [existing] = await db.select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.code, empCode)));
        if (existing) return res.status(400).json({ message: "Employee code already exists" });
      }

      const [emp] = await db.insert(employees).values({
        companyId,
        code: empCode,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone || null,
        department: department || null,
        monthlySalary: monthlySalary ? String(monthlySalary) : "0",
        joinDate,
        employeeType: "Employee",
        active: active !== false,
      }).returning();

      res.status(201).json(emp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/employees/:id - update employee
  app.patch("/api/factory/employees/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { firstName, lastName, department, phone, monthlySalary, active } = req.body;
      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (department !== undefined) updates.department = department;
      if (phone !== undefined) updates.phone = phone;
      if (monthlySalary !== undefined) updates.monthlySalary = String(monthlySalary);
      if (active !== undefined) updates.active = active;

      const [updated] = await db.update(employees).set(updates).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      ).returning();

      if (!updated) return res.status(404).json({ message: "Employee not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/employees/:id - soft-delete employee
  app.delete("/api/factory/employees/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const [deleted] = await db.update(employees)
        .set({ deletedAt: new Date(), active: false })
        .where(and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee")))
        .returning({ id: employees.id });

      if (!deleted) return res.status(404).json({ message: "Employee not found" });
      res.json({ message: "Employee deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/employees/:id/statement - running ledger from voucher entries
  app.get("/api/factory/employees/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Pull all voucher entries for this employee
      const entries = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          voucherType: vouchers.voucherType,
          description: vouchers.description,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.employeeId, id),
            eq(vouchers.companyId, companyId)
          )
        )
        .orderBy(vouchers.voucherDate, vouchers.id);

      // Build running balance
      let runningBalance = 0;
      const rows = entries.map((e: any) => {
        const credit = parseFloat(e.creditAmount || "0");
        const debit = parseFloat(e.debitAmount || "0");
        runningBalance += credit - debit;
        return {
          ...e,
          credit,
          debit,
          balance: runningBalance,
        };
      });

      res.json({ employee: emp, rows });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/:id/deposit - single deposit
  // DR: PAYROLL_DEPOSIT_EXPENSE, CR: Employee (via employeeId)
  app.post("/api/factory/employees/:id/deposit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { amount, date, notes } = req.body;
      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
      let [payrollExpenseAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
      );
      if (!payrollExpenseAccount) {
        [payrollExpenseAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: "PAYROLL_DEPOSIT_EXPENSE",
          name: "Payroll Deposit Expense",
          accountType: "Indirect Expense",
          openingBalance: "0",
          active: true,
        }).returning();
      }

      const voucherNumber = `EMP-DEP-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Salary deposit for ${emp.firstName} ${emp.lastName}`,
        totalAmount: depositAmount.toFixed(2),
      }).returning();

      // DR: Payroll Expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: payrollExpenseAccount.id,
        debitAmount: depositAmount.toFixed(2),
        creditAmount: "0",
        narration: notes || `Salary deposit - ${voucherNumber}`,
      });

      // CR: Employee
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: id,
        debitAmount: "0",
        creditAmount: depositAmount.toFixed(2),
        narration: notes || `Salary deposit - ${voucherNumber}`,
      });

      // Update employee balance
      const newBalance = parseFloat(emp.currentBalance || "0") + depositAmount;
      const newDeposits = parseFloat(emp.totalDeposits || "0") + depositAmount;
      await db.update(employees).set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
      }).where(eq(employees.id, id));

      const [updated] = await db.select().from(employees).where(eq(employees.id, id));
      res.json({ voucher, employee: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/:id/withdraw - single withdrawal
  // DR: Employee (via employeeId), CR: Cash ledger account
  app.post("/api/factory/employees/:id/withdraw", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { amount, date, notes, cashAccountId } = req.body;
      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });
      if (!cashAccountId) return res.status(400).json({ message: "Cash account is required" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Verify cash account belongs to this company
      const [cashAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.id, parseInt(cashAccountId)), eq(ledgerAccounts.companyId, companyId))
      );
      if (!cashAccount) return res.status(404).json({ message: "Cash account not found" });

      const voucherNumber = `EMP-WD-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Withdrawal for ${emp.firstName} ${emp.lastName}`,
        totalAmount: withdrawAmount.toFixed(2),
      }).returning();

      // DR: Employee
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: id,
        debitAmount: withdrawAmount.toFixed(2),
        creditAmount: "0",
        narration: notes || `Withdrawal - ${voucherNumber}`,
      });

      // CR: Cash
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: cashAccount.id,
        debitAmount: "0",
        creditAmount: withdrawAmount.toFixed(2),
        narration: notes || `Withdrawal - ${voucherNumber}`,
      });

      // Update employee balance (can go negative)
      const newBalance = parseFloat(emp.currentBalance || "0") - withdrawAmount;
      const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + withdrawAmount;
      await db.update(employees).set({
        currentBalance: newBalance.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      }).where(eq(employees.id, id));

      const [updated] = await db.select().from(employees).where(eq(employees.id, id));
      res.json({ voucher, employee: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/bulk-payroll - bulk payroll deposit for multiple employees
  app.post("/api/factory/employees/bulk-payroll", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { deposits, date, notes } = req.body;
      if (!deposits || !Array.isArray(deposits) || deposits.length === 0) {
        return res.status(400).json({ message: "No deposits provided" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });

      // Validate: at least amount or deduction must be > 0
      const validDeposits = deposits.filter((d: any) => {
        const a = parseFloat(d.amount) || 0;
        const ded = parseFloat(d.deduction) || 0;
        return d.employeeId && (a > 0 || ded > 0);
      });
      if (validDeposits.length === 0) {
        return res.status(400).json({ message: "No valid deposit amounts provided" });
      }

      // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
      let [payrollExpenseAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
      );
      if (!payrollExpenseAccount) {
        [payrollExpenseAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: "PAYROLL_DEPOSIT_EXPENSE",
          name: "Payroll Deposit Expense",
          accountType: "Indirect Expense",
          openingBalance: "0",
          active: true,
        }).returning();
      }

      // Get or create PAYROLL_DEDUCTION_RECOVERY account for deductions
      let [deductionAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEDUCTION_RECOVERY"))
      );
      if (!deductionAccount) {
        [deductionAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: "PAYROLL_DEDUCTION_RECOVERY",
          name: "Payroll Deduction Recovery",
          accountType: "Indirect Income",
          openingBalance: "0",
          active: true,
        }).returning();
      }

      const totalSalary = validDeposits.reduce((sum: number, d: any) => sum + (parseFloat(d.amount) || 0), 0);
      const totalDeduction = validDeposits.reduce((sum: number, d: any) => sum + (parseFloat(d.deduction) || 0), 0);
      const totalNet = totalSalary - totalDeduction;
      const voucherNumber = `EMP-PAY-${Date.now()}`;

      // Single bulk voucher (totalAmount = gross salary for accounting)
      const [bulkVoucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Bulk payroll - ${validDeposits.length} employees`,
        totalAmount: Math.abs(totalNet).toFixed(2),
      }).returning();

      // DR: Payroll Expense (gross salary)
      if (totalSalary > 0) {
        await db.insert(voucherEntries).values({
          voucherId: bulkVoucher.id,
          ledgerAccountId: payrollExpenseAccount.id,
          debitAmount: totalSalary.toFixed(2),
          creditAmount: "0",
          narration: notes || `Bulk payroll gross - ${validDeposits.length} employees - ${voucherNumber}`,
        });
      }

      // CR: Deduction Recovery (total deductions)
      if (totalDeduction > 0) {
        await db.insert(voucherEntries).values({
          voucherId: bulkVoucher.id,
          ledgerAccountId: deductionAccount.id,
          debitAmount: "0",
          creditAmount: totalDeduction.toFixed(2),
          narration: `Payroll deductions - ${voucherNumber}`,
        });
      }

      // Per-employee: credit salary, debit deduction → net balance change
      const results = [];
      for (const dep of validDeposits) {
        const empId = parseInt(dep.employeeId);
        const amount = parseFloat(dep.amount) || 0;
        const deduction = parseFloat(dep.deduction) || 0;
        const net = amount - deduction;

        const [emp] = await db.select().from(employees).where(
          and(eq(employees.id, empId), eq(employees.companyId, companyId))
        );
        if (!emp) continue;

        // CR employee: salary earned
        if (amount > 0) {
          await db.insert(voucherEntries).values({
            voucherId: bulkVoucher.id,
            ledgerAccountId: null,
            employeeId: empId,
            debitAmount: "0",
            creditAmount: amount.toFixed(2),
            narration: `Salary for ${emp.firstName} ${emp.lastName} - ${voucherNumber}`,
          });
        }

        // DR employee: deduction applied
        if (deduction > 0) {
          await db.insert(voucherEntries).values({
            voucherId: bulkVoucher.id,
            ledgerAccountId: null,
            employeeId: empId,
            debitAmount: deduction.toFixed(2),
            creditAmount: "0",
            narration: `Deduction for ${emp.firstName} ${emp.lastName} - ${voucherNumber}`,
          });
        }

        // Update employee balance: net = salary - deduction (can go negative)
        const currentBal = parseFloat(emp.currentBalance || "0");
        const newBalance = currentBal + net;
        const newDeposits = parseFloat(emp.totalDeposits || "0") + amount;
        const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + deduction;
        await db.update(employees).set({
          currentBalance: newBalance.toFixed(2),
          totalDeposits: newDeposits.toFixed(2),
          ...(deduction > 0 ? { totalWithdrawals: newWithdrawals.toFixed(2) } : {}),
        }).where(eq(employees.id, empId));

        results.push({ employeeId: empId, amount, deduction, net, name: `${emp.firstName} ${emp.lastName}` });
      }

      res.json({ voucher: bulkVoucher, results, totalSalary, totalDeduction, totalNet });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/recalculate-balances
  // Rebuilds currentBalance, totalDeposits, totalWithdrawals for every employee from surviving voucher entries.
  // Useful after deletions that didn't reverse balances (legacy bug).
  app.post("/api/factory/employees/recalculate-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = ((req.session as any).currentRole || (req.session as any).role || "").toLowerCase();
      if (role !== "admin" && role !== "owner" && role !== "developer") {
        return res.status(403).json({ message: "Only Admin or Owner can recalculate balances" });
      }

      // Get all employees for this company
      const allEmployees = await db.select().from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), sql`${employees.deletedAt} IS NULL`));

      if (allEmployees.length === 0) return res.json({ updated: 0, employees: [] });

      // For each employee, sum voucher entry credits and debits from non-deleted vouchers
      // Join through employees table to avoid passing an array parameter to ANY()
      const entrySums = await db.execute(sql`
        SELECT
          ve.employee_id,
          COALESCE(SUM(ve.credit_amount::numeric), 0) AS total_credits,
          COALESCE(SUM(ve.debit_amount::numeric), 0)  AS total_debits
        FROM voucher_entries ve
        INNER JOIN vouchers v ON v.id = ve.voucher_id
        INNER JOIN employees e ON e.id = ve.employee_id
        WHERE e.company_id = ${companyId}
          AND e.employee_type = 'Employee'
          AND e.deleted_at IS NULL
          AND v.deleted_at IS NULL
        GROUP BY ve.employee_id
      `);

      // Build a map: empId → { totalCredits, totalDebits }
      const sumMap = new Map<number, { credits: number; debits: number }>();
      for (const row of (entrySums as any).rows || (entrySums as any)) {
        const empId = Number(row.employee_id);
        sumMap.set(empId, {
          credits: parseFloat(row.total_credits || "0"),
          debits:  parseFloat(row.total_debits  || "0"),
        });
      }

      const results = [];
      for (const emp of allEmployees) {
        const sums = sumMap.get(emp.id) || { credits: 0, debits: 0 };
        const openingBal = parseFloat(emp.openingBalance || "0");
        const newBalance      = openingBal + sums.credits - sums.debits;
        const newDeposits     = sums.credits;
        const newWithdrawals  = sums.debits;

        await db.update(employees).set({
          currentBalance:   newBalance.toFixed(2),
          totalDeposits:    newDeposits.toFixed(2),
          totalWithdrawals: newWithdrawals.toFixed(2),
        }).where(eq(employees.id, emp.id));

        results.push({
          id: emp.id,
          name: `${emp.firstName} ${emp.lastName}`,
          oldBalance:   parseFloat(emp.currentBalance || "0"),
          newBalance,
          newDeposits,
          newWithdrawals,
        });
      }

      res.json({ updated: results.length, employees: results });
    } catch (error: any) {
      console.error("Error recalculating employee balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/:id/recalculate-balance
  // Rebuilds currentBalance, totalDeposits, totalWithdrawals for a single employee from surviving voucher entries.
  app.post("/api/factory/employees/:id/recalculate-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const empId = parseInt(req.params.id);

      const [emp] = await db.select().from(employees)
        .where(and(eq(employees.id, empId), eq(employees.companyId, companyId), sql`${employees.deletedAt} IS NULL`));
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      const entrySums = await db.execute(sql`
        SELECT
          COALESCE(SUM(ve.credit_amount::numeric), 0) AS total_credits,
          COALESCE(SUM(ve.debit_amount::numeric), 0)  AS total_debits
        FROM voucher_entries ve
        INNER JOIN vouchers v ON v.id = ve.voucher_id
        WHERE ve.employee_id = ${empId}
          AND v.deleted_at IS NULL
      `);

      const row = ((entrySums as any).rows || (entrySums as any))[0] || {};
      const credits = parseFloat(row.total_credits || "0");
      const debits  = parseFloat(row.total_debits  || "0");
      const openingBal = parseFloat(emp.openingBalance || "0");
      const newBalance     = openingBal + credits - debits;
      const newDeposits    = credits;
      const newWithdrawals = debits;

      await db.update(employees).set({
        currentBalance:   newBalance.toFixed(2),
        totalDeposits:    newDeposits.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      }).where(eq(employees.id, empId));

      res.json({
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        oldBalance: parseFloat(emp.currentBalance || "0"),
        newBalance, newDeposits, newWithdrawals,
      });
    } catch (error: any) {
      console.error("Error recalculating employee balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Employee Attendance ──────────────────────────────────────────────────────

  app.get("/api/factory/employee-attendance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.query as { date?: string };
      if (!date) return res.status(400).json({ message: "date is required" });

      const emps = await db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, code: employees.code, department: employees.department })
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), eq(employees.active, true), sql`${employees.deletedAt} IS NULL`))
        .orderBy(employees.firstName);

      if (emps.length === 0) return res.json({ employees: [], attendance: [] });

      const empIds = emps.map((e: any) => e.id);
      const existing = await db.execute(sql`
        SELECT * FROM employee_attendance
        WHERE company_id = ${companyId} AND attendance_date = ${date}
        AND employee_id = ANY(${empIds})
      `);
      res.json({ employees: emps, attendance: existing.rows });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/employee-attendance/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { records } = req.body as { records: Array<{ employeeId: number; attendanceDate: string; status: string; notes?: string }> };
      if (!Array.isArray(records) || records.length === 0) return res.status(400).json({ message: "records array is required" });

      for (const r of records) {
        await db.execute(sql`
          INSERT INTO employee_attendance (company_id, employee_id, attendance_date, status, notes)
          VALUES (${companyId}, ${r.employeeId}, ${r.attendanceDate}, ${r.status}, ${r.notes || null})
          ON CONFLICT (employee_id, attendance_date) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes
        `);
      }
      res.json({ saved: records.length });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/factory/employee-attendance/employee/:id — per-employee attendance for a date range
  app.get("/api/factory/employee-attendance/employee/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const empId = parseInt(req.params.id);
      if (isNaN(empId)) return res.status(400).json({ message: "Invalid employee ID" });
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate required" });
      const rows = await db.execute(sql`
        SELECT * FROM employee_attendance
        WHERE company_id = ${companyId} AND employee_id = ${empId}
          AND attendance_date >= ${startDate} AND attendance_date <= ${endDate}
        ORDER BY attendance_date
      `);
      res.json(rows.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/factory/employees/bulk-withdraw — withdraw from multiple employees at once
  app.post("/api/factory/employees/bulk-withdraw", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { withdrawals, date, notes, cashAccountId } = req.body;
      if (!withdrawals || !Array.isArray(withdrawals) || withdrawals.length === 0)
        return res.status(400).json({ message: "No withdrawals provided" });
      if (!date) return res.status(400).json({ message: "Date is required" });
      if (!cashAccountId) return res.status(400).json({ message: "Cash account is required" });

      const validWithdrawals = withdrawals.filter((w: any) => {
        const a = parseFloat(w.amount);
        return !isNaN(a) && a > 0 && w.employeeId;
      });
      if (validWithdrawals.length === 0)
        return res.status(400).json({ message: "No valid withdrawal amounts provided" });

      const [cashAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.id, parseInt(cashAccountId)), eq(ledgerAccounts.companyId, companyId))
      );
      if (!cashAccount) return res.status(404).json({ message: "Cash account not found" });

      const totalAmount = validWithdrawals.reduce((s: number, w: any) => s + parseFloat(w.amount), 0);
      const voucherNumber = `EMP-WD-BULK-${Date.now()}`;

      const [bulkVoucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Bulk withdrawal - ${validWithdrawals.length} employees`,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      // CR: Cash (total)
      await db.insert(voucherEntries).values({
        voucherId: bulkVoucher.id,
        ledgerAccountId: cashAccount.id,
        debitAmount: "0",
        creditAmount: totalAmount.toFixed(2),
        narration: notes || `Bulk withdrawal - ${validWithdrawals.length} employees - ${voucherNumber}`,
      });

      const results = [];
      for (const wd of validWithdrawals) {
        const empId = parseInt(wd.employeeId);
        const amount = parseFloat(wd.amount);
        const [emp] = await db.select().from(employees).where(
          and(eq(employees.id, empId), eq(employees.companyId, companyId))
        );
        if (!emp) continue;

        // DR: Employee
        await db.insert(voucherEntries).values({
          voucherId: bulkVoucher.id,
          ledgerAccountId: null,
          employeeId: empId,
          debitAmount: amount.toFixed(2),
          creditAmount: "0",
          narration: wd.notes || `Withdrawal for ${emp.firstName} ${emp.lastName} - ${voucherNumber}`,
        });

        const newBalance = parseFloat(emp.currentBalance || "0") - amount;
        const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + amount;
        await db.update(employees).set({
          currentBalance: newBalance.toFixed(2),
          totalWithdrawals: newWithdrawals.toFixed(2),
        }).where(eq(employees.id, empId));

        results.push({ employeeId: empId, amount, name: `${emp.firstName} ${emp.lastName}` });
      }

      res.json({ voucher: bulkVoucher, results, totalAmount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Employee Advances ────────────────────────────────────────────────────────

  app.get("/api/factory/employee-advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { employeeId, status } = req.query as { employeeId?: string; status?: string };

      let query = `SELECT ea.*, e.first_name, e.last_name, e.code as employee_code,
        la.name as cash_account_name
        FROM employee_advances ea
        LEFT JOIN employees e ON e.id = ea.employee_id
        LEFT JOIN ledger_accounts la ON la.id = ea.cash_account_id
        WHERE ea.company_id = ${companyId}`;
      if (employeeId) query += ` AND ea.employee_id = ${parseInt(employeeId)}`;
      if (status === "open") query += ` AND ea.fully_paid = false`;
      if (status === "paid") query += ` AND ea.fully_paid = true`;
      query += ` ORDER BY ea.advance_date DESC, ea.id DESC`;

      const result = await db.execute(sql.raw(query));
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/employee-advances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { employeeId, advanceDate, amount, cashAccountId, notes } = req.body;
      if (!employeeId || !advanceDate || !amount) return res.status(400).json({ message: "employeeId, advanceDate, amount required" });
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Invalid amount" });

      const [emp] = await db.select().from(employees).where(and(eq(employees.id, parseInt(employeeId)), eq(employees.companyId, companyId)));
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      const result = await db.execute(sql`
        INSERT INTO employee_advances (company_id, employee_id, advance_date, amount, remaining_balance, cash_account_id, notes, fully_paid)
        VALUES (${companyId}, ${parseInt(employeeId)}, ${advanceDate}, ${amt.toFixed(2)}, ${amt.toFixed(2)}, ${cashAccountId ? parseInt(cashAccountId) : null}, ${notes || null}, false)
        RETURNING *
      `);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/employee-advances/:id/repay", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const advId = parseInt(req.params.id);
      const { repaymentDate, amount, cashAccountId, notes } = req.body;
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Invalid amount" });

      const advResult = await db.execute(sql`SELECT * FROM employee_advances WHERE id = ${advId} AND company_id = ${companyId}`);
      const adv = advResult.rows[0] as any;
      if (!adv) return res.status(404).json({ message: "Advance not found" });

      const remaining = parseFloat(adv.remaining_balance) - amt;
      const fullyPaid = remaining <= 0;

      await db.execute(sql`
        INSERT INTO employee_advance_repayments (company_id, advance_id, employee_id, repayment_date, amount, cash_account_id, notes)
        VALUES (${companyId}, ${advId}, ${adv.employee_id}, ${repaymentDate}, ${amt.toFixed(2)}, ${cashAccountId ? parseInt(cashAccountId) : null}, ${notes || null})
      `);
      await db.execute(sql`
        UPDATE employee_advances SET remaining_balance = ${Math.max(0, remaining).toFixed(2)}, fully_paid = ${fullyPaid} WHERE id = ${advId}
      `);
      res.json({ message: "Repayment recorded", remaining: Math.max(0, remaining).toFixed(2) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/factory/employee-advance-repayments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { advanceId } = req.query as { advanceId?: string };
      let query = `SELECT r.*, e.first_name, e.last_name, ea.amount as advance_amount, ea.advance_date
        FROM employee_advance_repayments r
        LEFT JOIN employees e ON e.id = r.employee_id
        LEFT JOIN employee_advances ea ON ea.id = r.advance_id
        WHERE r.company_id = ${companyId}`;
      if (advanceId) query += ` AND r.advance_id = ${parseInt(advanceId)}`;
      query += ` ORDER BY r.repayment_date DESC`;
      const result = await db.execute(sql.raw(query));
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/factory/employee-advances/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      await db.execute(sql`DELETE FROM employee_advance_repayments WHERE advance_id = ${parseInt(req.params.id)} AND company_id = ${companyId}`);
      await db.execute(sql`DELETE FROM employee_advances WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId}`);
      res.json({ message: "Advance deleted" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Employee Bonuses ─────────────────────────────────────────────────────────

  app.get("/api/factory/employee-bonuses", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { employeeId } = req.query as { employeeId?: string };
      let query = `SELECT eb.*, e.first_name, e.last_name, e.code as employee_code
        FROM employee_bonuses eb
        LEFT JOIN employees e ON e.id = eb.employee_id
        WHERE eb.company_id = ${companyId}`;
      if (employeeId) query += ` AND eb.employee_id = ${parseInt(employeeId)}`;
      query += ` ORDER BY eb.bonus_date DESC, eb.id DESC`;
      const result = await db.execute(sql.raw(query));
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/employee-bonuses", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { employeeId, bonusDate, amount, notes } = req.body;
      if (!employeeId || !bonusDate || !amount) return res.status(400).json({ message: "employeeId, bonusDate, amount required" });
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Invalid amount" });

      const [emp] = await db.select().from(employees).where(and(eq(employees.id, parseInt(employeeId)), eq(employees.companyId, companyId)));
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
      let [payrollExpenseAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
      );
      if (!payrollExpenseAccount) {
        [payrollExpenseAccount] = await db.insert(ledgerAccounts).values({
          companyId, code: "PAYROLL_DEPOSIT_EXPENSE", name: "Payroll Deposit Expense",
          accountType: "Indirect Expense", openingBalance: "0", active: true,
        }).returning();
      }

      const voucherNumber = `EMP-BON-${Date.now()}`;
      const desc = notes || `Bonus for ${emp.firstName} ${emp.lastName}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId, voucherNumber, voucherType: "Journal", voucherDate: bonusDate,
        description: desc, totalAmount: amt.toFixed(2),
      }).returning();

      await db.insert(voucherEntries).values({ voucherId: voucher.id, ledgerAccountId: payrollExpenseAccount.id, debitAmount: amt.toFixed(2), creditAmount: "0", narration: desc });
      await db.insert(voucherEntries).values({ voucherId: voucher.id, ledgerAccountId: null, employeeId: parseInt(employeeId), debitAmount: "0", creditAmount: amt.toFixed(2), narration: desc });

      const newBalance = parseFloat(emp.currentBalance || "0") + amt;
      const newDeposits = parseFloat(emp.totalDeposits || "0") + amt;
      await db.update(employees).set({ currentBalance: newBalance.toFixed(2), totalDeposits: newDeposits.toFixed(2) }).where(eq(employees.id, parseInt(employeeId)));

      const bonusResult = await db.execute(sql`
        INSERT INTO employee_bonuses (company_id, employee_id, bonus_date, amount, notes, voucher_id)
        VALUES (${companyId}, ${parseInt(employeeId)}, ${bonusDate}, ${amt.toFixed(2)}, ${notes || null}, ${voucher.id})
        RETURNING *
      `);
      res.status(201).json(bonusResult.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/factory/employee-bonuses/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const bonusResult = await db.execute(sql`SELECT * FROM employee_bonuses WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId}`);
      const bonus = bonusResult.rows[0] as any;
      if (!bonus) return res.status(404).json({ message: "Bonus not found" });

      // Reverse the credit
      const [emp] = await db.select().from(employees).where(eq(employees.id, bonus.employee_id));
      if (emp) {
        const newBalance = parseFloat(emp.currentBalance || "0") - parseFloat(bonus.amount);
        const newDeposits = parseFloat(emp.totalDeposits || "0") - parseFloat(bonus.amount);
        await db.update(employees).set({ currentBalance: newBalance.toFixed(2), totalDeposits: newDeposits.toFixed(2) }).where(eq(employees.id, bonus.employee_id));
      }
      if (bonus.voucher_id) {
        await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id = ${bonus.voucher_id}`);
        await db.execute(sql`DELETE FROM vouchers WHERE id = ${bonus.voucher_id}`);
      }
      await db.execute(sql`DELETE FROM employee_bonuses WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId}`);
      res.json({ message: "Bonus deleted and reversed" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ─── Worker Bonuses ───────────────────────────────────────────────────────────

  app.get("/api/factory/worker-bonuses", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerId, status } = req.query as { workerId?: string; status?: string };
      let query = `SELECT wb.*, fw.full_name as worker_name, fw.employee_code,
        la.name as cash_account_name
        FROM worker_bonuses wb
        LEFT JOIN factory_workers fw ON fw.id = wb.worker_id
        LEFT JOIN ledger_accounts la ON la.id = wb.cash_account_id
        WHERE wb.company_id = ${companyId}`;
      if (workerId) query += ` AND wb.worker_id = ${parseInt(workerId)}`;
      if (status) query += ` AND wb.status = '${status}'`;
      query += ` ORDER BY wb.bonus_date DESC, wb.id DESC`;
      const result = await db.execute(sql.raw(query));
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/worker-bonuses", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { workerId, bonusDate, amount, notes } = req.body;
      if (!workerId || !bonusDate || !amount) return res.status(400).json({ message: "workerId, bonusDate, amount required" });
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Invalid amount" });
      const result = await db.execute(sql`
        INSERT INTO worker_bonuses (company_id, worker_id, bonus_date, amount, notes, status)
        VALUES (${companyId}, ${parseInt(workerId)}, ${bonusDate}, ${amt.toFixed(2)}, ${notes || null}, 'pending')
        RETURNING *
      `);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/factory/worker-bonuses/:id/pay", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { cashAccountId, paidDate } = req.body;
      if (!cashAccountId) return res.status(400).json({ message: "cashAccountId required" });
      await db.execute(sql`
        UPDATE worker_bonuses SET status = 'paid', cash_account_id = ${parseInt(cashAccountId)}, paid_date = ${paidDate || getClientDate(req)}
        WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId} AND status = 'pending'
      `);
      res.json({ message: "Bonus marked as paid" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/factory/worker-bonuses/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || (req.session as any).factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      await db.execute(sql`DELETE FROM worker_bonuses WHERE id = ${parseInt(req.params.id)} AND company_id = ${companyId} AND status = 'pending'`);
      res.json({ message: "Bonus deleted" });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ============================================================
  // BALE LEDGER — full production lifecycle summary
  // ============================================================

  app.get("/api/factory/bale-ledger", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Load all relevant data
      const [allBalesRaw, allProducts, allCategories, pendingOrderBaleIdsRaw] = await Promise.all([
        db.execute(sql`
          SELECT
            fb.id,
            fb.product_id AS "productId",
            fb.product_name AS "productName",
            fb.article_code AS "articleCode",
            fb.status,
            fb.reference_number AS "referenceNumber",
            COALESCE(fb.weight_kg, 0)::float AS "weightKg",
            COALESCE(fb.total_cost, 0)::float AS "totalCost",
            fb.waste_dispatch_id AS "wasteDispatchId"
          FROM factory_bales fb
          WHERE fb.company_id = ${companyId}
          AND fb.status IN ('IN_STOCK', 'SOLD', 'DISPATCHED', 'RESERVED_FOR_ORDER')
        `),
        db.select({ id: factoryBaleProducts.id, name: factoryBaleProducts.name, articleCode: factoryBaleProducts.articleCode, categoryId: factoryBaleProducts.categoryId, productionPrice: factoryBaleProducts.productionPrice }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId)),
        db.select({ id: factoryCategories.id, name: factoryCategories.name }).from(factoryCategories).where(eq(factoryCategories.companyId, companyId)),
        // Bale IDs linked to orders currently in LOADING / PENDING_VERIFICATION / VERIFIED
        db.execute(sql`
          SELECT DISTINCT cob.bale_id AS "baleId"
          FROM customer_order_bales cob
          INNER JOIN customer_orders co ON co.id = cob.order_id
          WHERE co.company_id = ${companyId}
          AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
        `),
      ]);

      const allBales: any[] = Array.isArray(allBalesRaw) ? allBalesRaw : (allBalesRaw as any).rows || [];
      const pendingOrderBaleIds = new Set<number>(
        (Array.isArray(pendingOrderBaleIdsRaw) ? pendingOrderBaleIdsRaw : (pendingOrderBaleIdsRaw as any).rows || [])
          .map((r: any) => Number(r.baleId))
      );

      // Identify waste categories (garbage or wiper)
      const wasteCategories = new Set<number>(
        allCategories
          .filter((c: any) => {
            const n = (c.name || "").toLowerCase();
            return n.includes("garbage") || n.includes("wiper");
          })
          .map((c: any) => c.id)
      );

      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const categoryMap = new Map(allCategories.map((c: any) => [c.id, c]));

      function isWasteProduct(productId: number | null, articleCode?: string | null): boolean {
        if (articleCode?.startsWith("HMD16")) return true;
        if (!productId) return false;
        const p = productMap.get(productId);
        if (!p) return false;
        return p.categoryId ? wasteCategories.has(p.categoryId) : false;
      }

      function getProductLabel(bale: any): { productName: string; articleCode: string; categoryName: string; productId: number | null } {
        const p = bale.productId ? productMap.get(bale.productId) : null;
        const cat = p?.categoryId ? categoryMap.get(p.categoryId) : null;
        return {
          productName: p?.name || bale.productName || bale.articleCode || "Unknown",
          articleCode: p?.articleCode || bale.articleCode || "—",
          categoryName: cat?.name || "—",
          productId: bale.productId || null,
        };
      }

      // Use production (cost) price per bale from product
      function getSellingPrice(bale: any): number {
        const p = bale.productId ? productMap.get(bale.productId) : null;
        return parseFloat(p?.productionPrice || "0") || 0;
      }

      // Group bales into buckets
      type BaleDetail = { ref: string; weightKg: number; totalCost: number };
      type BucketRow = { productId: number | null; productName: string; articleCode: string; categoryName: string; baleCount: number; totalWeightKg: number; totalCost: number; baleDetails: BaleDetail[] };
      const buckets: { currentStock: Map<string, BucketRow>; wasteStock: Map<string, BucketRow>; sold: Map<string, BucketRow>; wasteDispatched: Map<string, BucketRow>; pendingLoading: Map<string, BucketRow> } = {
        currentStock: new Map(),
        wasteStock: new Map(),
        sold: new Map(),
        wasteDispatched: new Map(),
        pendingLoading: new Map(),
      };

      function addToBucket(bucket: Map<string, BucketRow>, key: string, label: ReturnType<typeof getProductLabel>, bale: any) {
        const existing = bucket.get(key);
        const w = parseFloat(bale.weightKg) || 0;
        const c = getSellingPrice(bale); // selling price replaces cost
        const ref: string = bale.referenceNumber || "";
        const detail: BaleDetail = { ref, weightKg: w, totalCost: c };
        if (existing) {
          existing.baleCount++;
          existing.totalWeightKg += w;
          existing.totalCost += c;
          existing.baleDetails.push(detail);
        } else {
          bucket.set(key, { ...label, baleCount: 1, totalWeightKg: w, totalCost: c, baleDetails: [detail] });
        }
      }

      for (const bale of allBales) {
        const label = getProductLabel(bale);
        const key = `${bale.productId ?? "null"}-${label.productName}`;
        const waste = isWasteProduct(bale.productId, bale.articleCode);

        if (bale.status === "SOLD") {
          addToBucket(buckets.sold, key, label, bale);
        } else if (bale.status === "DISPATCHED" && bale.wasteDispatchId) {
          addToBucket(buckets.wasteDispatched, key, label, bale);
        } else if (bale.status === "RESERVED_FOR_ORDER") {
          // Bale is physically reserved/scanned into a loading order
          addToBucket(buckets.pendingLoading, key, label, bale);
        } else if (bale.status === "IN_STOCK") {
          if (pendingOrderBaleIds.has(Number(bale.id))) {
            // Bale is linked to a LOADING/PENDING_VERIFICATION/VERIFIED order but not yet reserved
            addToBucket(buckets.pendingLoading, key, label, bale);
          } else if (waste) {
            addToBucket(buckets.wasteStock, key, label, bale);
          } else {
            addToBucket(buckets.currentStock, key, label, bale);
          }
        }
      }

      function bucketToArray(m: Map<string, BucketRow>) {
        return Array.from(m.values()).sort((a, b) => {
          const catCmp = a.categoryName.localeCompare(b.categoryName);
          if (catCmp !== 0) return catCmp;
          return a.productName.localeCompare(b.productName);
        });
      }

      function sumBucket(rows: BucketRow[]) {
        return rows.reduce((acc, r) => ({
          baleCount: acc.baleCount + r.baleCount,
          totalWeightKg: acc.totalWeightKg + r.totalWeightKg,
          totalCost: acc.totalCost + r.totalCost,
        }), { baleCount: 0, totalWeightKg: 0, totalCost: 0 });
      }

      const currentStock = bucketToArray(buckets.currentStock);
      const wasteStock = bucketToArray(buckets.wasteStock);
      const sold = bucketToArray(buckets.sold);
      const wasteDispatched = bucketToArray(buckets.wasteDispatched);
      const pendingLoading = bucketToArray(buckets.pendingLoading);

      res.json({
        currentStock,
        wasteStock,
        sold,
        wasteDispatched,
        pendingLoading,
        totals: {
          currentStock: sumBucket(currentStock),
          wasteStock: sumBucket(wasteStock),
          sold: sumBucket(sold),
          wasteDispatched: sumBucket(wasteDispatched),
          pendingLoading: sumBucket(pendingLoading),
          grand: sumBucket([...currentStock, ...wasteStock, ...sold, ...wasteDispatched, ...pendingLoading]),
        },
      });
    } catch (error: any) {
      console.error("Error fetching bale ledger:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // WASTE DISPATCH ROUTES — factory bale waste disposal
  // ============================================================

  app.get("/api/factory/waste-dispatch/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const search = (req.query.search as string) || "";

      const allCategories = await db.select().from(factoryCategories).where(eq(factoryCategories.companyId, companyId));
      const wasteCategories = allCategories.filter((c: any) => {
        const name = (c.name || "").toLowerCase();
        return name.includes("garbage") || name.includes("wiper");
      });
      const wasteCategoryIds = new Set(wasteCategories.map((c: any) => c.id));

      const allProducts = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const wasteProductIds = new Set(
        allProducts
          .filter((p: any) => {
            if (p.categoryId && wasteCategoryIds.has(p.categoryId)) return true;
            if (p.articleCode?.startsWith("HMD16")) return true;
            return false;
          })
          .map((p: any) => p.id)
      );

      if (wasteProductIds.size === 0) {
        return res.json({ bales: [], categories: wasteCategories });
      }

      const baleRows = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
            inArray(factoryBales.productId, Array.from(wasteProductIds) as number[])
          )
        )
        .orderBy(desc(factoryBales.id));

      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const categoryMap = new Map(allCategories.map((c: any) => [c.id, c]));

      const locationIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))] as number[];
      const locationRows = locationIds.length > 0
        ? await db.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, locationIds))
        : [];
      const locationMap = new Map(locationRows.map((l: any) => [l.id, l.name]));

      const enriched = baleRows.map((b: any) => {
        const product = productMap.get(b.productId as number);
        const cat = product?.categoryId ? categoryMap.get(product.categoryId) : null;
        return {
          id: b.id,
          referenceNumber: b.referenceNumber,
          productName: product?.name || product?.articleCode || b.productName || "Unknown",
          articleCode: b.articleCode || product?.articleCode,
          categoryName: cat?.name || b.category || "—",
          weightKg: parseFloat(b.weightKg as string) || 0,
          costPerKg: parseFloat(b.costPerKg as string) || 0,
          totalCost: parseFloat(b.totalCost as string) || 0,
          status: b.status,
          locationName: b.erpLocationId ? (locationMap.get(b.erpLocationId) || "Unknown") : "No Location",
          locationId: b.erpLocationId,
          finalizedAt: b.finalizedAt,
        };
      });

      const filtered = search
        ? enriched.filter((b: any) => {
            const s = search.toLowerCase();
            return (
              b.referenceNumber?.toLowerCase().includes(s) ||
              b.productName?.toLowerCase().includes(s) ||
              b.articleCode?.toLowerCase().includes(s) ||
              b.categoryName?.toLowerCase().includes(s) ||
              b.locationName?.toLowerCase().includes(s)
            );
          })
        : enriched;

      res.json({ bales: filtered, categories: wasteCategories });
    } catch (error: any) {
      console.error("Error fetching waste bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/waste-dispatch/history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dispatches = await db
        .select()
        .from(factoryBaleWasteDispatches)
        .where(eq(factoryBaleWasteDispatches.companyId, companyId))
        .orderBy(desc(factoryBaleWasteDispatches.id));

      // Fetch all removed bales for this company that have a waste_dispatch_id set.
      // Using raw SQL to avoid Drizzle array serialization issues with ANY().
      const linkedBalesRaw = await db.execute(sql`
        SELECT
          id,
          reference_number       AS "referenceNumber",
          product_name           AS "productName",
          COALESCE(weight_kg, 0)::float   AS "weightKg",
          COALESCE(total_cost, 0)::float  AS "totalCost",
          waste_dispatch_id      AS "wasteDispatchId"
        FROM factory_bales
        WHERE company_id = ${companyId}
          AND waste_dispatch_id IS NOT NULL
        ORDER BY waste_dispatch_id, id
      `);
      const linkedBales: any[] = Array.isArray(linkedBalesRaw)
        ? linkedBalesRaw
        : (linkedBalesRaw as any).rows || [];

      const balesByDispatch = new Map<number, any[]>();
      for (const bale of linkedBales) {
        const did = Number(bale.wasteDispatchId);
        if (!balesByDispatch.has(did)) balesByDispatch.set(did, []);
        balesByDispatch.get(did)!.push(bale);
      }

      res.json(dispatches.map((d: any) => ({
        ...d,
        bales: balesByDispatch.get(d.id) || [],
      })));
    } catch (error: any) {
      console.error("Error fetching waste dispatch history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/waste-dispatch/submit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { baleIds, dispatchDate, notes } = req.body;
      if (!baleIds || !Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds array is required" });
      }
      if (!dispatchDate) {
        return res.status(400).json({ message: "dispatchDate is required" });
      }

      const userId = (req.session as any).user?.id || null;

      const [lastDispatch] = await db
        .select({ dispatchNumber: factoryBaleWasteDispatches.dispatchNumber })
        .from(factoryBaleWasteDispatches)
        .where(eq(factoryBaleWasteDispatches.companyId, companyId))
        .orderBy(desc(factoryBaleWasteDispatches.id))
        .limit(1);

      let nextNum = 1;
      if (lastDispatch?.dispatchNumber) {
        const parts = lastDispatch.dispatchNumber.split("-");
        const last = parseInt(parts[parts.length - 1] || "0", 10);
        if (!isNaN(last)) nextNum = last + 1;
      }
      const dispatchNumber = `WD-${String(nextNum).padStart(4, "0")}`;

      const result = await db.transaction(async (tx: any) => {
        const balesToDispose = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

        if (balesToDispose.length === 0) throw new Error("No valid bales found");

        for (const bale of balesToDispose) {
          if (bale.status !== "IN_STOCK") {
            throw new Error(`Bale ${bale.referenceNumber} is not available (status: ${bale.status})`);
          }
        }

        let totalWeightKg = 0;
        let totalCostWrittenOff = 0;
        for (const bale of balesToDispose) {
          totalWeightKg += parseFloat(bale.weightKg as string) || 0;
          totalCostWrittenOff += parseFloat(bale.totalCost as string) || 0;
        }

        const [dispatch] = await tx.insert(factoryBaleWasteDispatches).values({
          companyId,
          dispatchNumber,
          dispatchDate,
          notes: notes || null,
          totalBales: balesToDispose.length,
          totalWeightKg: totalWeightKg.toFixed(3),
          totalCostWrittenOff: totalCostWrittenOff.toFixed(2),
          createdBy: userId,
        }).returning();

        const now = new Date();

        const productIds = [...new Set(balesToDispose.map((b: any) => b.productId).filter(Boolean))] as number[];
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map(factoryProducts.map((p: any) => [p.id, p]));
        const stockItemCache = new Map<string, number>();

        for (const bale of balesToDispose) {
          await tx.execute(sql`UPDATE factory_bales SET status = 'DISPATCHED', waste_dispatch_id = ${dispatch.id}, updated_at = ${now} WHERE id = ${bale.id}`);

          const product = productMap.get(bale.productId as number);
          const itemCode = product?.articleCode || product?.code || bale.articleCode || bale.baleCode;
          if (itemCode && bale.erpLocationId) {
            let erpStockItemId = stockItemCache.get(itemCode);
            if (!erpStockItemId) {
              const [existing] = await tx.select({ id: stockItems.id }).from(stockItems)
                .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));
              if (existing) {
                erpStockItemId = existing.id;
                stockItemCache.set(itemCode, erpStockItemId!);
              }
            }
            if (erpStockItemId) {
              await adjustInventory(tx, bale.erpLocationId, erpStockItemId, -1, companyId);
            }
          }
        }

        return { dispatch, totalWeightKg, totalCostWrittenOff, bales: balesToDispose };
      });

      await writeDaybookEntry(db, {
        companyId,
        txDate: dispatchDate,
        txType: "WASTE_DISPOSAL",
        referenceId: result.dispatch.id,
        referenceTable: "factory_bale_waste_dispatches",
        description: `Waste disposal ${dispatchNumber}: ${result.bales.length} bale(s), ${result.totalWeightKg.toFixed(1)} kg written off.${notes ? " " + notes : ""}`,
        amountCurrency: result.totalCostWrittenOff,
        amountUsd: result.totalCostWrittenOff,
        createdBy: userId,
      });

      res.json({
        dispatch: result.dispatch,
        totalBales: result.bales.length,
        totalWeightKg: result.totalWeightKg,
        totalCostWrittenOff: result.totalCostWrittenOff,
        bales: result.bales.map((b: any) => ({
          id: b.id,
          referenceNumber: b.referenceNumber,
          weightKg: parseFloat(b.weightKg as string) || 0,
          totalCost: parseFloat(b.totalCost as string) || 0,
        })),
      });
    } catch (error: any) {
      console.error("Error submitting waste dispatch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ─── Factory POS ────────────────────────────────────────────────────────────

  // GET /api/factory/pos/sales — list factory POS sales
  app.get("/api/factory/pos/sales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const sales = await db
        .select()
        .from(factoryPosSales)
        .where(eq(factoryPosSales.companyId, companyId))
        .orderBy(desc(factoryPosSales.createdAt));
      res.json(sales);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/pos/sales/:id — single sale with items
  app.get("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);
      const [sale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      const items = await db.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
      res.json({ ...sale, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/pos/sale — create a factory POS sale
  app.post("/api/factory/pos/sale", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      const rawUserId = (req.session as any).userId;
      const userId: number | null = rawUserId && !isNaN(Number(rawUserId)) ? Number(rawUserId) : null;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId, customerName, customerId, notes, txDate, currencyCode, cashAccountId, paymentType, depositAmount, items, expenses } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      // Validate item quantities against available stock
      for (const item of items) {
        if (!item.productId && !item.productName) return res.status(400).json({ message: "Each item needs a product" });
        if (!item.quantity || item.quantity <= 0) return res.status(400).json({ message: "Quantity must be positive" });
      }

      const isCredit = (paymentType || "CASH") === "CREDIT";
      const parsedCustomerId = customerId ? parseInt(customerId) : null;
      const depositAmt = isCredit ? Math.max(0, parseFloat(depositAmount || "0")) : 0;

      const totalAmount = items.reduce((s: number, it: any) => s + parseFloat(it.unitPrice || "0") * parseInt(it.quantity || "1"), 0);

      // Expense deductions (optional array of {accountId, description, amount})
      const expenseRows: Array<{ accountId: number; description: string; amount: number }> = [];
      if (Array.isArray(expenses)) {
        for (const exp of expenses) {
          const amt = parseFloat(exp.amount || "0");
          if (amt > 0 && exp.accountId) {
            expenseRows.push({ accountId: parseInt(exp.accountId), description: exp.description || "", amount: amt });
          }
        }
      }
      const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);
      // For cash: netCash = total - expenses. For credit: deposit may come in as cash.
      const netCash = isCredit ? depositAmt - totalExpenses : totalAmount - totalExpenses;

      // Generate sale number
      const [seqRow] = await db.select({ count: sql<number>`count(*)` }).from(factoryPosSales).where(eq(factoryPosSales.companyId, companyId));
      const nextNum = (Number(seqRow?.count || 0) + 1).toString().padStart(4, "0");
      const saleNumber = `FPOS-${nextNum}`;

      const result = await db.transaction(async (tx: any) => {
        // 1. Create sale record
        const [sale] = await tx.insert(factoryPosSales).values({
          companyId,
          saleNumber,
          txDate: txDate || getClientDate(req),
          locationId: locationId || null,
          customerName: customerName || null,
          customerId: parsedCustomerId,
          notes: notes || null,
          totalAmount: totalAmount.toFixed(2),
          currencyCode: currencyCode || "USD",
          cashAccountId: cashAccountId || null,
          paymentType: isCredit ? "CREDIT" : "CASH",
          depositAmount: isCredit ? depositAmt.toFixed(2) : "0",
          status: "COMPLETED",
          createdBy: userId,
          expensesJson: expenseRows.length > 0 ? JSON.stringify(expenseRows) : null,
        }).returning();

        // 2. Create sale items
        for (const item of items) {
          const qty = parseInt(item.quantity || "1");
          const price = parseFloat(item.unitPrice || "0");
          await tx.insert(factoryPosSaleItems).values({
            saleId: sale.id,
            companyId,
            productId: item.productId || null,
            productName: item.productName,
            articleCode: item.articleCode || null,
            quantity: qty,
            unitPrice: price.toFixed(2),
            totalAmount: (price * qty).toFixed(2),
            currencyCode: currencyCode || "USD",
          });

          // 3. Mark N bales as SOLD (pick oldest available by id)
          if (item.productId && locationId) {
            const availableBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, locationId),
                eq(factoryBales.status, "IN_STOCK"),
              ))
              .orderBy(factoryBales.id)
              .limit(qty);
            const baleIds = availableBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "SOLD", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }

        // 4. Create daybook entry for the sale
        await tx.insert(factoryDaybookEntries).values({
          companyId,
          txDate: txDate || getClientDate(req),
          txType: "BALE_SALE",
          referenceId: sale.id,
          referenceTable: "factory_pos_sales",
          description: `Factory POS Sale ${saleNumber}${customerName ? ` – ${customerName}` : ""}${isCredit ? " [CREDIT]" : ""}`,
          currencyCode: currencyCode || "USD",
          amountCurrency: totalAmount.toFixed(2),
          fxRateToUsd: "1",
          amountUsd: totalAmount.toFixed(2),
          createdBy: userId,
        });

        // 4b. Create daybook entries for each expense/deduction
        for (const exp of expenseRows) {
          await tx.insert(factoryDaybookEntries).values({
            companyId,
            txDate: txDate || getClientDate(req),
            txType: "POS_EXPENSE",
            referenceId: sale.id,
            referenceTable: "factory_pos_sales",
            description: `${exp.description || "Deduction"} – POS ${saleNumber}${customerName ? ` (${customerName})` : ""}`,
            currencyCode: currencyCode || "USD",
            amountCurrency: exp.amount.toFixed(2),
            fxRateToUsd: "1",
            amountUsd: exp.amount.toFixed(2),
            createdBy: userId,
          });
        }

        // 5a. CREDIT sale — update customer balance
        if (isCredit && parsedCustomerId) {
          // Compute current running balance for this customer
          const [balRow] = await tx
            .select({ net: sql<string>`COALESCE(SUM(debit_amount::numeric - credit_amount::numeric), 0)` })
            .from(customerBalances)
            .where(and(eq(customerBalances.customerId, parsedCustomerId), eq(customerBalances.companyId, companyId)));
          const runningBefore = parseFloat(balRow?.net || "0");

          // DR customer for full sale amount
          const balAfterSale = runningBefore + totalAmount;
          await tx.insert(customerBalances).values({
            companyId,
            customerId: parsedCustomerId,
            transactionDate: txDate || getClientDate(req),
            transactionType: "SALE",
            referenceId: sale.id,
            referenceType: "FACTORY_POS_SALE",
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            balance: balAfterSale.toFixed(2),
            currency: currencyCode || "USD",
            description: `POS Sale ${saleNumber}`,
          });

          // CR customer for any deposit received
          if (depositAmt > 0) {
            const balAfterDeposit = balAfterSale - depositAmt;
            await tx.insert(customerBalances).values({
              companyId,
              customerId: parsedCustomerId,
              transactionDate: txDate || getClientDate(req),
              transactionType: "PAYMENT",
              referenceId: sale.id,
              referenceType: "FACTORY_POS_DEPOSIT",
              debitAmount: "0",
              creditAmount: depositAmt.toFixed(2),
              balance: balAfterDeposit.toFixed(2),
              currency: currencyCode || "USD",
              description: `Deposit on POS Sale ${saleNumber}`,
            });
          }
        }

        // 5b. Cash receipt ERP voucher
        // For cash sales: full amount. For credit sales with deposit: deposit only.
        const voucherCashAmt = isCredit ? depositAmt : totalAmount;
        if (cashAccountId && voucherCashAmt > 0) {
          const voucherNum = `FPOS-${sale.id}-${Date.now()}`;
          const [vch] = await tx.insert(vouchers).values({
            companyId,
            voucherType: "Receipt",
            voucherNumber: voucherNum,
            voucherDate: txDate || getClientDate(req),
            description: `Factory POS Sale ${saleNumber}${customerName ? ` – ${customerName}` : ""}`,
            totalAmount: voucherCashAmt.toFixed(2),
            currency: currencyCode || "USD",
            exchangeRate: "1",
            sourceModule: "FACTORY_POS",
          }).returning();
          // DR Cash (net of deposit after expense deductions)
          const netDeposit = Math.max(0, netCash);
          if (netDeposit > 0) {
            await tx.insert(voucherEntries).values({
              voucherId: vch.id,
              ledgerAccountId: cashAccountId,
              debitAmount: netDeposit.toFixed(2),
              creditAmount: "0",
              narration: isCredit ? `Deposit on credit sale – ${saleNumber}` : `Factory POS cash receipt – ${saleNumber}`,
            });
          }
          // DR each expense account
          for (const exp of expenseRows) {
            await tx.insert(voucherEntries).values({
              voucherId: vch.id,
              ledgerAccountId: exp.accountId,
              debitAmount: exp.amount.toFixed(2),
              creditAmount: "0",
              narration: exp.description || `POS deduction – ${saleNumber}`,
            });
          }
          // CR Factory Sales Income (gross amount entering cash)
          const salesIncomeAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_BALE_SALES_INCOME", "Factory Bale Sales Income", "Revenue");
          await tx.insert(voucherEntries).values({
            voucherId: vch.id,
            ledgerAccountId: salesIncomeAccId,
            debitAmount: "0",
            creditAmount: voucherCashAmt.toFixed(2),
            narration: `Factory POS sales income – ${saleNumber}`,
          });
        }

        return sale;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // PUT /api/factory/pos/sales/:id — edit an existing factory POS sale
  app.put("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);

      const [existingSale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!existingSale) return res.status(404).json({ message: "Sale not found" });
      if (existingSale.status === "VOIDED") return res.status(400).json({ message: "Cannot edit a voided sale" });

      const { locationId, customerName, customerId, notes, txDate, currencyCode, cashAccountId, paymentType, depositAmount, items, expenses } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }

      const isCredit = (paymentType || "CASH") === "CREDIT";
      const parsedCustomerId = customerId ? parseInt(customerId) : null;
      const depositAmt = isCredit ? Math.max(0, parseFloat(depositAmount || "0")) : 0;
      const totalAmount = items.reduce((s: number, it: any) => s + parseFloat(it.unitPrice || "0") * parseInt(it.quantity || "1"), 0);

      const expenseRows: Array<{ accountId: number; description: string; amount: number }> = [];
      if (Array.isArray(expenses)) {
        for (const exp of expenses) {
          const amt = parseFloat(exp.amount || "0");
          if (amt > 0 && exp.accountId) {
            expenseRows.push({ accountId: parseInt(exp.accountId), description: exp.description || "", amount: amt });
          }
        }
      }
      const totalExpenses = expenseRows.reduce((s, e) => s + e.amount, 0);
      const netCash = isCredit ? depositAmt - totalExpenses : totalAmount - totalExpenses;

      const result = await db.transaction(async (tx: any) => {
        // Step 1: Restore bales for old items
        const oldItems = await tx.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
        for (const oldItem of oldItems) {
          if (oldItem.productId && existingSale.locationId) {
            const soldBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, oldItem.productId),
                eq(factoryBales.erpLocationId, existingSale.locationId),
                eq(factoryBales.status, "SOLD"),
              ))
              .orderBy(desc(factoryBales.id))
              .limit(oldItem.quantity);
            const baleIds = soldBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "IN_STOCK", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }

        // Step 2: Delete old items
        await tx.delete(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));

        // Step 3: Update sale record
        const [updatedSale] = await tx.update(factoryPosSales)
          .set({
            txDate: txDate || existingSale.txDate,
            locationId: locationId || null,
            customerName: customerName || null,
            customerId: parsedCustomerId,
            notes: notes || null,
            totalAmount: totalAmount.toFixed(2),
            currencyCode: currencyCode || "USD",
            cashAccountId: cashAccountId || null,
            paymentType: isCredit ? "CREDIT" : "CASH",
            depositAmount: isCredit ? depositAmt.toFixed(2) : "0",
            expensesJson: expenseRows.length > 0 ? JSON.stringify(expenseRows) : null,
          })
          .where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)))
          .returning();

        // Step 4: Insert new items and mark bales as SOLD
        for (const item of items) {
          const qty = parseInt(item.quantity || "1");
          const price = parseFloat(item.unitPrice || "0");
          await tx.insert(factoryPosSaleItems).values({
            saleId,
            companyId,
            productId: item.productId || null,
            productName: item.productName,
            articleCode: item.articleCode || null,
            quantity: qty,
            unitPrice: price.toFixed(2),
            totalAmount: (price * qty).toFixed(2),
            currencyCode: currencyCode || "USD",
          });

          if (item.productId && locationId) {
            const availableBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, locationId),
                eq(factoryBales.status, "IN_STOCK"),
              ))
              .orderBy(factoryBales.id)
              .limit(qty);
            const baleIds = availableBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "SOLD", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }

        // Step 5: Update factory daybook BALE_SALE entry and rebuild POS_EXPENSE entries
        await tx.update(factoryDaybookEntries)
          .set({
            amountCurrency: totalAmount.toFixed(2),
            amountUsd: totalAmount.toFixed(2),
            txDate: txDate || existingSale.txDate,
            description: `Factory POS Sale ${existingSale.saleNumber}${customerName ? ` – ${customerName}` : ""}${isCredit ? " [CREDIT]" : ""}`,
          })
          .where(and(
            eq(factoryDaybookEntries.referenceTable, "factory_pos_sales"),
            eq(factoryDaybookEntries.referenceId, saleId),
            eq(factoryDaybookEntries.txType, "BALE_SALE"),
          ));

        // Delete old expense daybook rows, then re-insert fresh ones
        await tx.delete(factoryDaybookEntries)
          .where(and(
            eq(factoryDaybookEntries.referenceTable, "factory_pos_sales"),
            eq(factoryDaybookEntries.referenceId, saleId),
            eq(factoryDaybookEntries.txType, "POS_EXPENSE"),
          ));
        for (const exp of expenseRows) {
          await tx.insert(factoryDaybookEntries).values({
            companyId,
            txDate: txDate || existingSale.txDate,
            txType: "POS_EXPENSE",
            referenceId: saleId,
            referenceTable: "factory_pos_sales",
            description: `${exp.description || "Deduction"} – POS ${existingSale.saleNumber}${customerName ? ` (${customerName})` : ""}`,
            currencyCode: currencyCode || "USD",
            amountCurrency: exp.amount.toFixed(2),
            fxRateToUsd: "1",
            amountUsd: exp.amount.toFixed(2),
          });
        }

        // Step 6: Update customer balance entries if applicable
        if (isCredit && parsedCustomerId) {
          // Remove old SALE and DEPOSIT balance entries for this sale
          await tx.delete(customerBalances)
            .where(and(
              eq(customerBalances.referenceId, saleId),
              eq(customerBalances.companyId, companyId),
              or(
                eq(customerBalances.referenceType, "FACTORY_POS_SALE"),
                eq(customerBalances.referenceType, "FACTORY_POS_DEPOSIT"),
              ),
            ));

          // Re-compute running balance and re-insert
          const [balRow] = await tx
            .select({ net: sql<string>`COALESCE(SUM(debit_amount::numeric - credit_amount::numeric), 0)` })
            .from(customerBalances)
            .where(and(eq(customerBalances.customerId, parsedCustomerId), eq(customerBalances.companyId, companyId)));
          const runningBefore = parseFloat(balRow?.net || "0");
          const balAfterSale = runningBefore + totalAmount;
          await tx.insert(customerBalances).values({
            companyId,
            customerId: parsedCustomerId,
            transactionDate: txDate || existingSale.txDate,
            transactionType: "SALE",
            referenceId: saleId,
            referenceType: "FACTORY_POS_SALE",
            debitAmount: totalAmount.toFixed(2),
            creditAmount: "0",
            balance: balAfterSale.toFixed(2),
            currency: currencyCode || "USD",
            description: `POS Sale ${existingSale.saleNumber} (edited)`,
          });
          if (depositAmt > 0) {
            const balAfterDeposit = balAfterSale - depositAmt;
            await tx.insert(customerBalances).values({
              companyId,
              customerId: parsedCustomerId,
              transactionDate: txDate || existingSale.txDate,
              transactionType: "PAYMENT",
              referenceId: saleId,
              referenceType: "FACTORY_POS_DEPOSIT",
              debitAmount: "0",
              creditAmount: depositAmt.toFixed(2),
              balance: balAfterDeposit.toFixed(2),
              currency: currencyCode || "USD",
              description: `Deposit on POS Sale ${existingSale.saleNumber} (edited)`,
            });
          }
        }

        // Step 7: Update the ERP receipt voucher if it exists
        const existingVouchers = await tx.select().from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY_POS"),
            sql`voucher_number LIKE ${'FPOS-' + saleId + '-%'}`,
          ));
        if (existingVouchers.length > 0) {
          const vchId = existingVouchers[0].id;
          const voucherCashAmt = isCredit ? depositAmt : totalAmount;
          if (cashAccountId && voucherCashAmt > 0) {
            await tx.update(vouchers)
              .set({
                voucherDate: txDate || existingSale.txDate,
                description: `Factory POS Sale ${existingSale.saleNumber}${customerName ? ` – ${customerName}` : ""}`,
                totalAmount: voucherCashAmt.toFixed(2),
                currency: currencyCode || "USD",
              })
              .where(eq(vouchers.id, vchId));

            // Replace voucher entries
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, vchId));
            const netDeposit = Math.max(0, netCash);
            if (netDeposit > 0) {
              await tx.insert(voucherEntries).values({
                voucherId: vchId,
                ledgerAccountId: parseInt(cashAccountId),
                debitAmount: netDeposit.toFixed(2),
                creditAmount: "0",
                narration: isCredit ? `Deposit on credit sale – ${existingSale.saleNumber}` : `Factory POS cash receipt – ${existingSale.saleNumber}`,
              });
            }
            for (const exp of expenseRows) {
              await tx.insert(voucherEntries).values({
                voucherId: vchId,
                ledgerAccountId: exp.accountId,
                debitAmount: exp.amount.toFixed(2),
                creditAmount: "0",
                narration: exp.description || `POS deduction – ${existingSale.saleNumber}`,
              });
            }
            const salesIncomeAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_BALE_SALES_INCOME", "Factory Bale Sales Income", "Revenue");
            await tx.insert(voucherEntries).values({
              voucherId: vchId,
              ledgerAccountId: salesIncomeAccId,
              debitAmount: "0",
              creditAmount: voucherCashAmt.toFixed(2),
              narration: `Factory POS sales income – ${existingSale.saleNumber}`,
            });
          }
        }

        return updatedSale;
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error editing factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE /api/factory/pos/sales/:id — void a factory POS sale
  app.delete("/api/factory/pos/sales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);
      const [sale] = await db.select().from(factoryPosSales).where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      if (sale.status === "VOIDED") return res.status(400).json({ message: "Sale already voided" });

      await db.transaction(async (tx: any) => {
        // Restore bales to IN_STOCK by finding bales that were sold around the sale date/product
        const items = await tx.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
        for (const item of items) {
          if (item.productId && sale.locationId) {
            // Re-open the most recently SOLD bales for that product at that location
            const soldBales = await tx
              .select({ id: factoryBales.id })
              .from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.productId, item.productId),
                eq(factoryBales.erpLocationId, sale.locationId),
                eq(factoryBales.status, "SOLD"),
              ))
              .orderBy(desc(factoryBales.id))
              .limit(item.quantity);
            const baleIds = soldBales.map((b: any) => b.id);
            if (baleIds.length > 0) {
              await tx.update(factoryBales)
                .set({ status: "IN_STOCK", updatedAt: new Date() })
                .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
            }
          }
        }
        // Mark sale as voided
        await tx.update(factoryPosSales).set({ status: "VOIDED" }).where(eq(factoryPosSales.id, saleId));
      });

      res.json({ ok: true });
    } catch (error: any) {
      console.error("Error voiding factory POS sale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── Worker Categories ──────────────────────────────────────────────────────
  app.get("/api/factory/worker-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const cats = await db.select().from(factoryWorkerCategories)
        .where(eq(factoryWorkerCategories.companyId, companyId))
        .orderBy(factoryWorkerCategories.name);
      res.json(cats);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/factory/worker-categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const body = insertFactoryWorkerCategorySchema.parse({ ...req.body, companyId });
      const [cat] = await db.insert(factoryWorkerCategories).values(body).returning();
      res.json(cat);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.patch("/api/factory/worker-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const body = insertFactoryWorkerCategorySchema.partial().parse(req.body);
      const [cat] = await db.update(factoryWorkerCategories)
        .set(body)
        .where(and(eq(factoryWorkerCategories.id, id), eq(factoryWorkerCategories.companyId, companyId)))
        .returning();
      if (!cat) return res.status(404).json({ message: "Not found" });
      res.json(cat);
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });

  app.delete("/api/factory/worker-categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      await db.delete(factoryWorkerCategories)
        .where(and(eq(factoryWorkerCategories.id, id), eq(factoryWorkerCategories.companyId, companyId)));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Financial Snapshot  —  single-request aggregates for the snapshot page
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/factory/financial-snapshot", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // ── 1. Raw material value (remaining kg × cost per kg USD) ────────────
      const rawStockRows = await db.select({
        receivedKg: factoryRawStock.receivedKg,
        usedKg: factoryRawStock.usedKg,
        costPerKg: factoryRawStock.costPerKg,
        costPerKgUsd: factoryRawStock.costPerKgUsd,
      }).from(factoryRawStock).where(eq(factoryRawStock.companyId, companyId));

      let rawMaterialValue = 0;
      for (const r of rawStockRows as any[]) {
        const remaining = parseFloat(r.receivedKg || "0") - parseFloat(r.usedKg || "0");
        const cost = parseFloat(r.costPerKgUsd || "0") || parseFloat(r.costPerKg || "0");
        rawMaterialValue += remaining * cost;
      }

      // ── 2. Mix batch value (non-finalized batches: not COMPLETED or CLOSED) ─
      const mixBatchRows = await db.select({
        totalWeightKg: factoryMixBatches.totalWeightKg,
        usedKg: factoryMixBatches.usedKg,
        costPerKg: factoryMixBatches.costPerKg,
        status: factoryMixBatches.status,
      }).from(factoryMixBatches).where(
        and(
          eq(factoryMixBatches.companyId, companyId),
          ne(factoryMixBatches.status, "COMPLETED"),
          ne(factoryMixBatches.status, "CLOSED"),
        )
      );

      let mixBatchValue = 0;
      for (const b of mixBatchRows as any[]) {
        const remaining = parseFloat(b.totalWeightKg || "0") - parseFloat(b.usedKg || "0");
        const cost = parseFloat(b.costPerKg || "0");
        if (remaining > 0) mixBatchValue += remaining * cost;
      }

      // ── 3. Bale total weight (all-time, all statuses) ─────────────────────
      const baleAgg = await db.select({
        totalWeight: sql<string>`COALESCE(SUM(CAST(${factoryBales.weightKg} AS numeric)), 0)`,
        totalCount: sql<string>`COUNT(*)`,
        totalValue: sql<string>`COALESCE(SUM(CAST(${factoryBales.totalCost} AS numeric)), 0)`,
      }).from(factoryBales).where(eq(factoryBales.companyId, companyId));

      const baleWeightTotal = parseFloat((baleAgg[0] as any)?.totalWeight || "0");
      const baleCount = parseInt((baleAgg[0] as any)?.totalCount || "0");
      const baleValueTotal = parseFloat((baleAgg[0] as any)?.totalValue || "0");

      // ── 4. Outstanding worker advances ────────────────────────────────────
      const advanceAgg = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${factoryWorkerAdvances.remainingBalance} AS numeric)), 0)`,
        count: sql<string>`COUNT(*)`,
      }).from(factoryWorkerAdvances).where(
        and(
          eq(factoryWorkerAdvances.companyId, companyId),
          eq(factoryWorkerAdvances.fullyPaid, false),
        )
      );

      const outstandingAdvances = parseFloat((advanceAgg[0] as any)?.total || "0");
      const advanceCount = parseInt((advanceAgg[0] as any)?.count || "0");

      // ── 5. Active worker count ────────────────────────────────────────────
      const workerAgg = await db.select({
        total: sql<string>`COUNT(*)`,
      }).from(factoryWorkers).where(
        and(eq(factoryWorkers.companyId, companyId), eq(factoryWorkers.active, true))
      );
      const activeWorkerCount = parseInt((workerAgg[0] as any)?.total || "0");

      // ── 6. Equity / Capital ledger accounts with balances ─────────────────
      const equityAccounts = await db.select({
        id: ledgerAccounts.id,
        name: ledgerAccounts.name,
        code: ledgerAccounts.code,
        accountType: ledgerAccounts.accountType,
        openingBalance: ledgerAccounts.openingBalance,
        openingBalanceSide: ledgerAccounts.openingBalanceSide,
      }).from(ledgerAccounts).where(
        and(
          eq(ledgerAccounts.companyId, companyId),
          or(
            sql`LOWER(${ledgerAccounts.accountType}) IN ('equity', 'capital', 'owner equity', 'owners equity', 'share capital')`,
            sql`LOWER(${ledgerAccounts.name}) ILIKE '%capital%'`,
          )
        )
      );

      // Get voucher entries for equity accounts
      let capitalTotal = 0;
      if ((equityAccounts as any[]).length > 0) {
        const equityIds = (equityAccounts as any[]).map((a: any) => a.id);
        const equityEntries = await db.select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debit: sql<string>`SUM(CAST(${voucherEntries.debitAmount} AS numeric))`,
          credit: sql<string>`SUM(CAST(${voucherEntries.creditAmount} AS numeric))`,
        }).from(voucherEntries)
          .innerJoin(vouchers, and(eq(voucherEntries.voucherId, vouchers.id), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)))
          .where(inArray(voucherEntries.ledgerAccountId, equityIds))
          .groupBy(voucherEntries.ledgerAccountId);

        const balMap = new Map<number, { debit: number; credit: number }>();
        for (const e of equityEntries as any[]) {
          balMap.set(e.ledgerAccountId, { debit: parseFloat(e.debit || "0"), credit: parseFloat(e.credit || "0") });
        }

        for (const acc of equityAccounts as any[]) {
          const opening = parseFloat(acc.openingBalance || "0");
          const openingSide = acc.openingBalanceSide === "Dr" ? 1 : acc.openingBalanceSide === "Cr" ? -1 : -1;
          const signedOpening = opening * openingSide;
          const bal = balMap.get(acc.id) || { debit: 0, credit: 0 };
          const net = signedOpening + bal.debit - bal.credit;
          capitalTotal += net;
        }
      }

      res.json({
        rawMaterialValue: round2(rawMaterialValue),
        mixBatchValue: round2(mixBatchValue),
        baleWeightTotal: round2(baleWeightTotal),
        baleCount,
        baleValueTotal: round2(baleValueTotal),
        outstandingAdvances: round2(outstandingAdvances),
        advanceCount,
        activeWorkerCount,
        capitalTotal: round2(capitalTotal),
        equityAccounts: (equityAccounts as any[]).map((a: any) => ({ id: a.id, name: a.name, code: a.code, accountType: a.accountType })),
      });
    } catch (error: any) {
      console.error("Factory financial-snapshot error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Factory Net Position  —  "What We Have" vs "What We Owe"
  // Same logic as ERP /api/stats/net-profit but uses factory supplier tables
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/api/factory/net-position", requireAuth, async (req: any, res: any) => {
    try {
      // Resolve factory company ID the same way my-access does:
      // 1. pinned factoryCompanyId (if it's a factory-type company)
      // 2. currentCompanyId (if it's factory-type)
      // 3. first active factory-type company in DB
      // 4. fall back to currentCompanyId
      let companyId: number | null = (req.session as any).factoryCompanyId || null;

      if (!companyId) {
        const currentId = (req.session as any).currentCompanyId;
        if (currentId) {
          const [cur] = await db.select({ id: companies.id, companyType: companies.companyType })
            .from(companies).where(eq(companies.id, currentId));
          if (cur?.companyType === "factory") companyId = cur.id;
        }
      }

      if (!companyId) {
        const [fc] = await db.select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.companyType, "factory"), eq(companies.active, true)))
          .limit(1);
        if (fc) companyId = fc.id;
      }

      if (!companyId) companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Pin it for subsequent requests this session
      (req.session as any).factoryCompanyId = companyId;

      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // ── 1. Factory supplier balances (What We Owe) ──────────────────────
      const suppliersList = await db.select().from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const allContainersF = await db.select().from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const allPaymentsF = await db.select().from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId));

      const allFxTransfersF = await db.select().from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId));

      // Additional charge sources — must match buildBrokerStatement exactly
      const allOffloadChargesF = await db.select({
        supplierId: factoryOffloadAdditionalCharges.supplierId,
        amount: factoryOffloadAdditionalCharges.amount,
        currencyCode: factoryOffloadAdditionalCharges.currencyCode,
      }).from(factoryOffloadAdditionalCharges)
        .where(eq(factoryOffloadAdditionalCharges.companyId, companyId));

      const allContainerOtherChargesF = await db.select({
        supplierId: factoryContainers.supplierId,
        amount: factoryContainerOtherCharges.amount,
        currencyCode: factoryContainerOtherCharges.currencyCode,
        containerCurrencyCode: factoryContainers.currencyCode,
      }).from(factoryContainerOtherCharges)
        .innerJoin(factoryContainers, eq(factoryContainerOtherCharges.containerId, factoryContainers.id))
        .where(eq(factoryContainerOtherCharges.companyId, companyId));

      const allColOtherChargesF = await db.select({
        otherChargesSupplierId: factoryContainers.otherChargesSupplierId,
        otherCharges: factoryContainers.otherCharges,
        otherChargesCurrencyCode: factoryContainers.otherChargesCurrencyCode,
      }).from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          sql`${factoryContainers.otherChargesSupplierId} IS NOT NULL`,
          sql`CAST(COALESCE(${factoryContainers.otherCharges}, '0') AS numeric) > 0`
        ));

      // Voucher-based payments (exclude auto-generated FACTORY-PAY-* and optional vouchers)
      const allSupplierIds = (suppliersList as any[]).map((s: any) => s.id);
      const voucherPaidBySupplier: Record<number, number> = {};
      // Per-currency voucher amounts needed for broker consolidated calculation
      const voucherPaidByCurrencyBySupplierId: Record<number, Record<string, number>> = {};
      if (allSupplierIds.length > 0) {
        const voucherRows = await db
          .select({
            factorySupplierId: voucherEntries.factorySupplierId,
            debitAmount: voucherEntries.debitAmount,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
            optional: vouchers.optional,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(
            inArray(voucherEntries.factorySupplierId, allSupplierIds),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
            sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
          ));
        for (const row of voucherRows as any[]) {
          const sid = row.factorySupplierId;
          if (!sid) continue;
          if (row.optional) continue; // optional vouchers don't affect the balance
          const amt = parseFloat(row.debitAmount || "0");
          const fx = parseFloat(row.exchangeRate || "1") || 1;
          const cc = row.currency || "USD";
          const usd = cc === "USD" ? amt : amt / fx;
          voucherPaidBySupplier[sid] = (voucherPaidBySupplier[sid] || 0) + usd;
          if (!voucherPaidByCurrencyBySupplierId[sid]) voucherPaidByCurrencyBySupplierId[sid] = {};
          voucherPaidByCurrencyBySupplierId[sid][cc] = (voucherPaidByCurrencyBySupplierId[sid][cc] || 0) + amt;
        }
      }

      // Identify brokers (suppliers that have children linked via parentId)
      // and linked suppliers (those with parentId set pointing to a broker)
      const brokerIds = new Set<number>();
      const linkedSupplierParent = new Map<number, number>(); // childId → brokerId
      for (const s of suppliersList as any[]) {
        if (s.parentId) {
          linkedSupplierParent.set(s.id, s.parentId);
          brokerIds.add(s.parentId);
        }
      }

      // Pre-group children IDs for each broker
      const brokerChildren = new Map<number, number[]>(); // brokerId → [childIds]
      for (const [childId, brokerId] of linkedSupplierParent) {
        if (!brokerChildren.has(brokerId)) brokerChildren.set(brokerId, []);
        brokerChildren.get(brokerId)!.push(childId);
      }

      // Broker consolidated balance: calculate per-currency running balance for the
      // broker + all linked suppliers, then apply approximate FX rates to get one USD total.
      // Formula: USD_balance + (EUR_balance × 1.16) + (AUD_balance × 0.71)
      const calcBrokerApproxUsd = (brokerId: number): number => {
        const groupIds = [brokerId, ...(brokerChildren.get(brokerId) || [])];
        const buckets: Record<string, number> = {};
        const add = (cc: string, amt: number) => { buckets[cc] = (buckets[cc] || 0) + amt; };

        // Opening balances for all group members (stored in USD)
        for (const s of suppliersList as any[]) {
          if (!groupIds.includes(s.id)) continue;
          const ob = parseFloat(s.openingBalance || "0");
          if (ob !== 0) add("USD", ob);
        }

        // Containers (goods + freight per currency)
        // USD commission from linked (child) suppliers also flows into the broker's USD bucket.
        for (const c of allContainersF as any[]) {
          if (!groupIds.includes(c.supplierId)) continue;
          const cc = c.currencyCode || "USD";
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          add(cc, kg * rate);
          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          if (freight > 0) add(freightCc, freight);
          // USD commission from linked (child) suppliers → broker USD bucket
          // (broker's own containers and non-USD commission stay excluded)
          if (c.supplierId !== brokerId && linkedSupplierParent.has(c.supplierId) && linkedSupplierParent.get(c.supplierId) === brokerId) {
            const commAmt = parseFloat(c.commissionAmount || "0");
            if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
              add("USD", commAmt);
            }
          }
        }

        // Offload additional charges (per-supplier, in their own currency)
        for (const oc of allOffloadChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || "USD";
          add(cc, parseFloat(oc.amount || "0"));
        }

        // Container other charges table (linked via containerId → supplierId)
        for (const oc of allContainerOtherChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
          add(cc, parseFloat(oc.amount || "0"));
        }

        // Container column other_charges (where otherChargesSupplierId is in group)
        for (const oc of allColOtherChargesF as any[]) {
          if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
          const cc = oc.otherChargesCurrencyCode || "USD";
          add(cc, parseFloat(oc.otherCharges || "0"));
        }

        // Direct payments (reduce balance in payment currency)
        for (const p of allPaymentsF as any[]) {
          if (!groupIds.includes(p.supplierId)) continue;
          const cc = p.currencyCode || "USD";
          add(cc, -parseFloat(p.amount || "0"));
        }

        // Voucher payments per currency
        for (const sid of groupIds) {
          const currMap = voucherPaidByCurrencyBySupplierId[sid] || {};
          for (const [cc, amt] of Object.entries(currMap)) {
            add(cc, -amt);
          }
        }

        // FX transfers
        for (const t of allFxTransfersF as any[]) {
          const fromCc = t.fromCurrencyCode || "USD";
          const fromAmt = parseFloat(t.fromAmount || "0");
          const toUsd = parseFloat(t.toAmountUsd || "0");
          const isFromBroker = t.fromSupplierId === brokerId;
          // Non-USD source: subtract from the foreign-currency bucket
          if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
            add(fromCc, -fromAmt);
          }
          // FX In to broker pool
          if (t.toSupplierId === brokerId) {
            add("USD", toUsd);
          }
          // FX Out from broker in USD (broker redistributes USD out of its pool)
          if (isFromBroker && fromCc === "USD") {
            add("USD", -fromAmt);
          }
        }

        const usdBal = buckets["USD"] || 0;
        const eurBal = buckets["EUR"] || 0;
        const audBal = buckets["AUD"] || 0;
        return usdBal + (eurBal * 1.16) + (audBal * 0.71);
      };

      // Extended broker calculation that returns both the total and a line-by-line breakdown
      const calcBrokerDetail = (brokerId: number): {
        total: number;
        breakdown: { label: string; native: string; usd: number }[];
      } => {
        const groupIds = [brokerId, ...(brokerChildren.get(brokerId) || [])];
        const buckets: Record<string, number> = {};
        const add = (cc: string, amt: number) => { buckets[cc] = (buckets[cc] || 0) + amt; };
        const lines: { label: string; native: string; usd: number }[] = [];

        // Opening balances
        let obTotal = 0;
        for (const s of suppliersList as any[]) {
          if (!groupIds.includes(s.id)) continue;
          const ob = parseFloat(s.openingBalance || "0");
          if (ob !== 0) { add("USD", ob); obTotal += ob; }
        }
        if (obTotal !== 0) lines.push({ label: "Opening Balance", native: `$${obTotal.toFixed(2)}`, usd: obTotal });

        // Containers: goods + freight per currency + USD commission from children
        const containersByCurrency: Record<string, number> = {};
        let commTotal = 0;
        let usdFreightTotal = 0;
        for (const c of allContainersF as any[]) {
          if (!groupIds.includes(c.supplierId)) continue;
          const cc = c.currencyCode || "USD";
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const goodsAmt = kg * rate;
          add(cc, goodsAmt);
          containersByCurrency[cc] = (containersByCurrency[cc] || 0) + goodsAmt;

          const freight = parseFloat(c.freight || "0");
          const freightCc = c.freightCurrencyCode || cc;
          if (freight > 0) {
            add(freightCc, freight);
            containersByCurrency[freightCc] = (containersByCurrency[freightCc] || 0) + freight;
          }

          if (c.supplierId !== brokerId && linkedSupplierParent.has(c.supplierId) && linkedSupplierParent.get(c.supplierId) === brokerId) {
            const commAmt = parseFloat(c.commissionAmount || "0");
            if (commAmt > 0 && (c.commissionCurrencyCode || "USD") === "USD") {
              add("USD", commAmt);
              commTotal += commAmt;
              usdFreightTotal += 0; // tracked separately below
            }
          }
        }
        for (const [cc, amt] of Object.entries(containersByCurrency)) {
          if (Math.abs(amt) > 0.01) lines.push({ label: `Container Goods + Freight (${cc})`, native: `${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? amt : 0 });
        }
        if (commTotal > 0) lines.push({ label: "Commission from Linked Suppliers", native: `$${commTotal.toFixed(2)}`, usd: commTotal });

        // Offload additional charges (match buildBrokerStatement)
        const offloadByCurrency: Record<string, number> = {};
        for (const oc of allOffloadChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || "USD";
          const amt = parseFloat(oc.amount || "0");
          add(cc, amt);
          offloadByCurrency[cc] = (offloadByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(offloadByCurrency)) {
          if (amt > 0.01) lines.push({ label: `Offload Additional Charges (${cc})`, native: `${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? amt : 0 });
        }

        // Container other charges table (linked via containerId → supplierId)
        const containerOcByCurrency: Record<string, number> = {};
        for (const oc of allContainerOtherChargesF as any[]) {
          if (!groupIds.includes(oc.supplierId)) continue;
          const cc = oc.currencyCode || oc.containerCurrencyCode || "USD";
          const amt = parseFloat(oc.amount || "0");
          add(cc, amt);
          containerOcByCurrency[cc] = (containerOcByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(containerOcByCurrency)) {
          if (amt > 0.01) lines.push({ label: `Container Other Charges (${cc})`, native: `${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? amt : 0 });
        }

        // Container column other_charges (otherChargesSupplierId in group)
        const colOcByCurrency: Record<string, number> = {};
        for (const oc of allColOtherChargesF as any[]) {
          if (!groupIds.includes(oc.otherChargesSupplierId)) continue;
          const cc = oc.otherChargesCurrencyCode || "USD";
          const amt = parseFloat(oc.otherCharges || "0");
          add(cc, amt);
          colOcByCurrency[cc] = (colOcByCurrency[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(colOcByCurrency)) {
          if (amt > 0.01) lines.push({ label: `Other Charges — Column (${cc})`, native: `${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? amt : 0 });
        }

        // Direct payments
        let payTotal: Record<string, number> = {};
        for (const p of allPaymentsF as any[]) {
          if (!groupIds.includes(p.supplierId)) continue;
          const cc = p.currencyCode || "USD";
          const amt = parseFloat(p.amount || "0");
          add(cc, -amt);
          payTotal[cc] = (payTotal[cc] || 0) + amt;
        }
        for (const [cc, amt] of Object.entries(payTotal)) {
          if (amt > 0.01) lines.push({ label: `Payments Made (${cc})`, native: `-${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? -amt : 0 });
        }

        // Voucher payments
        let voucherTotals: Record<string, number> = {};
        for (const sid of groupIds) {
          const currMap = voucherPaidByCurrencyBySupplierId[sid] || {};
          for (const [cc, amt] of Object.entries(currMap)) {
            add(cc, -amt);
            voucherTotals[cc] = (voucherTotals[cc] || 0) + amt;
          }
        }
        for (const [cc, amt] of Object.entries(voucherTotals)) {
          if (amt > 0.01) lines.push({ label: `Voucher Payments (${cc})`, native: `-${amt.toFixed(2)} ${cc}`, usd: cc === "USD" ? -amt : 0 });
        }

        // FX transfers
        let fxInTotal = 0;
        let fxOutUsd = 0;
        const fxOutNative: Record<string, number> = {};
        for (const t of allFxTransfersF as any[]) {
          const fromCc = t.fromCurrencyCode || "USD";
          const fromAmt = parseFloat(t.fromAmount || "0");
          const toUsd = parseFloat(t.toAmountUsd || "0");
          const isFromBroker = t.fromSupplierId === brokerId;
          if (groupIds.includes(t.fromSupplierId) && fromCc !== "USD") {
            add(fromCc, -fromAmt);
            fxOutNative[fromCc] = (fxOutNative[fromCc] || 0) + fromAmt;
          }
          if (t.toSupplierId === brokerId) {
            add("USD", toUsd);
            fxInTotal += toUsd;
          }
          if (isFromBroker && fromCc === "USD") {
            add("USD", -fromAmt);
            fxOutUsd += fromAmt;
          }
        }
        if (fxInTotal > 0) lines.push({ label: "FX Received (USD)", native: `$${fxInTotal.toFixed(2)}`, usd: fxInTotal });
        if (fxOutUsd > 0) lines.push({ label: "FX Sent Out (USD)", native: `-$${fxOutUsd.toFixed(2)}`, usd: -fxOutUsd });
        for (const [cc, amt] of Object.entries(fxOutNative)) {
          if (amt > 0.01) lines.push({ label: `FX Converted Out (${cc})`, native: `-${amt.toFixed(2)} ${cc}`, usd: 0 });
        }

        const usdBal = buckets["USD"] || 0;
        const eurBal = buckets["EUR"] || 0;
        const audBal = buckets["AUD"] || 0;

        if (Math.abs(eurBal) > 0.01) lines.push({ label: `EUR Net Balance × 1.16`, native: `${eurBal.toFixed(2)} EUR`, usd: eurBal * 1.16 });
        if (Math.abs(audBal) > 0.01) lines.push({ label: `AUD Net Balance × 0.71`, native: `${audBal.toFixed(2)} AUD`, usd: audBal * 0.71 });
        lines.push({ label: "USD Net Balance", native: `$${usdBal.toFixed(2)}`, usd: usdBal });

        const total = usdBal + (eurBal * 1.16) + (audBal * 0.71);
        return { total, breakdown: lines };
      };

      const supplierItems: { name: string; balanceUsd: number; breakdown?: { label: string; native: string; usd: number }[] }[] = [];
      let totalSupplierLiabilities = 0;

      // Track which broker entries have already been added (avoid duplicates)
      const processedBrokers = new Set<number>();

      for (const s of suppliersList as any[]) {
        // Linked suppliers: their balances are rolled into their parent broker — skip individually
        if (linkedSupplierParent.has(s.id)) continue;

        // Brokers: use consolidated multi-currency approximate USD balance
        if (brokerIds.has(s.id) && !processedBrokers.has(s.id)) {
          processedBrokers.add(s.id);
          const { total: approxUsd, breakdown } = calcBrokerDetail(s.id);
          const rounded = round2(approxUsd);
          if (Math.abs(rounded) > 0.01) {
            supplierItems.push({ name: s.name, balanceUsd: rounded, breakdown });
            if (rounded > 0) totalSupplierLiabilities += rounded;
          }
          continue;
        }

        // Standalone (non-broker) suppliers: use existing USD-converted calculation
        const sc = allContainersF.filter((c: any) => c.supplierId === s.id);
        const containerValue = sc.reduce((sum: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const fx = parseFloat(c.fxRateToUsd || "1");
          const cc = c.currencyCode || "USD";
          const fcc = c.freightCurrencyCode || cc;
          const freightInCC = fcc === cc ? freight : 0;
          const freightUsd = fcc === "USD" && fcc !== cc ? freight : 0;
          return sum + (kg * rate + freightInCC) * fx + freightUsd;
        }, 0);

        const commission = sc.reduce((sum: number, c: any) => {
          const amt = parseFloat(c.commissionAmount || "0");
          if (amt <= 0) return sum;
          const commCc = c.commissionCurrencyCode || c.currencyCode || "USD";
          const fx = parseFloat(c.fxRateToUsd || "1");
          return sum + (commCc === "USD" ? amt : amt * fx);
        }, 0);

        const otherCharges = allContainersF.reduce((sum: number, c: any) => {
          if (c.otherChargesSupplierId !== s.id) return sum;
          const oc = parseFloat(c.otherCharges || "0");
          if (oc <= 0) return sum;
          const ocCc = c.otherChargesCurrencyCode || "USD";
          const fx = ocCc === "USD" ? 1 : parseFloat(c.fxRateToUsd || "1");
          return sum + oc * fx;
        }, 0);

        let fxNet = 0;
        for (const t of allFxTransfersF as any[]) {
          if (t.toSupplierId === s.id) fxNet += parseFloat(t.toAmountUsd || "0");
          if (t.fromSupplierId === s.id) fxNet -= parseFloat(t.toAmountUsd || "0");
        }

        const payments = allPaymentsF
          .filter((p: any) => p.supplierId === s.id)
          .reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);

        const voucherPaid = voucherPaidBySupplier[s.id] || 0;
        const balance = round2(
          parseFloat(s.openingBalance || "0") + containerValue + commission + otherCharges + fxNet - payments - voucherPaid
        );

        if (Math.abs(balance) > 0.01) {
          supplierItems.push({ name: s.name, balanceUsd: balance });
          if (balance > 0) totalSupplierLiabilities += balance;
        }
      }

      // ── 2. ERP ledger account balances for the factory company ──────────
      const factoryAccounts = await db.select().from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));

      const factoryVouchers = await db.select({ id: vouchers.id })
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)));

      const fVoucherIds = factoryVouchers.map((v: any) => v.id);
      const factoryEntries = fVoucherIds.length > 0
        ? await db.select().from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, fVoucherIds))
        : [];

      const accBalances = new Map<number, { debit: number; credit: number }>();
      for (const e of factoryEntries as any[]) {
        if (!e.ledgerAccountId) continue;
        const cur = accBalances.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
        accBalances.set(e.ledgerAccountId, {
          debit: cur.debit + parseFloat(e.debitAmount || "0"),
          credit: cur.credit + parseFloat(e.creditAmount || "0"),
        });
      }

      // ── 2b. Classify accounts using the shared ERP formula ─────────────────
      // Factory-specific clearing/cost codes must not appear in net position:
      //   FACTORY_IMPORT_COST   – Dr side of goods-received journal; liability already in supplier balances
      //   FACTORY_CHARGES_PAYABLE – Dr side of other-charges journal; cost entry, not an asset
      //   FREIGHT / OC_OTHER_CHARGE – factory cost clearing codes
      const factoryExcludedCodes = new Set([
        "FACTORY_IMPORT_COST",
        "FACTORY_CHARGES_PAYABLE",
        "FACTORY_OC_EXPENSE",
        "OC_OTHER_CHARGE",
        "PRODUCTION_ADJUSTMENT",
        "CONSUMPTION_EXPENSE",
        "FREIGHT",
      ]);

      const classified = classifyNetPositionAccounts(
        factoryAccounts as AccountLike[],
        accBalances,
        {
          additionalExcludedCodes: factoryExcludedCodes,
          // Supplier-type ledger accounts excluded: factory supplier balances are
          // calculated separately above from factorySuppliers / factoryContainers.
          includeSupplierTypeAccounts: false,
        },
      );

      // ── 2c. Customer balances — ALL customers, authoritative formula ─────────
      // Customer ledger accounts (linked via customers.ledgerAccountId) capture only
      // a subset of the true customer balance: CHARGE-* freight/clearance vouchers.
      // The bulk of the balance lives in customer_orders (FINALIZED grandTotal).
      // To get the correct figure we:
      //   a) exclude customer-owned ledger accounts from the ledger classification, and
      //   b) compute every customer's balance via the same formula as the Customers page.
      const allCustomersForNP = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), isNull(customers.deletedAt)));

      // Build a set of ledger account IDs owned by customers so we can strip them
      // from the ledger classification output (prevents double-counting).
      const customerLedgerIds = new Set<number>(
        (allCustomersForNP as any[])
          .filter((c: any) => c.ledgerAccountId)
          .map((c: any) => c.ledgerAccountId as number),
      );

      // Strip customer-linked accounts from the classifier output.
      const ledgerForUs = classified.forUsAccounts.filter((a: any) => !customerLedgerIds.has(a.id));
      const ledgerOnUsRaw = classified.onUsAccounts.filter((a: any) => !customerLedgerIds.has(a.id));

      // ── Strip any ledger-based "Payroll Payable" accounts ─────────────────────
      // The authoritative source for payroll payable is employees.currentBalance
      // (tracked directly via employeeId on voucher entries, not via a ledger account).
      // Any ledger account named/coded as "Payroll Payable" duplicates that and
      // must be excluded here — the single correct figure is injected below.
      const ledgerOnUs = ledgerOnUsRaw.filter((a: any) => {
        const nameLower = (a.name || "").toLowerCase();
        const code = (a.code || "").toUpperCase();
        const isPayrollPayable =
          nameLower.includes("payroll payable") ||
          code === "PAYROLL_PAYABLE" ||
          code === "PAY_PAYABLE";
        return !isPayrollPayable;
      });
      const ledgerForUsTotal = round2(ledgerForUs.reduce((s: number, a: any) => s + a.value, 0));
      const ledgerOnUsTotal = round2(ledgerOnUs.reduce((s: number, a: any) => s + a.value, 0));

      const customerItems: { name: string; balanceUsd: number }[] = [];

      if ((allCustomersForNP as any[]).length > 0) {
        const cIds = (allCustomersForNP as any[]).map((c: any) => c.id);
        const custLedgerIds = [...customerLedgerIds];

        // Sales totals from FINALIZED orders (these include CHARGE-* freight amounts
        // so CHARGE-* vouchers must NOT be added separately — they are already in grandTotal).
        const cSalesRows = await db.select({
          customerId: customerOrders.customerId,
          total: sql<string>`COALESCE(SUM(CAST(${customerOrders.grandTotal} AS numeric)), 0)`,
        })
          .from(customerOrders)
          .where(and(
            inArray(customerOrders.customerId, cIds),
            eq(customerOrders.companyId, companyId),
            eq(customerOrders.status, "FINALIZED"),
          ))
          .groupBy(customerOrders.customerId);

        const cSalesMap = new Map(cSalesRows.map((r: any) => [r.customerId, parseFloat(r.total || "0")]));

        // Non-invoice balance adjustments (manual Dr/Cr adjustments, not order-based).
        const cNonInvRows = await db.select({
          customerId: customerBalances.customerId,
          net: sql<string>`COALESCE(SUM(CAST(${customerBalances.debitAmount} AS numeric) - CAST(${customerBalances.creditAmount} AS numeric)), 0)`,
        })
          .from(customerBalances)
          .where(and(
            inArray(customerBalances.customerId, cIds),
            eq(customerBalances.companyId, companyId),
            sql`${customerBalances.referenceType} IS DISTINCT FROM 'INVOICE'`,
          ))
          .groupBy(customerBalances.customerId);

        const cNonInvMap = new Map(cNonInvRows.map((r: any) => [r.customerId, parseFloat(r.net || "0")]));

        // Voucher entries via ledgerAccountId — EXCLUDE CHARGE-* (already in salesTotal).
        const cLedgerVoucherRows = custLedgerIds.length > 0
          ? await db.select({
              ledgerAccountId: voucherEntries.ledgerAccountId,
              net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
            })
              .from(voucherEntries)
              .innerJoin(vouchers, and(
                eq(voucherEntries.voucherId, vouchers.id),
                eq(vouchers.companyId, companyId),
                sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
              ))
              .where(inArray(voucherEntries.ledgerAccountId as any, custLedgerIds))
              .groupBy(voucherEntries.ledgerAccountId)
          : [];
        const cLedgerVoucherMap = new Map(
          (cLedgerVoucherRows as any[]).map((r: any) => [r.ledgerAccountId, parseFloat(r.net || "0")]),
        );

        // Voucher entries directly linked via customerId (no ledgerAccountId) — EXCLUDE CHARGE-*.
        const cVoucherRows = await db.select({
          customerId: voucherEntries.customerId,
          net: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS numeric) - CAST(${voucherEntries.creditAmount} AS numeric)), 0)`,
        })
          .from(voucherEntries)
          .innerJoin(vouchers, and(
            eq(voucherEntries.voucherId, vouchers.id),
            eq(vouchers.companyId, companyId),
            sql`${vouchers.voucherNumber} NOT LIKE 'CHARGE-%'`,
          ))
          .where(and(
            inArray(voucherEntries.customerId as any, cIds),
            isNull(voucherEntries.ledgerAccountId),
          ))
          .groupBy(voucherEntries.customerId);

        const cVoucherMap = new Map((cVoucherRows as any[]).map((r: any) => [r.customerId, parseFloat(r.net || "0")]));

        for (const c of allCustomersForNP as any[]) {
          const salesTotal = cSalesMap.get(c.id) ?? 0;
          const nonInvNet = cNonInvMap.get(c.id) ?? 0;
          const ledgerVoucherNet = c.ledgerAccountId ? (cLedgerVoucherMap.get(c.ledgerAccountId) ?? 0) : 0;
          const directVoucherNet = cVoucherMap.get(c.id) ?? 0;
          const voucherNet = ledgerVoucherNet + directVoucherNet;
          const opening = parseFloat(c.openingBalance || "0");
          const openingSide = c.openingBalanceSide || "Dr";
          const totalBalance = (openingSide === "Dr" ? opening : -opening) + salesTotal + nonInvNet + voucherNet;
          if (Math.abs(totalBalance) > 0.01) {
            customerItems.push({ name: c.legalName || c.name || `Customer #${c.id}`, balanceUsd: round2(totalBalance) });
          }
        }
      }

      // ── 3. Inventory (Stock In Hand) — direct SQL sum of production price ──────
      // Single query: sum production_price for every IN_STOCK bale that has a
      // matched product, scoped strictly to companyId.
      // Production price (cost to manufacture) is used here, not selling price.
      const invResult = await db.execute(sql`
        SELECT COALESCE(SUM(p.production_price::numeric), 0) AS total
        FROM   factory_bales   b
        JOIN   factory_bale_products p ON p.id = b.product_id
        WHERE  b.company_id = ${companyId}
          AND  b.status     = 'IN_STOCK'
          AND  p.company_id = ${companyId}
      `);
      const invRow = ((invResult as any).rows ?? (invResult as any))[0] ?? {};
      const inventorySellValue = round2(parseFloat(String(invRow?.total ?? "0")));

      // ── 3b. Raw material stock value — direct SQL, mirrors /api/factory/raw-stock
      const rawResult = await db.execute(sql`
        SELECT
          fc.supplier_id,
          SUM(frs.received_kg::numeric)                                            AS total_recv,
          SUM(frs.used_kg::numeric)                                                AS total_used,
          SUM(frs.received_kg::numeric *
              COALESCE(NULLIF(frs.cost_per_kg_usd::numeric, 0), frs.cost_per_kg::numeric, 0))
            / NULLIF(SUM(frs.received_kg::numeric), 0)                             AS avg_cpk_usd
        FROM   factory_raw_stock   frs
        JOIN   factory_containers  fc  ON fc.id  = frs.container_id
        WHERE  frs.company_id = ${companyId}
          AND  fc.status     != 'DELETED'
        GROUP  BY fc.supplier_id
      `);
      const rawRows: any[] = (rawResult as any).rows ?? (rawResult as any);

      const adjResult = await db.execute(sql`
        SELECT supplier_id, type, kg::numeric AS kg, cost_per_kg::numeric AS cpk
        FROM   factory_raw_material_adjustments
        WHERE  company_id = ${companyId}
      `);
      const adjRows: any[] = (adjResult as any).rows ?? (adjResult as any);

      // Build per-supplier totals (same weighted-average logic as the route)
      type SupMap = { recv: number; used: number; cpkUsd: number };
      const supMap = new Map<string, SupMap>();
      for (const r of rawRows) {
        const key    = r.supplier_id ? `s${r.supplier_id}` : `u`;
        const recv   = parseFloat(String(r.total_recv  ?? "0")) || 0;
        const used   = parseFloat(String(r.total_used  ?? "0")) || 0;
        const cpkUsd = parseFloat(String(r.avg_cpk_usd ?? "0")) || 0;
        supMap.set(key, { recv, used, cpkUsd });
      }
      for (const a of adjRows) {
        const key    = a.supplier_id ? `s${a.supplier_id}` : `MANUAL`;
        const kg     = parseFloat(String(a.kg  ?? "0")) || 0;
        const cpk    = parseFloat(String(a.cpk ?? "0")) || 0;
        const isAdd  = a.type === "ADD";
        const ex     = supMap.get(key);
        if (ex) {
          if (isAdd) {
            const prevVal = ex.recv * ex.cpkUsd;
            ex.recv   += kg;
            ex.cpkUsd  = ex.recv > 0 ? (prevVal + kg * cpk) / ex.recv : 0;
          } else {
            ex.used += kg;
          }
        } else if (isAdd) {
          supMap.set(key, { recv: kg, used: 0, cpkUsd: cpk });
        }
      }
      let rawTotal = 0;
      for (const s of supMap.values()) {
        const val = (s.recv - s.used) * s.cpkUsd;
        if (val > 0) rawTotal += val;
      }
      const rawMaterialStockValue = round2(rawTotal);

      // ── 3b. Factory Stock OTW — containers in transit (PENDING / IN_TRANSIT / ARRIVED) ──
      // Mirrors the FactoryStockOTW page formula: per-currency goods+freight+commission+other charges,
      // then converted to approx USD via: USD + (AUD × 0.71) + (EUR × 1.16)
      const otwStatuses = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);
      const otwCurrBuckets: Record<string, number> = {};
      const otwAdd = (cc: string, amt: number) => {
        if (amt > 0 && cc) otwCurrBuckets[cc] = (otwCurrBuckets[cc] || 0) + amt;
      };
      for (const c of allContainersF as any[]) {
        if (!otwStatuses.has(c.status)) continue;
        const containerCcy = c.currencyCode || "USD";
        // Goods: confirmed finalPayableAmount takes priority, else ratePerKg × totalKg
        const goods = parseFloat(c.finalPayableAmount || "0") > 0
          ? parseFloat(c.finalPayableAmount)
          : parseFloat(c.ratePerKg || "0") * parseFloat(c.totalKg || "0");
        otwAdd(containerCcy, goods);
        // Freight
        const freightCcy = c.freightCurrencyCode || containerCcy;
        otwAdd(freightCcy, parseFloat(c.freight || "0"));
        // Commission
        const commCcy = c.commissionCurrencyCode || "USD";
        otwAdd(commCcy, parseFloat(c.commissionAmount || "0"));
        // Other charges (treated as container currency, matching frontend)
        otwAdd(containerCcy, parseFloat(c.otherCharges || "0"));
      }
      const otwUsd = otwCurrBuckets["USD"] || 0;
      const otwEur = otwCurrBuckets["EUR"] || 0;
      const otwAud = otwCurrBuckets["AUD"] || 0;
      const stockOtwValue = round2(otwUsd + (otwAud * 0.71) + (otwEur * 1.16));

      // ── 3c. Balance on Table — material in process (mix batch input minus bale output) ──
      // Mirrors the production-value-report formula: all-time totals, no date filter.
      const mixSumResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(total_weight_kg::numeric), 0) AS total_mix_kg,
          COALESCE(SUM(total_cost::numeric),      0) AS total_mix_cost
        FROM factory_mix_batches
        WHERE company_id = ${companyId}
      `);
      const mixSumRow = ((mixSumResult as any).rows ?? (mixSumResult as any))[0] ?? {};
      const totalMixKg   = parseFloat(String(mixSumRow.total_mix_kg   ?? "0")) || 0;
      const totalMixCost = parseFloat(String(mixSumRow.total_mix_cost  ?? "0")) || 0;
      const blendedCpk   = totalMixKg > 0 ? totalMixCost / totalMixKg : 0;

      // Split bales: wipers/garbage (by category name) vs regular
      const baleSumResult = await db.execute(sql`
        SELECT
          COALESCE(SUM(b.weight_kg::numeric), 0)                                          AS total_kg,
          COALESCE(SUM(CASE WHEN lower(c.name) ~ '(wiper|garbage|rag)'
                            THEN b.weight_kg::numeric ELSE 0 END), 0)                     AS wg_kg
        FROM   factory_bales        b
        LEFT   JOIN factory_bale_products  p ON p.id = b.product_id
        LEFT   JOIN factory_categories     c ON c.id = p.category_id
        WHERE  b.company_id = ${companyId}
          AND  b.status NOT IN ('DELETED', 'REMOVED')
      `);
      const baleSumRow  = ((baleSumResult as any).rows ?? (baleSumResult as any))[0] ?? {};
      const totalBaleKg = parseFloat(String(baleSumRow.total_kg ?? "0")) || 0;
      const totalWgKg   = parseFloat(String(baleSumRow.wg_kg    ?? "0")) || 0;

      const botWeightKg = totalMixKg - totalBaleKg;
      const balanceOnTableValue = round2(Math.max(botWeightKg, 0) * blendedCpk);

      // ── 4. Pending, Verified & Loading orders (upcoming receivables) ──────────
      // Fetched here (before forUsTotal) so PENDING/VERIFIED totals can be
      // included in "What We Have". LOADING is shown for reference only.
      //
      // No double-counting risk: once an order is PENDING or VERIFIED the
      // bales allocated to it are set to RESERVED_FOR_ORDER status, which
      // means they are already excluded from the IN_STOCK baleInventoryValue.
      const pendingVerifiedRows = await db
        .select({
          id: customerOrders.id,
          status: customerOrders.status,
          orderDate: customerOrders.orderDate,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerId: customerOrders.customerId,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .innerJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(
          eq(customerOrders.companyId, companyId),
          inArray(customerOrders.status, ["PENDING", "VERIFIED", "LOADING"]),
        ))
        .orderBy(desc(customerOrders.orderDate));

      const mapOrder = (r: any) => ({
        id: r.id,
        customerName: r.customerName || `Customer #${r.customerId}`,
        orderDate: r.orderDate,
        grandTotal: round2(parseFloat(r.grandTotal || "0")),
        totalQtyBales: r.totalQtyBales ?? 0,
      });

      const pendingOrders  = (pendingVerifiedRows as any[]).filter(r => r.status === "PENDING").map(mapOrder);
      const verifiedOrders = (pendingVerifiedRows as any[]).filter(r => r.status === "VERIFIED").map(mapOrder);
      const loadingOrders  = (pendingVerifiedRows as any[]).filter(r => r.status === "LOADING").map(mapOrder);

      const pendingTotal  = round2(pendingOrders.reduce((s, o) => s + o.grandTotal, 0));
      const verifiedTotal = round2(verifiedOrders.reduce((s, o) => s + o.grandTotal, 0));
      const loadingTotal  = round2(loadingOrders.reduce((s, o) => s + o.grandTotal, 0));

      // ── 5. Combine and return ────────────────────────────────────────────
      // Rename for clarity — these are the two factory-specific values.
      const baleInventoryValue = round2(inventorySellValue);

      // Guard: strip any ledger account whose category could collide with our
      // factory-injected "Inventory" / "Stock" entries.  Accounts with type
      // "Inventory" bypass the name-pattern exclusion in classifyNetPositionAccounts
      // (that guard only runs for types in assetAccountTypes).  Removing them
      // here guarantees ONE source of truth for both factory values.
      const inventoryCategoryRx = /inventory|stock in hand|stock on hand|raw material/i;
      const cleanLedgerForUs = ledgerForUs.filter(
        a => !inventoryCategoryRx.test(a.category) && !inventoryCategoryRx.test(a.name),
      );
      const cleanLedgerForUsTotal = round2(
        cleanLedgerForUs.reduce((s, a) => s + a.value, 0),
      );

      // ── Split customer items into DR (asset) and CR (liability) ──────────────
      const customerDrItems = customerItems.filter(c => c.balanceUsd > 0);
      const customerCrItems = customerItems.filter(c => c.balanceUsd < 0);
      const totalCustomerDr = round2(customerDrItems.reduce((s, c) => s + c.balanceUsd, 0));
      const totalCustomerCr = round2(customerCrItems.reduce((s, c) => s + Math.abs(c.balanceUsd), 0));

      // forUsTotal: ledger assets + inventory + raw material + balance on table + stock OTW
      //             + customer receivables (DR) + pending orders + verified orders + loading orders
      //             (bales are reserved/excluded from baleInventoryValue — no double-count)
      const forUsTotal = round2(
        cleanLedgerForUsTotal + baleInventoryValue + rawMaterialStockValue + balanceOnTableValue +
        stockOtwValue + totalCustomerDr + pendingTotal + verifiedTotal + loadingTotal,
      );
      // ── Employee Salaries Payable — directly from employees.currentBalance ───────
      // Employee balances are tracked via employees.currentBalance (not through a
      // "Payroll Payable" ledger account), so we inject them here explicitly.
      const allEmployeesForNP = await db
        .select({ currentBalance: employees.currentBalance })
        .from(employees)
        .where(and(
          eq(employees.companyId, companyId),
          eq(employees.employeeType, "Employee"),
          eq(employees.active, true),
          isNull(employees.deletedAt),
        ));
      let employeeSalariesPayable = 0;
      for (const emp of allEmployeesForNP) {
        const bal = parseFloat(emp.currentBalance || "0");
        if (bal > 0) employeeSalariesPayable += bal;
      }
      employeeSalariesPayable = round2(employeeSalariesPayable);

      // onUsTotal: ledger liabilities + supplier balances + customer credit balances (CR) + employee salaries
      const onUsTotal = round2(ledgerOnUsTotal + totalSupplierLiabilities + totalCustomerCr + employeeSalariesPayable);
      const netPosition = round2(forUsTotal - onUsTotal);

      // Inject factory-specific lines explicitly (always present so the UI
      // always has a named row for both even when the value is 0).
      const factoryInventoryEntry = { name: "Stock In Hand (Inventory)", code: "INVENTORY", value: baleInventoryValue, category: "Inventory" };
      const factoryRawMaterialEntry = { name: "Factory Raw Material Stock", code: "RAW_MATERIAL", value: rawMaterialStockValue, category: "Raw Material" };
      const factoryBalanceOnTableEntry = { name: "Balance on Table", code: "BALANCE_ON_TABLE", value: balanceOnTableValue, category: "Production" };
      const factoryStockOtwEntry = { name: "Factory Stock OTW", code: "STOCK_OTW", value: stockOtwValue, category: "Stock OTW" };

      const forUsAccounts = [
        factoryInventoryEntry,
        factoryRawMaterialEntry,
        ...(balanceOnTableValue > 0 ? [factoryBalanceOnTableEntry] : []),
        ...(stockOtwValue > 0 ? [factoryStockOtwEntry] : []),
        ...cleanLedgerForUs.sort((a, b) => b.value - a.value).map(a => ({ ...a, value: round2(a.value) })),
        ...customerDrItems
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .map(c => ({ name: c.name, code: "CUSTOMER_DR", value: round2(c.balanceUsd), category: "Customer" })),
        ...(pendingTotal > 0 ? [{ name: "Pending Orders", code: "PENDING_ORDERS", value: pendingTotal, category: "Pending Orders" }] : []),
        ...(verifiedTotal > 0 ? [{ name: "Verified Orders", code: "VERIFIED_ORDERS", value: verifiedTotal, category: "Verified Orders" }] : []),
        ...(loadingTotal > 0 ? [{ name: "Loading Orders", code: "LOADING_ORDERS", value: loadingTotal, category: "Loading Orders" }] : []),
      ];

      // Group ledger on-us by category
      const ledgerOnUsGrouped: Record<string, number> = {};
      for (const a of ledgerOnUs) {
        ledgerOnUsGrouped[a.category] = (ledgerOnUsGrouped[a.category] || 0) + a.value;
      }

      const onUsAccounts: { name: string; code: string; value: number; category: string; breakdown?: { label: string; native: string; usd: number }[] }[] = [
        ...supplierItems
          .filter(s => s.balanceUsd > 0)
          .sort((a, b) => b.balanceUsd - a.balanceUsd)
          .map(s => ({ name: s.name, code: "SUPPLIER", value: round2(s.balanceUsd), category: "Supplier", breakdown: s.breakdown })),
        ...ledgerOnUs.sort((a, b) => b.value - a.value).map(a => ({ ...a, value: round2(a.value) })),
        { name: "Payroll Payable", code: "EMPLOYEE_PAYROLL_PAYABLE", value: employeeSalariesPayable, category: "Liability" },
        ...customerCrItems
          .sort((a, b) => Math.abs(b.balanceUsd) - Math.abs(a.balanceUsd))
          .map(c => ({ name: c.name, code: "CUSTOMER_CR", value: round2(Math.abs(c.balanceUsd)), category: "Customer" })),
      ];

      const forUsBreakdown = Object.entries(
        forUsAccounts.reduce((m: Record<string,number>, a) => {
          m[a.category] = (m[a.category] || 0) + a.value;
          return m;
        }, {})
      ).map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value);

      // Merge employee salaries payable into the "Liability" category in the breakdown
      // employeeSalariesPayable is always the authoritative Payroll Payable figure
      const mergedLedgerOnUsGrouped = { ...ledgerOnUsGrouped };
      mergedLedgerOnUsGrouped["Liability"] = round2((mergedLedgerOnUsGrouped["Liability"] || 0) + employeeSalariesPayable);
      const onUsBreakdown = [
        ...(totalSupplierLiabilities > 0 ? [{ name: "Suppliers", value: round2(totalSupplierLiabilities) }] : []),
        ...Object.entries(mergedLedgerOnUsGrouped)
          .map(([name, value]) => ({ name, value: round2(value) }))
          .sort((a, b) => b.value - a.value),
        ...(totalCustomerCr > 0 ? [{ name: "Customer", value: totalCustomerCr }] : []),
      ];

      res.json({
        forUsTotal,
        onUsTotal,
        netPosition,
        netPositionLabel: netPosition >= 0 ? "We have more than we owe" : "We owe more than we have",
        forUs: { total: forUsTotal, breakdown: forUsBreakdown, accounts: forUsAccounts },
        onUs: { total: onUsTotal, breakdown: onUsBreakdown, accounts: onUsAccounts },
        supplierLiabilities: round2(totalSupplierLiabilities),
        inventoryValue: baleInventoryValue,
        rawMaterialValue: rawMaterialStockValue,
        ledgerAssets: cleanLedgerForUsTotal,
        pendingOrders,
        verifiedOrders,
        loadingOrders,
        pendingTotal,
        verifiedTotal,
        loadingTotal,
        ledgerLiabilities: round2(ledgerOnUsTotal),
        payrollPayable: employeeSalariesPayable,
      });
    } catch (error: any) {
      console.error("Factory net-position error:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
