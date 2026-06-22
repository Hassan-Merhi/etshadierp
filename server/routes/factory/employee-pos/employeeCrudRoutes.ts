import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { buildBrokerStatement } from "../suppliers/supplierBrokerRoutes";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "../_helpers";
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
  propertyContracts, propertyMonthlyLedger, propertyPayments,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sqlArray } from "../../../lib/sqlArray";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerEmployeeCrudRoutes(app: Express) {
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

      const { amount, date, notes, effectiveDate } = req.body;
      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });

      const result = await db.transaction(async (tx) => {
        const [emp] = await tx.select().from(employees).where(
          and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
        );
        if (!emp) throw new Error("EMPLOYEE_NOT_FOUND");

        // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
        let [payrollExpenseAccount] = await tx.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
        );
        if (!payrollExpenseAccount) {
          [payrollExpenseAccount] = await tx.insert(ledgerAccounts).values({
            companyId,
            code: "PAYROLL_DEPOSIT_EXPENSE",
            name: "Payroll Deposit Expense",
            accountType: "Indirect Expense",
            openingBalance: "0",
            active: true,
          }).returning();
        }

        const voucherNumber = `EMP-DEP-${Date.now()}`;
        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          effectiveDate: (effectiveDate as string) || null,
          description: notes || `Salary deposit for ${emp.firstName} ${emp.lastName}`,
          totalAmount: depositAmount.toFixed(2),
        }).returning();

        // DR: Payroll Expense
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: payrollExpenseAccount.id,
          debitAmount: depositAmount.toFixed(2),
          creditAmount: "0",
          narration: notes || `Salary deposit - ${voucherNumber}`,
        });

        // CR: Employee
        await tx.insert(voucherEntries).values({
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
        await tx.update(employees).set({
          currentBalance: newBalance.toFixed(2),
          totalDeposits: newDeposits.toFixed(2),
        }).where(eq(employees.id, id));

        const [updated] = await tx.select().from(employees).where(eq(employees.id, id));
        return { voucher, employee: updated };
      });

      res.json(result);
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

      const result = await db.transaction(async (tx) => {
        const [emp] = await tx.select().from(employees).where(
          and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
        );
        if (!emp) throw new Error("EMPLOYEE_NOT_FOUND");

        // Verify cash account belongs to this company
        const [cashAccount] = await tx.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.id, parseInt(cashAccountId)), eq(ledgerAccounts.companyId, companyId))
        );
        if (!cashAccount) throw new Error("CASH_ACCOUNT_NOT_FOUND");

        const voucherNumber = `EMP-WD-${Date.now()}`;
        const [voucher] = await tx.insert(vouchers).values({
          companyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          description: notes || `Withdrawal for ${emp.firstName} ${emp.lastName}`,
          totalAmount: withdrawAmount.toFixed(2),
        }).returning();

        // DR: Employee
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: null,
          employeeId: id,
          debitAmount: withdrawAmount.toFixed(2),
          creditAmount: "0",
          narration: notes || `Withdrawal - ${voucherNumber}`,
        });

        // CR: Cash
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: cashAccount.id,
          debitAmount: "0",
          creditAmount: withdrawAmount.toFixed(2),
          narration: notes || `Withdrawal - ${voucherNumber}`,
        });

        // Update employee balance (can go negative)
        const newBalance = parseFloat(emp.currentBalance || "0") - withdrawAmount;
        const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + withdrawAmount;
        await tx.update(employees).set({
          currentBalance: newBalance.toFixed(2),
          totalWithdrawals: newWithdrawals.toFixed(2),
        }).where(eq(employees.id, id));

        const [updated] = await tx.select().from(employees).where(eq(employees.id, id));
        return { voucher, employee: updated };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/bulk-payroll - bulk payroll deposit for multiple employees
  app.post("/api/factory/employees/bulk-payroll", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { deposits, date, notes, effectiveDate } = req.body;
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

      const totalSalary = validDeposits.reduce((sum: number, d: any) => sum + (parseFloat(d.amount) || 0), 0);
      const totalDeduction = validDeposits.reduce((sum: number, d: any) => sum + (parseFloat(d.deduction) || 0), 0);
      const totalNet = totalSalary - totalDeduction;
      const voucherNumber = `EMP-PAY-${Date.now()}`;

      const txResult = await db.transaction(async (tx) => {
        // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
        let [payrollExpenseAccount] = await tx.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
        );
        if (!payrollExpenseAccount) {
          [payrollExpenseAccount] = await tx.insert(ledgerAccounts).values({
            companyId,
            code: "PAYROLL_DEPOSIT_EXPENSE",
            name: "Payroll Deposit Expense",
            accountType: "Indirect Expense",
            openingBalance: "0",
            active: true,
          }).returning();
        }

        // Get or create PAYROLL_DEDUCTION_RECOVERY account for deductions
        let [deductionAccount] = await tx.select().from(ledgerAccounts).where(
          and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEDUCTION_RECOVERY"))
        );
        if (!deductionAccount) {
          [deductionAccount] = await tx.insert(ledgerAccounts).values({
            companyId,
            code: "PAYROLL_DEDUCTION_RECOVERY",
            name: "Payroll Deduction Recovery",
            accountType: "Indirect Income",
            openingBalance: "0",
            active: true,
          }).returning();
        }

        // Single bulk voucher (totalAmount = gross salary for accounting)
        const [bulkVoucher] = await tx.insert(vouchers).values({
          companyId,
          voucherNumber,
          voucherType: "Journal",
          voucherDate: date,
          effectiveDate: (effectiveDate as string) || null,
          description: notes || `Bulk payroll - ${validDeposits.length} employees`,
          totalAmount: Math.abs(totalNet).toFixed(2),
        }).returning();

        // DR: Payroll Expense (gross salary)
        if (totalSalary > 0) {
          await tx.insert(voucherEntries).values({
            voucherId: bulkVoucher.id,
            ledgerAccountId: payrollExpenseAccount.id,
            debitAmount: totalSalary.toFixed(2),
            creditAmount: "0",
            narration: notes || `Bulk payroll gross - ${validDeposits.length} employees - ${voucherNumber}`,
          });
        }

        // CR: Deduction Recovery (total deductions)
        if (totalDeduction > 0) {
          await tx.insert(voucherEntries).values({
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

          const [emp] = await tx.select().from(employees).where(
            and(eq(employees.id, empId), eq(employees.companyId, companyId))
          );
          if (!emp) continue;

          // CR employee: salary earned
          if (amount > 0) {
            await tx.insert(voucherEntries).values({
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
            await tx.insert(voucherEntries).values({
              voucherId: bulkVoucher.id,
              ledgerAccountId: null,
              employeeId: empId,
              debitAmount: deduction.toFixed(2),
              creditAmount: "0",
              narration: `Deduction for ${emp.firstName} ${emp.lastName} - ${voucherNumber}`,
            });
          }

          // Deduct outstanding advance balances FIFO (same as ERP payroll)
          if (deduction > 0) {
            const outstanding = await tx.execute(sql`
              SELECT * FROM employee_advances
              WHERE company_id = ${companyId} AND employee_id = ${empId} AND fully_paid = false
              ORDER BY advance_date ASC, id ASC
            `);
            let remaining = deduction;
            for (const adv of outstanding.rows as any[]) {
              if (remaining <= 0.001) break;
              const bal = parseFloat(adv.remaining_balance || "0");
              if (bal <= 0) continue;
              const toDeduct = Math.min(remaining, bal);
              const newBal = Math.max(0, bal - toDeduct);
              const fullyPaid = newBal <= 0.01;

              await tx.execute(sql`
                INSERT INTO employee_advance_repayments (company_id, advance_id, employee_id, repayment_date, amount, cash_account_id, notes)
                VALUES (${companyId}, ${adv.id}, ${empId}, ${date}, ${toDeduct.toFixed(2)}, NULL, ${`Payroll deduction — ${voucherNumber}`})
              `);
              await tx.execute(sql`
                UPDATE employee_advances
                SET remaining_balance = ${newBal.toFixed(2)}, fully_paid = ${fullyPaid}
                WHERE id = ${adv.id}
              `);
              remaining -= toDeduct;
            }
          }

          // Update employee balance: net = salary - deduction (can go negative)
          const currentBal = parseFloat(emp.currentBalance || "0");
          const newBalance = currentBal + net;
          const newDeposits = parseFloat(emp.totalDeposits || "0") + amount;
          const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + deduction;
          await tx.update(employees).set({
            currentBalance: newBalance.toFixed(2),
            totalDeposits: newDeposits.toFixed(2),
            ...(deduction > 0 ? { totalWithdrawals: newWithdrawals.toFixed(2) } : {}),
          }).where(eq(employees.id, empId));

          results.push({ employeeId: empId, amount, deduction, net, name: `${emp.firstName} ${emp.lastName}` });
        }

        return { bulkVoucher, results };
      });

      res.json({ voucher: txResult.bulkVoucher, results: txResult.results, totalSalary, totalDeduction, totalNet });
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

  // GET /api/factory/employee-payroll-preview?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  // Returns attendance-based salary calculation for each active employee
  app.get("/api/factory/employee-payroll-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required" });

      const emps = await db.select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"), eq(employees.active, true), sql`${employees.deletedAt} IS NULL`))
        .orderBy(employees.firstName);

      if (emps.length === 0) return res.json({ preview: [] });

      const empIds = emps.map((e: any) => e.id);
      const attResult = await db.execute(sql`
        SELECT employee_id, status, COUNT(*) as count
        FROM employee_attendance
        WHERE company_id = ${companyId}
          AND employee_id = ANY(${sqlArray(empIds)})
          AND attendance_date >= ${startDate}
          AND attendance_date <= ${endDate}
        GROUP BY employee_id, status
      `);

      // Build attendance map: employeeId -> { present: n, half: n, absent: n, late: n, leave: n }
      const attMap: Record<number, Record<string, number>> = {};
      for (const row of attResult.rows as any[]) {
        const eid = Number(row.employee_id);
        if (!attMap[eid]) attMap[eid] = {};
        attMap[eid][(row.status as string).toLowerCase()] = Number(row.count);
      }

      // Get outstanding advance balances per employee
      const advResult = await db.execute(sql`
        SELECT employee_id, SUM(remaining_balance::numeric) as total_balance
        FROM employee_advances
        WHERE company_id = ${companyId} AND fully_paid = false
          AND employee_id = ANY(${sqlArray(empIds)})
        GROUP BY employee_id
      `);
      const advMap: Record<number, number> = {};
      for (const row of advResult.rows as any[]) {
        advMap[Number(row.employee_id)] = parseFloat(row.total_balance || "0");
      }

      // Days in the month (use startDate's month)
      const monthStart = new Date(startDate + "T00:00:00");
      const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();

      const preview = emps.map((emp: any) => {
        const eid = emp.id;
        const a = attMap[eid] || {};
        const present = (a.present || 0) + (a.late || 0) + (a.leave || 0);
        const half = (a["half day"] || 0) + (a.halfday || 0);
        const absent = a.absent || 0;
        const totalMarkedDays = present + half + absent;
        const monthlySalary = parseFloat(emp.monthlySalary || "0");
        const dailyRate = daysInMonth > 0 ? monthlySalary / daysInMonth : 0;

        // Absence-deduction model: unmarked days within the period are treated as present.
        // Only explicitly marked absences and half-days reduce pay.
        const deductedDays = absent + half * 0.5;
        const effectivePresentDays = Math.max(0, daysInMonth - deductedDays);
        const calculatedPay = Math.max(0, monthlySalary - dailyRate * deductedDays);

        const outstandingAdvance = advMap[eid] || 0;
        const deduction = Math.min(outstandingAdvance, calculatedPay);
        const netPay = Math.max(0, calculatedPay - deduction);
        return {
          employeeId: eid,
          employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
          department: emp.department,
          monthlySalary: monthlySalary.toFixed(2),
          daysInMonth,
          presentDays: effectivePresentDays,
          halfDays: half,
          absentDays: absent,
          totalMarkedDays,
          calculatedPay: calculatedPay.toFixed(2),
          outstandingAdvance: outstandingAdvance.toFixed(2),
          deduction: deduction.toFixed(2),
          netPay: netPay.toFixed(2),
        };
      });

      res.json({ preview });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
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
        AND employee_id = ANY(${sqlArray(empIds)})
      `);
      // Map snake_case raw SQL rows to camelCase for the frontend
      const attendance = (existing.rows as any[]).map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        attendanceDate: r.attendance_date,
        status: r.status,
        notes: r.notes,
      }));
      res.json({ employees: emps, attendance });
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
      // Map snake_case raw SQL rows to camelCase for the frontend
      const attendance = (rows.rows as any[]).map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        attendanceDate: r.attendance_date,
        status: r.status,
        notes: r.notes,
      }));
      res.json(attendance);
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

}
