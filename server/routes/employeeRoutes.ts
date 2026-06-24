import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, syncEmployeeBalancesFromEntries } from "./_helpers";
import { triggerAccountWhatsAppStatement } from "./factoryWhatsappRoutes";
import {
  locations,
  inventory,
  stockItems,
  stockGroups,
  ledgerAccounts,
  employees,
  employeeGroups,
  employeeGroupMembers,
  suppliers,
  customers,
  customerBalances,
  customerOrders,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  vouchers,
  voucherEntries,
  salesItems,
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertEmployeeSchema,
  insertEmployeeGroupSchema,
  insertSupplierSchema,
  insertCustomerSchema,
  userLocations,
  userCompanyRoles,
  companies,
  bankAccounts,
  fixedAssets,
  agentAccounts,
  auditLog,
  users,
  FEATURE_KEYS,
  erpPayrollRuns,
  erpPayrollRunItems,
  salaryAdvances,
  salaryAdvanceDeductions,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";

export function registerEmployeeRoutes(app: Express) {
  app.get("/api/employees", requireAuth, async (req, res) => {
    // Disable HTTP caching - employee balances are dynamically calculated
    res.set("Cache-Control", "no-store");
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const employees = await storage.getAllEmployees(req.session.currentCompanyId);
      // Ensure proper camelCase field names for frontend
      const transformedEmployees = employees.map((emp) => {
        // Use stored currentBalance which is kept in sync by payroll operations and journal vouchers
        // The syncEmployeePayrollBalance function updates currentBalance when vouchers are created/edited/deleted
        const currentBalance = parseFloat((emp as any).currentBalance || "0");

        return {
          ...emp,
          firstName: emp.firstName || (emp as any).first_name,
          lastName: emp.lastName || (emp as any).last_name,
          currentBalance: currentBalance.toFixed(2),
          calculatedBalance: currentBalance.toFixed(2),
        };
      });
      res.json(transformedEmployees);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/employees/:id/balance", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }
      const employees = await storage.getAllEmployees(req.session.currentCompanyId);
      const employee = employees.find((e: any) => e.id === employeeId);
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }
      const balance = parseFloat((employee as any).currentBalance || "0").toFixed(2);
      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employees", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.parse(req.body);

      // Auto-generate code from name if not provided
      if (!parsed.code) {
        // Generate code from name: first 3 letters of first name + first 3 letters of last name, uppercase
        const firstPart = parsed.firstName.trim().substring(0, 3).toUpperCase();
        const lastPart = parsed.lastName.trim().substring(0, 3).toUpperCase();
        let baseCode = firstPart + lastPart;

        // Fallback if baseCode is somehow empty (shouldn't happen with validation)
        if (!baseCode || baseCode.length === 0) {
          baseCode = "EMP";
        }

        // Ensure uniqueness by adding suffix if needed
        let code = baseCode;
        let suffix = 1;
        while (await storage.getEmployeeByCode(code)) {
          code = `${baseCode}${suffix}`;
          suffix++;
        }
        parsed.code = code;
      } else {
        // Check for duplicate code if manually provided
        const existing = await storage.getEmployeeByCode(parsed.code);
        if (existing) {
          return res.status(400).json({ message: "Employee code already exists" });
        }
      }

      let employee = await storage.createEmployee(parsed);

      // Initialize currentBalance to opening balance if provided
      if (parsed.openingBalance && parseFloat(parsed.openingBalance) > 0) {
        await db
          .update(employees)
          .set({
            currentBalance: parsed.openingBalance,
          })
          .where(eq(employees.id, employee.id));

        employee = {
          ...employee,
          currentBalance: parsed.openingBalance,
        };
      }

      res.status(201).json(employee);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Employee bale rates per location
  app.get("/api/employees/:id/bale-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      const rates = await storage.getEmployeeBaleRates(employeeId, companyId);
      return res.json(rates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/employees/:id/bale-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      const { rates } = req.body;
      if (!Array.isArray(rates)) return res.status(400).json({ message: "rates must be an array" });
      const valid = rates
        .filter((r: any) => r.locationId && parseFloat(r.rate) > 0)
        .map((r: any) => ({
          locationId: parseInt(r.locationId),
          rate: String(parseFloat(r.rate)),
          sourceCompanyId: r.sourceCompanyId ? parseInt(r.sourceCompanyId) : null,
        }));
      await storage.setEmployeeBaleRates(employeeId, companyId, valid);
      return res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/employees/:id/bale-pct-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      const rates = await storage.getEmployeeBalePctRates(employeeId, companyId);
      return res.json(rates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/employees/:id/bale-pct-rates", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const employeeId = parseInt(req.params.id);
      const { rates } = req.body;
      if (!Array.isArray(rates)) return res.status(400).json({ message: "rates must be an array" });
      const valid = rates
        .filter((r: any) => r.locationId && parseFloat(r.pct) > 0)
        .map((r: any) => ({
          locationId: parseInt(r.locationId),
          pct: String(parseFloat(r.pct)),
          sourceCompanyId: r.sourceCompanyId ? parseInt(r.sourceCompanyId) : null,
        }));
      await storage.setEmployeeBalePctRates(employeeId, companyId, valid);
      return res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/employees/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const {
        firstName,
        lastName,
        code,
        monthlySalary,
        department,
        active,
        joinDate,
        employeeGroupId,
        salesBonusPct,
        salesBonusPctSourceCompanyId,
        salesBonusPctLocationId,
        balesBonusRate,
      } = req.body;

      const updates: Record<string, any> = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (code !== undefined) updates.code = code;
      if (monthlySalary !== undefined) updates.monthlySalary = monthlySalary;
      if (department !== undefined) updates.department = department;
      if (active !== undefined) updates.active = active;
      if (joinDate !== undefined) updates.joinDate = joinDate;
      if (employeeGroupId !== undefined)
        updates.employeeGroupId =
          employeeGroupId === null || employeeGroupId === "" || employeeGroupId === "none"
            ? null
            : parseInt(employeeGroupId);
      if (salesBonusPct !== undefined)
        updates.salesBonusPct = salesBonusPct === "" || salesBonusPct === null ? null : salesBonusPct;
      if (salesBonusPctSourceCompanyId !== undefined)
        updates.salesBonusPctSourceCompanyId =
          salesBonusPctSourceCompanyId === "" || salesBonusPctSourceCompanyId === null
            ? null
            : parseInt(salesBonusPctSourceCompanyId);
      if (salesBonusPctLocationId !== undefined)
        updates.salesBonusPctLocationId =
          salesBonusPctLocationId === "" || salesBonusPctLocationId === null ? null : parseInt(salesBonusPctLocationId);
      if (balesBonusRate !== undefined)
        updates.balesBonusRate = balesBonusRate === "" || balesBonusRate === null ? null : balesBonusRate;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      const updated = await storage.updateEmployee(id, companyId, updates as any);
      if (!updated) return res.status(404).json({ message: "Employee not found" });

      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employees/:id", requireAuth, async (req, res) => {
    try {
      // Only Admin can delete employees
      const userRole = req.session.currentRole;
      if (userRole !== "Admin" && userRole !== "Developer") {
        return res.status(403).json({
          message: "Only Admin users can delete employees",
        });
      }

      const employeeId = parseInt(req.params.id);
      if (isNaN(employeeId)) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get employee to verify it exists and belongs to current company
      const allEmployees = await storage.getAllEmployees(req.session.currentCompanyId);
      const employee = allEmployees.find((e) => e.id === employeeId);

      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      if (employee.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Employee belongs to a different company",
        });
      }

      // Check for forceDelete flag from query parameter
      const forceDelete = req.query.forceDelete === "true";

      const result = await storage.deleteEmployee(employeeId, forceDelete);

      if (!result.success) {
        // If balance check failed, return 409 Conflict with balance details
        if (result.employeeBalance !== undefined || result.ledgerBalance !== undefined) {
          return res.status(409).json({
            message: result.message,
            employeeBalance: result.employeeBalance,
            ledgerBalance: result.ledgerBalance,
            requiresConfirmation: true,
          });
        }
        // Other errors (salary advances, transaction history)
        return res.status(400).json({ message: result.message });
      }

      res.json({ message: "Employee deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Employee Groups
  app.get("/api/employee-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const groups = await storage.getAllEmployeeGroups(req.session.currentCompanyId);
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const group = await storage.getEmployeeGroupById(parseInt(req.params.id));
      if (!group) {
        return res.status(404).json({ message: "Employee group not found" });
      }
      if (group.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied: group belongs to a different company" });
      }
      res.json(group);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employee-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const parsed = insertEmployeeGroupSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
      });
      const group = await storage.createEmployeeGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      const group = await storage.updateEmployeeGroup(parseInt(req.params.id), req.body);
      res.json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employee-groups/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteEmployeeGroup(parseInt(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/employee-groups/:id/members", requireAuth, async (req, res) => {
    try {
      const members = await storage.getEmployeeGroupMembers(parseInt(req.params.id));
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/employee-groups/:groupId/members/:employeeId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const groupId = parseInt(req.params.groupId);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid group ID" });
      const employeeId = parseInt(req.params.employeeId);
      if (isNaN(employeeId)) return res.status(400).json({ message: "Invalid employee ID" });
      const group = await storage.getEmployeeGroupById(groupId);
      if (!group || group.companyId !== companyId) {
        return res.status(403).json({ message: "Group not found or access denied" });
      }
      await storage.addEmployeeToGroup(groupId, employeeId);
      res.status(201).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/employee-groups/:groupId/members/:employeeId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const groupId = parseInt(req.params.groupId);
      if (isNaN(groupId)) return res.status(400).json({ message: "Invalid group ID" });
      const group = await storage.getEmployeeGroupById(groupId);
      if (!group || group.companyId !== companyId) {
        return res.status(403).json({ message: "Group not found or access denied" });
      }
      await storage.removeEmployeeFromGroup(groupId, parseInt(req.params.employeeId));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Worker Groups
  app.get("/api/worker-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const allGroups = await storage.getAllEmployeeGroups(req.session.currentCompanyId);
      const workerGroups = allGroups.filter((g: any) => (g.groupType || g.group_type) === "Worker");
      res.json(workerGroups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/worker-groups/with-members", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const companyId = req.session.currentCompanyId;
      const allGroups = await storage.getAllEmployeeGroups(companyId);
      const workerGroups = allGroups.filter((g: any) => {
        const type = g.groupType || g.group_type;
        return type === "Worker";
      });

      // Get members for each group, filtering by company for security
      const groupsWithMembers = await Promise.all(
        workerGroups.map(async (group: any) => {
          const memberRecords = await storage.getEmployeeGroupMembers(group.id);
          // Get full worker details for each member, ensuring they belong to the same company
          const members = await Promise.all(
            memberRecords.map(async (m: any) => {
              const [worker] = await db
                .select()
                .from(employees)
                .where(and(eq(employees.id, m.employeeId), eq(employees.companyId, companyId)));
              return worker;
            })
          );
          const finalResult = {
            ...group,
            members: members.filter(Boolean),
          };
          return finalResult;
        })
      );
      res.json(groupsWithMembers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/worker-groups", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const parsed = insertEmployeeGroupSchema.parse({
        ...req.body,
        companyId: req.session.currentCompanyId,
        groupType: "Worker",
      });
      const group = await storage.createEmployeeGroup(parsed);
      res.status(201).json(group);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/worker-groups/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteEmployeeGroup(parseInt(req.params.id));
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/worker-groups/:id/members", requireAuth, async (req, res) => {
    try {
      const members = await storage.getEmployeeGroupMembers(parseInt(req.params.id));
      res.json(members);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/worker-groups/:groupId/members/:workerId", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const companyId = req.session.currentCompanyId;
      const groupId = parseInt(req.params.groupId);
      const workerId = parseInt(req.params.workerId);

      // Verify group belongs to company
      const group = await storage.getEmployeeGroupById(groupId);
      if (!group || group.companyId !== companyId) {
        return res.status(403).json({ message: "Group not found or access denied" });
      }

      // Verify worker belongs to company
      const [worker] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, workerId), eq(employees.companyId, companyId)));
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      await storage.addEmployeeToGroup(groupId, workerId);
      res.status(201).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/worker-groups/:groupId/members/:workerId", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const companyId = req.session.currentCompanyId;
      const groupId = parseInt(req.params.groupId);
      const workerId = parseInt(req.params.workerId);

      // Verify group belongs to company
      const group = await storage.getEmployeeGroupById(groupId);
      if (!group || group.companyId !== companyId) {
        return res.status(403).json({ message: "Group not found or access denied" });
      }

      await storage.removeEmployeeFromGroup(groupId, workerId);
      res.status(204).send();
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

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
            accountType: "Expense",
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
      console.error("[/api/payroll/sales-summary]", error);
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
          accountType: "Expense",
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
          console.error("[payroll-wa] WhatsApp trigger error (non-fatal):", waErr);
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

      const allAccounts = await storage.getAllLedgerAccounts(companyId);
      // Old-style account codes: the single SALARY_EXPENSE and any WORKER_PAY_* codes
      const oldStyleAccountIds = new Set(
        allAccounts
          .filter((a: any) => a.code === "SALARY_EXPENSE" || a.code.startsWith("WORKER_PAY_"))
          .map((a: any) => a.id)
      );

      const paidRuns = await db
        .select()
        .from(erpPayrollRuns)
        .where(and(eq(erpPayrollRuns.companyId, companyId), eq(erpPayrollRuns.status, "PAID")));

      // Build a current group-membership lookup: employeeId → groupName
      // Used as fallback when run items were created before groupName was stored
      const groupMemberships = await db
        .select({ employeeId: employeeGroupMembers.employeeId, groupName: employeeGroups.name })
        .from(employeeGroupMembers)
        .innerJoin(employeeGroups, eq(employeeGroupMembers.employeeGroupId, employeeGroups.id))
        .where(and(eq(employeeGroups.companyId, companyId), eq(employeeGroups.active, true)));
      const empGroupMap = new Map<number, string>();
      for (const row of groupMemberships) {
        if (!empGroupMap.has(row.employeeId)) empGroupMap.set(row.employeeId, row.groupName);
      }

      let migrated = 0;
      let alreadyCorrect = 0;
      let noGroups = 0;
      let noVoucher = 0;

      for (const run of paidRuns) {
        // Find the active SAL-{runId}-* voucher for this run
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
        if (salVouchers.length === 0) {
          noVoucher++;
          continue;
        }
        const oldVoucher = salVouchers[0];

        // Check if any debit entry uses an old-style account
        const debitEntries = await db
          .select()
          .from(voucherEntries)
          .where(and(eq(voucherEntries.voucherId, oldVoucher.id), sql`${voucherEntries.debitAmount}::numeric > 0`));

        const hasOldStyleDebit = debitEntries.some((e) => oldStyleAccountIds.has(e.ledgerAccountId));
        if (!hasOldStyleDebit) {
          alreadyCorrect++;
          continue;
        }

        // Get run items and group them — fall back to current group membership if groupName not stored
        const runItems = await db.select().from(erpPayrollRunItems).where(eq(erpPayrollRunItems.runId, run.id));
        const totalAmount = runItems.reduce((s, i) => s + parseFloat(i.netPay), 0);

        const itemsByGroup = new Map<string, number>();
        for (const item of runItems) {
          const stored = (item.groupName || "").trim();
          const grp = stored || (item.employeeId ? empGroupMap.get(item.employeeId) || "__default__" : "__default__");
          itemsByGroup.set(grp, (itemsByGroup.get(grp) || 0) + parseFloat(item.netPay));
        }

        // Skip if all workers have no group (nothing to split into named accounts)
        const hasNamedGroups = [...itemsByGroup.keys()].some((k) => k !== "__default__");
        if (!hasNamedGroups) {
          noGroups++;
          continue;
        }

        // Soft-delete old voucher
        await db.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, oldVoucher.id));

        // Create replacement voucher
        const newVoucherNumber = `SAL-${run.id}-${Date.now()}`;
        const [newVoucher] = await db
          .insert(vouchers)
          .values({
            companyId,
            voucherNumber: newVoucherNumber,
            voucherType: "Payment",
            voucherDate: run.date,
            description: run.notes || `Payroll run #${run.id}`,
            totalAmount: totalAmount.toFixed(2),
          })
          .returning();

        // Create per-group debit entries using new Salary Expense - {Group} naming
        const freshAccounts = await storage.getAllLedgerAccounts(companyId);
        for (const [grp, grpTotal] of itemsByGroup) {
          const isDefault = grp === "__default__";
          const expCode = isDefault
            ? "SALARY_EXPENSE"
            : `SAL_EXP_${grp
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "_")
                .substring(0, 25)}`;
          const expName = isDefault ? "Salary Expense" : `Salary Expense - ${grp}`;

          let expAccount = freshAccounts.find((a: any) => a.code === expCode);
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
            voucherId: newVoucher.id,
            ledgerAccountId: expAccount.id,
            debitAmount: grpTotal.toFixed(2),
            creditAmount: "0",
            narration: isDefault
              ? `Salary expense — payroll run #${run.id}`
              : `Salary expense - ${grp} — run #${run.id}`,
          });
        }

        // Re-create the credit entry using the run's recorded payment account
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

      res.json({ migrated, alreadyCorrect, noGroups, noVoucher, total: paidRuns.length });
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

  // Suppliers
}
