import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, syncEmployeeBalancesFromEntries } from "./_helpers";
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
  containerSales,
  vouchers,
  voucherEntries,
  salesItems,
  insertLocationSchema,
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertContainerSaleSchema,
  insertInterCompanyTransferSchema,
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
  interCompanyTransfers,
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

export function registerCustomerRoutes(app: Express) {
  // Lean endpoint for POS credit-sale customer picker — id + legalName only.
  // Must be registered before /api/customers to avoid route shadowing.
  app.get("/api/customers/for-pos", requireAuth, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const list = await storage.getAllCustomers(req.session.currentCompanyId);
      res.json(list.map((c: any) => ({ id: c.id, legalName: c.legalName })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const search = (req.query.search as string | undefined)?.trim() || undefined;
      const limit = search ? 50 : undefined;
      const result = await storage.getAllCustomers(req.session.currentCompanyId, search, limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get customers with calculated balances (including voucher entries)
  app.get("/api/customers/stats", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const companyId = req.session.currentCompanyId;
      const customers = await storage.getAllCustomers(companyId);
      if (customers.length === 0) return res.json([]);

      // Batch: fetch ALL entries for all customer ledger accounts + all customer IDs in 2 queries
      // (replaces N individual queries — one per customer — in the old Promise.all approach)
      const ledgerAccountIds = customers.filter((c) => c.ledgerAccountId).map((c) => c.ledgerAccountId as number);
      const customerOnlyIds = customers.filter((c) => !c.ledgerAccountId).map((c) => c.id);

      const [ledgerEntries, customerEntries] = await Promise.all([
        ledgerAccountIds.length > 0
          ? db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(
                and(
                  eq(vouchers.companyId, companyId),
                  isNull(vouchers.deletedAt),
                  isNotNull(voucherEntries.ledgerAccountId),
                  inArray(voucherEntries.ledgerAccountId, ledgerAccountIds)
                )
              )
              .execute()
          : Promise.resolve(
              [] as { ledgerAccountId: number | null; debitAmount: string | null; creditAmount: string | null }[]
            ),
        customerOnlyIds.length > 0
          ? db
              .select({
                customerId: (voucherEntries as any).customerId,
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(
                and(
                  eq(vouchers.companyId, companyId),
                  isNull(vouchers.deletedAt),
                  isNotNull((voucherEntries as any).customerId),
                  inArray((voucherEntries as any).customerId, customerOnlyIds)
                )
              )
              .execute()
          : Promise.resolve(
              [] as { customerId: number | null; debitAmount: string | null; creditAmount: string | null }[]
            ),
      ]);

      // Build net-transaction maps (only pure debit or pure credit entries, matching original logic)
      const ledgerTxnMap = new Map<number, number>();
      for (const e of ledgerEntries) {
        if (!e.ledgerAccountId) continue;
        const d = parseFloat(e.debitAmount || "0"),
          c = parseFloat(e.creditAmount || "0");
        const cur = ledgerTxnMap.get(e.ledgerAccountId) ?? 0;
        if (d > 0 && c === 0) ledgerTxnMap.set(e.ledgerAccountId, cur + d);
        else if (c > 0 && d === 0) ledgerTxnMap.set(e.ledgerAccountId, cur - c);
      }
      const customerTxnMap = new Map<number, number>();
      for (const e of customerEntries) {
        const cid = (e as any).customerId;
        if (!cid) continue;
        const d = parseFloat(e.debitAmount || "0"),
          c = parseFloat(e.creditAmount || "0");
        const cur = customerTxnMap.get(cid) ?? 0;
        if (d > 0 && c === 0) customerTxnMap.set(cid, cur + d);
        else if (c > 0 && d === 0) customerTxnMap.set(cid, cur - c);
      }

      const customersWithBalances = customers.map((customer) => {
        const openingBalance = parseFloat(customer.openingBalance || "0");
        const openingSide = customer.openingBalanceSide || "Dr";
        const openingNet = openingSide === "Dr" ? openingBalance : -openingBalance;
        const txnNet = customer.ledgerAccountId
          ? (ledgerTxnMap.get(customer.ledgerAccountId) ?? 0)
          : (customerTxnMap.get(customer.id) ?? 0);
        const balance = openingNet + txnNet;
        return {
          ...customer,
          balance: Math.abs(balance),
          balanceSide: balance >= 0 ? "Dr" : "Cr",
        };
      });

      res.json(customersWithBalances);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get transactions for a specific customer (supports both ledger_account_id and customer_id paths)
  app.get("/api/customers/:id/transactions", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const { startDate, endDate } = req.query;
      const customer = await storage.getCustomerById(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      let transactions: any[] = [];
      if (customer.ledgerAccountId) {
        // Old path: entries stored against ledger account
        transactions = await storage.getVoucherEntriesByLedger(
          customer.ledgerAccountId,
          startDate as string | undefined,
          endDate as string | undefined
        );
      } else {
        // New path (post-migration): entries stored against customer_id
        transactions = await storage.getVoucherEntriesByCustomer(
          customerId,
          startDate as string | undefined,
          endDate as string | undefined
        );
      }

      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/customers/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      const customer = await storage.getCustomerById(customerId);
      if (!customer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Verify customer belongs to current company
      if (req.session.currentCompanyId && customer.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Customer belongs to a different company",
        });
      }

      res.json(customer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/customers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertCustomerSchema.parse(dataWithCompany);

      // Auto-generate customer code using MAX() — avoids loading all customers into memory
      let code = "CUST001";
      let suffix = 1;
      const [maxRow] = await db
        .select({
          maxSuffix: sql<string>`MAX(CAST(NULLIF(REGEXP_REPLACE(code, '[^0-9]', '', 'g'), '') AS integer))`,
        })
        .from(customers)
        .where(and(eq(customers.companyId, req.session.currentCompanyId!), sql`code LIKE 'CUST%'`))
        .execute();
      if (maxRow?.maxSuffix) suffix = parseInt(maxRow.maxSuffix) + 1;
      code = `CUST${suffix.toString().padStart(3, "0")}`;

      // Ensure uniqueness (handles gaps/collisions)
      while (await storage.getCustomerByCode(code, req.session.currentCompanyId)) {
        suffix++;
        code = `CUST${suffix.toString().padStart(3, "0")}`;
      }

      // Create customer with auto-generated code
      const customer = await storage.createCustomer({ ...parsed, code } as any);

      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "create",
          tableName: "customers",
          recordId: customer.id,
          recordIdentifier: customer.legalName,
          changes: {
            name: { new: customer.legalName },
            code: { new: customer.code },
            phone: { new: customer.phone || null },
            email: { new: customer.email || null },
            address: { new: customer.address || null },
            openingBalance: { new: customer.openingBalance || "0" },
            openingBalanceSide: { new: customer.openingBalanceSide || null },
          },
        });
      } catch {
        /* non-fatal */
      }

      // Auto-create ledger account for customer with opening balance
      const customerAccountCode = `CUST-${customer.code}`;
      let customerAccount = await storage.getLedgerAccountByCode(customerAccountCode, req.session.currentCompanyId!);

      if (!customerAccount) {
        customerAccount = await storage.createLedgerAccount({
          companyId: req.session.currentCompanyId,
          code: customerAccountCode,
          name: `${customer.legalName} - Customer Account`,
          accountType: "Asset",
          subType: "Accounts Receivable",
          openingBalance: parsed.openingBalance || "0",
          openingBalanceSide: parsed.openingBalanceSide || "Dr",
          active: true,
        });

        // Update customer with ledger account ID
        await storage.updateCustomer(customer.id, {
          ledgerAccountId: customerAccount.id,
        });
      }

      res.status(201).json(customer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/customers/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const existingCustomer = await storage.getCustomerById(customerId);
      if (!existingCustomer) {
        return res.status(404).json({ message: "Customer not found" });
      }

      // Verify customer belongs to current company
      if (existingCustomer.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Customer belongs to a different company",
        });
      }

      // If code is being changed, check for duplicates
      if (req.body.code && req.body.code !== existingCustomer.code) {
        const duplicate = await storage.getCustomerByCode(req.body.code, req.session.currentCompanyId);
        if (duplicate) {
          return res.status(400).json({
            message: "Customer code already exists in this company",
          });
        }
      }

      const parsed = insertCustomerSchema.partial().parse(req.body);
      const updatedCustomer = await storage.updateCustomer(customerId, parsed);

      try {
        const _custChanges: Record<string, { old: any; new: any }> = {};
        for (const _f of [
          "legalName",
          "phone",
          "email",
          "address",
          "openingBalance",
          "openingBalanceSide",
          "active",
        ] as const) {
          if (String((existingCustomer as any)[_f] ?? "") !== String((updatedCustomer as any)[_f] ?? "")) {
            _custChanges[_f] = { old: (existingCustomer as any)[_f], new: (updatedCustomer as any)[_f] };
          }
        }
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "update",
          tableName: "customers",
          recordId: updatedCustomer.id,
          recordIdentifier: updatedCustomer.legalName,
          changes: _custChanges,
        });
      } catch {
        /* non-fatal */
      }

      // Sync ledger account opening balance if customer has a linked ledger account
      // and opening balance was updated
      if (
        updatedCustomer.ledgerAccountId &&
        (parsed.openingBalance !== undefined || parsed.openingBalanceSide !== undefined)
      ) {
        const ledgerUpdate: { openingBalance?: string; openingBalanceSide?: string } = {};
        if (parsed.openingBalance !== undefined) {
          ledgerUpdate.openingBalance = updatedCustomer.openingBalance ?? "0";
        }
        if (parsed.openingBalanceSide !== undefined) {
          ledgerUpdate.openingBalanceSide = updatedCustomer.openingBalanceSide ?? "Dr";
        }
        if (Object.keys(ledgerUpdate).length > 0) {
          await storage.updateLedgerAccount({ id: updatedCustomer.ledgerAccountId!, ...ledgerUpdate });
        }
      }

      res.json(updatedCustomer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/customers/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const existing = await storage.getCustomerById(customerId);
      if (!existing) {
        return res.status(404).json({ message: "Customer not found" });
      }
      if (existing.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteCustomer(customerId);
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || "unknown",
          companyId: req.session.currentCompanyId!,
          action: "delete",
          tableName: "customers",
          recordId: existing.id,
          recordIdentifier: existing.legalName,
          changes: {
            name: { old: existing.legalName },
            code: { old: existing.code },
            phone: { old: existing.phone || null },
            email: { old: existing.email || null },
            address: { old: existing.address || null },
          },
        });
      } catch {
        /* non-fatal */
      }
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Sales
  app.get("/api/container-sales", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const sales = await storage.getContainerSales(req.session.currentCompanyId);
      res.json(sales);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/container-sales/customer/:customerId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const customerId = parseInt(req.params.customerId);
      if (isNaN(customerId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }

      const sales = await storage.getContainerSalesByCustomer(customerId, req.session.currentCompanyId!);
      res.json(sales);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/container-sales", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Inject companyId before schema validation
      const dataWithCompany = {
        ...req.body,
        companyId: req.session.currentCompanyId,
      };

      const parsed = insertContainerSaleSchema.parse(dataWithCompany);

      // Verify customer, container, and sale status in parallel
      const [customer, container, existingSale] = await Promise.all([
        storage.getCustomerById(parsed.customerId),
        storage.getContainerById(parsed.containerId),
        storage.getContainerSaleByContainerId(parsed.containerId, req.session.currentCompanyId),
      ]);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      if (customer.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Customer belongs to a different company" });
      }
      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Container belongs to a different company" });
      }
      if (existingSale) {
        return res.status(400).json({ message: "Container has already been sold" });
      }

      // Get customer's ledger account
      if (!customer.ledgerAccountId) {
        return res.status(400).json({ message: "Customer does not have a ledger account" });
      }

      // Determine commission account - use provided ID or default to COMMISSION_REVENUE
      let commissionAccountId = parsed.commissionAccountId;

      if (commissionAccountId) {
        // Verify the provided commission account exists and belongs to current company
        const commissionAccount = await storage.getLedgerAccountById(commissionAccountId);
        if (!commissionAccount) {
          return res.status(404).json({ message: "Commission account not found" });
        }
        if (commissionAccount.companyId !== req.session.currentCompanyId) {
          return res.status(403).json({ message: "Commission account belongs to a different company" });
        }
      } else {
        // Get or create default COMMISSION_REVENUE ledger account
        const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
        let commissionRevenueAccount = allAccounts.find((a: any) => a.code === "COMMISSION_REVENUE");

        if (!commissionRevenueAccount) {
          commissionRevenueAccount = await storage.createLedgerAccount({
            companyId: req.session.currentCompanyId,
            code: "COMMISSION_REVENUE",
            name: "Commission Revenue",
            accountType: "Income",
            openingBalance: "0",
            active: true,
          });
        }
        commissionAccountId = commissionRevenueAccount.id;
      }

      // Execute all operations in a single transaction for atomicity
      const sale = await db.transaction(async (tx) => {
        // Create voucher for the container sale
        const voucherNumber = `CS-${Date.now()}`;
        const [voucher] = await tx
          .insert(vouchers)
          .values({
            companyId: req.session.currentCompanyId!,
            voucherNumber,
            voucherType: "Sales",
            voucherDate: parsed.saleDate,
            description: parsed.notes || `Container sale - ${container.containerNumber} to ${customer.legalName}`,
            totalAmount: parsed.totalAmount,
          })
          .returning();

        // Create voucher entries (double-entry)
        // Debit: Customer Account (they owe us)
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: customer.ledgerAccountId,
          debitAmount: parsed.totalAmount,
          creditAmount: "0",
          narration: `Container sale - ${voucherNumber}`,
        });

        // Credit: Commission Revenue Account
        await tx.insert(voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: commissionAccountId,
          debitAmount: "0",
          creditAmount: parsed.totalAmount,
          narration: `Container sale commission - ${voucherNumber}`,
        });

        // Create container sale record with voucher reference
        const [createdSale] = await tx
          .insert(containerSales)
          .values({
            ...parsed,
            commissionAccountId,
            voucherId: voucher.id,
          })
          .returning();

        // Update container status to SOLD
        await tx.update(containers).set({ status: "SOLD" }).where(eq(containers.id, parsed.containerId));

        return createdSale;
      });

      res.status(201).json(sale);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Inter-Company Transfers
  app.get("/api/inter-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      // Get all transfers where current company is either sender or receiver
      const transfers = await storage.getAllInterCompanyTransfers(req.session.currentCompanyId);
      res.json(transfers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/inter-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const parsed = insertInterCompanyTransferSchema.parse(req.body);

      // Verify both companies, accounts, and inter-company ledgers in parallel
      const [fromCompany, toCompany, fromAccount, toAccount, fromCompanyAccounts, toCompanyAccounts] =
        await Promise.all([
          storage.getCompanyById(parsed.fromCompanyId),
          storage.getCompanyById(parsed.toCompanyId),
          storage.getLedgerAccountById(parsed.fromLedgerAccountId),
          storage.getLedgerAccountById(parsed.toLedgerAccountId),
          storage.getAllLedgerAccounts(parsed.fromCompanyId),
          storage.getAllLedgerAccounts(parsed.toCompanyId),
        ]);

      if (!fromCompany) return res.status(404).json({ message: "From company not found" });
      if (!toCompany) return res.status(404).json({ message: "To company not found" });
      if (!fromAccount || fromAccount.companyId !== parsed.fromCompanyId) {
        return res.status(404).json({ message: "From ledger account not found or doesn't belong to from company" });
      }
      if (!toAccount || toAccount.companyId !== parsed.toCompanyId) {
        return res.status(404).json({ message: "To ledger account not found or doesn't belong to to company" });
      }

      // Get or create inter-company accounts for both companies
      let fromInterCompanyAccount = fromCompanyAccounts.find((a: any) => a.code === `IC-TO-${toCompany.code}`);

      if (!fromInterCompanyAccount) {
        fromInterCompanyAccount = await storage.createLedgerAccount({
          companyId: parsed.fromCompanyId,
          code: `IC-TO-${toCompany.code}`,
          name: `Inter-Company - ${toCompany.name}`,
          accountType: parsed.transferType === "Loan" ? "Asset" : "Asset",
          openingBalance: "0",
          active: true,
        });
      }

      let toInterCompanyAccount = toCompanyAccounts.find((a: any) => a.code === `IC-FROM-${fromCompany.code}`);

      if (!toInterCompanyAccount) {
        toInterCompanyAccount = await storage.createLedgerAccount({
          companyId: parsed.toCompanyId,
          code: `IC-FROM-${fromCompany.code}`,
          name: `Inter-Company - ${fromCompany.name}`,
          accountType: parsed.transferType === "Loan" ? "Liability" : "Liability",
          openingBalance: "0",
          active: true,
        });
      }

      // Create voucher in FROM company
      const fromVoucherNumber = `ICT-FROM-${Date.now()}`;
      const [fromVoucher] = await db
        .insert(vouchers)
        .values({
          companyId: parsed.fromCompanyId,
          voucherNumber: fromVoucherNumber,
          voucherType: "Payment",
          voucherDate: parsed.transferDate,
          description: parsed.description || `Inter-company transfer to ${toCompany.name}`,
          totalAmount: parsed.amount,
        })
        .returning();

      // Create voucher entries for FROM company
      // Debit: Inter-company account (asset - they owe us)
      await db.insert(voucherEntries).values({
        voucherId: fromVoucher.id,
        ledgerAccountId: fromInterCompanyAccount.id,
        debitAmount: parsed.amount,
        creditAmount: "0",
        narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
      });

      // Credit: Source account (cash/bank)
      await db.insert(voucherEntries).values({
        voucherId: fromVoucher.id,
        ledgerAccountId: parsed.fromLedgerAccountId,
        debitAmount: "0",
        creditAmount: parsed.amount,
        narration: `Transfer to ${toCompany.name} - ${fromVoucherNumber}`,
      });

      // Create voucher in TO company
      const toVoucherNumber = `ICT-TO-${Date.now()}`;
      const [toVoucher] = await db
        .insert(vouchers)
        .values({
          companyId: parsed.toCompanyId,
          voucherNumber: toVoucherNumber,
          voucherType: "Receipt",
          voucherDate: parsed.transferDate,
          description: parsed.description || `Inter-company transfer from ${fromCompany.name}`,
          totalAmount: parsed.amount,
        })
        .returning();

      // Create voucher entries for TO company
      // Debit: Destination account (cash/bank)
      await db.insert(voucherEntries).values({
        voucherId: toVoucher.id,
        ledgerAccountId: parsed.toLedgerAccountId,
        debitAmount: parsed.amount,
        creditAmount: "0",
        narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
      });

      // Credit: Inter-company account (liability - we owe them)
      await db.insert(voucherEntries).values({
        voucherId: toVoucher.id,
        ledgerAccountId: toInterCompanyAccount.id,
        debitAmount: "0",
        creditAmount: parsed.amount,
        narration: `Transfer from ${fromCompany.name} - ${toVoucherNumber}`,
      });

      // Create inter-company transfer record
      const transfer = await storage.createInterCompanyTransfer({
        ...parsed,
        fromVoucherId: fromVoucher.id,
        toVoucherId: toVoucher.id,
      });

      res.status(201).json(transfer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // ─── Intercompany POS Auto-Transfer Config ────────────────────────────────────

  // ─── Simple Company Transfer (Option A – clean move, no IC accounts) ──────────

  // Get ledger accounts for any company the current user has access to
  app.get("/api/company-accounts/:companyId", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = parseInt(req.params.companyId);
      const userId = req.session.userId!;
      // Allow access if the user is currently operating as this company (session), or has an explicit role.
      const isCurrentCompany = req.session.currentCompanyId === companyId;
      if (!isCurrentCompany) {
        const userRoles = await storage.getUserCompaniesWithRoles(userId);
        const hasAccess = userRoles.some((r: any) => r.companyId === companyId);
        if (!hasAccess) return res.status(403).json({ message: "No access to this company" });
      }
      const accounts = await storage.getAllLedgerAccounts(companyId, true);
      res.json(accounts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // List all simple transfers for the current company (sender or receiver)
  app.get("/api/simple-company-transfers", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await db
        .select()
        .from(interCompanyTransfers)
        .where(or(eq(interCompanyTransfers.fromCompanyId, companyId), eq(interCompanyTransfers.toCompanyId, companyId)))
        .orderBy(desc(interCompanyTransfers.createdAt));

      // Enrich with company names and accounts (filter to only relevant account IDs)
      const transferAccountIds = Array.from(
        new Set(
          [
            ...transfers.map((t: any) => t.fromLedgerAccountId),
            ...transfers.map((t: any) => t.toLedgerAccountId),
          ].filter(Boolean)
        )
      ) as number[];
      const [allCompanies, allAccounts] = await Promise.all([
        storage.getAllCompanies(),
        transferAccountIds.length > 0
          ? db.select().from(ledgerAccounts).where(inArray(ledgerAccounts.id, transferAccountIds))
          : Promise.resolve([] as any[]),
      ]);
      const companyMap = new Map(allCompanies.map((c: any) => [c.id, c]));
      const accountMap = new Map(allAccounts.map((a: any) => [a.id, a]));

      const enriched = transfers.map((t: any) => ({
        ...t,
        fromCompanyName: (companyMap.get(t.fromCompanyId) as any)?.name ?? "Unknown",
        toCompanyName: (companyMap.get(t.toCompanyId) as any)?.name ?? "Unknown",
        fromAccountName: (accountMap.get(t.fromLedgerAccountId) as any)?.name ?? "Unknown",
        toAccountName: (accountMap.get(t.toLedgerAccountId) as any)?.name ?? "Unknown",
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const simpleTransferSchema = z.object({
    fromCompanyId: z.number(),
    toCompanyId: z.number(),
    fromLedgerAccountId: z.number(),
    toLedgerAccountId: z.number(),
    amount: z.string(),
    transferDate: z.string(),
    description: z.string().optional(),
  });

  // Create a simple transfer
  app.post("/api/simple-company-transfer", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const parsed = simpleTransferSchema.parse(req.body);
      const amt = parseFloat(parsed.amount);
      if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: "Amount must be positive" });

      // Verify user has access to both companies
      const userRoles = await storage.getUserCompaniesWithRoles(userId);
      const accessIds = userRoles.map((r: any) => r.companyId);
      if (!accessIds.includes(parsed.fromCompanyId) || !accessIds.includes(parsed.toCompanyId)) {
        return res.status(403).json({ message: "No access to one or both companies" });
      }

      const fromCompany = await storage.getCompanyById(parsed.fromCompanyId);
      const toCompany = await storage.getCompanyById(parsed.toCompanyId);
      if (!fromCompany || !toCompany) return res.status(404).json({ message: "Company not found" });

      const desc = parsed.description || `Transfer to ${toCompany.name}`;

      // Helper: get or create a "Transfer Clearing" account in a company
      async function getOrCreateClearingAccount(companyId: number) {
        const accounts = await storage.getAllLedgerAccounts(companyId);
        const existing = accounts.find((a: any) => a.code === "TRANSFER-CLEARING");
        if (existing) return existing;
        return storage.createLedgerAccount({
          companyId,
          code: "TRANSFER-CLEARING",
          name: "Transfer Clearing",
          accountType: "Equity",
          openingBalance: "0",
          active: true,
        });
      }

      const fromClearing = await getOrCreateClearingAccount(parsed.fromCompanyId);
      const toClearing = await getOrCreateClearingAccount(parsed.toCompanyId);

      // ── Voucher in FROM company ────────────────────────────────────────────
      // Credit: source account (balance goes DOWN — money leaves)
      // Debit:  Transfer Clearing (internal, user doesn't see as IC)
      const [fromVoucher] = await db
        .insert(vouchers)
        .values({
          companyId: parsed.fromCompanyId,
          voucherNumber: `TR-OUT-${Date.now()}`,
          voucherType: "Payment",
          voucherDate: parsed.transferDate,
          description: `${desc} → ${toCompany.name}`,
          totalAmount: parsed.amount,
          optional: false,
        })
        .returning();

      await db.insert(voucherEntries).values([
        {
          voucherId: fromVoucher.id,
          ledgerAccountId: fromClearing.id,
          debitAmount: parsed.amount,
          creditAmount: "0",
          narration: `Transfer out to ${toCompany.name}`,
        },
        {
          voucherId: fromVoucher.id,
          ledgerAccountId: parsed.fromLedgerAccountId,
          debitAmount: "0",
          creditAmount: parsed.amount,
          narration: `Transfer out to ${toCompany.name}`,
        },
      ]);

      // ── Voucher in TO company ──────────────────────────────────────────────
      // Debit:  destination account (balance goes UP — money arrives)
      // Credit: Transfer Clearing (internal)
      const [toVoucher] = await db
        .insert(vouchers)
        .values({
          companyId: parsed.toCompanyId,
          voucherNumber: `TR-IN-${Date.now()}`,
          voucherType: "Receipt",
          voucherDate: parsed.transferDate,
          description: `Transfer from ${fromCompany.name}`,
          totalAmount: parsed.amount,
          optional: false,
        })
        .returning();

      await db.insert(voucherEntries).values([
        {
          voucherId: toVoucher.id,
          ledgerAccountId: parsed.toLedgerAccountId,
          debitAmount: parsed.amount,
          creditAmount: "0",
          narration: `Transfer in from ${fromCompany.name}`,
        },
        {
          voucherId: toVoucher.id,
          ledgerAccountId: toClearing.id,
          debitAmount: "0",
          creditAmount: parsed.amount,
          narration: `Transfer in from ${fromCompany.name}`,
        },
      ]);

      // ── Record the transfer link ───────────────────────────────────────────
      const [transfer] = await db
        .insert(interCompanyTransfers)
        .values({
          transferType: "Cash",
          fromCompanyId: parsed.fromCompanyId,
          toCompanyId: parsed.toCompanyId,
          transferDate: parsed.transferDate,
          amount: parsed.amount,
          fromLedgerAccountId: parsed.fromLedgerAccountId,
          toLedgerAccountId: parsed.toLedgerAccountId,
          fromVoucherId: fromVoucher.id,
          toVoucherId: toVoucher.id,
          description: desc,
        })
        .returning();

      res.status(201).json(transfer);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Undo (delete) a simple transfer — removes both vouchers and the record
  app.delete("/api/simple-company-transfer/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [transfer] = await db.select().from(interCompanyTransfers).where(eq(interCompanyTransfers.id, id));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      // Verify user has access to both companies
      const userId = req.session.userId!;
      const userRoles = await storage.getUserCompaniesWithRoles(userId);
      const accessIds = userRoles.map((r: any) => r.companyId);
      if (!accessIds.includes(transfer.fromCompanyId) || !accessIds.includes(transfer.toCompanyId)) {
        return res.status(403).json({ message: "No access to one or both companies" });
      }

      // Delete voucher entries and vouchers for both sides
      if (transfer.fromVoucherId) {
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.fromVoucherId));
        await db.delete(vouchers).where(eq(vouchers.id, transfer.fromVoucherId));
      }
      if (transfer.toVoucherId) {
        await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, transfer.toVoucherId));
        await db.delete(vouchers).where(eq(vouchers.id, transfer.toVoucherId));
      }

      // Delete the transfer record
      await db.delete(interCompanyTransfers).where(eq(interCompanyTransfers.id, id));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
