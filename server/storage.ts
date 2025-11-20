import { eq, and, or, sql, inArray, desc, ne } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import type {
  User,
  InsertUser,
  Company,
  InsertCompany,
  UserCompanyRole,
  InsertUserCompanyRole,
  Location,
  InsertLocation,
  LedgerAccount,
  InsertLedgerAccount,
  Employee,
  InsertEmployee,
  Supplier,
  InsertSupplier,
  StockGroup,
  InsertStockGroup,
  StockItem,
  InsertStockItem,
  BankAccount,
  InsertBankAccount,
  FixedAsset,
  InsertFixedAsset,
  Container,
  InsertContainer,
  PurchaseOrder,
  InsertPurchaseOrder,
  POLineItem,
  InsertPOLineItem,
  ContainerCharge,
  InsertContainerCharge,
  ImportLog,
  InsertImportLog,
  ContainerOffload,
  InsertContainerOffload,
  Voucher,
  InsertVoucher,
  VoucherEntry,
  InsertVoucherEntry,
  StockTransferVoucher,
  StockTransferItem,
  StockAdjustmentVoucher,
  StockAdjustmentItem,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User>;
  getUserCompanyRole(userId: string, companyId: number): Promise<schema.UserCompanyRole | undefined>;

  // Companies
  getAllCompanies(): Promise<Company[]>;
  getCompanyById(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;

  // User-Company Roles
  getUserCompaniesWithRoles(userId: string): Promise<UserCompanyRole[]>;
  createUserCompanyRole(role: InsertUserCompanyRole): Promise<UserCompanyRole>;
  updateUserCompanyRole(id: number, updates: Partial<InsertUserCompanyRole>): Promise<UserCompanyRole>;
  deleteUserCompanyRole(id: number): Promise<void>;

  // Locations
  getAllLocations(companyId: number): Promise<Location[]>;
  getLocationById(id: number): Promise<Location | undefined>;
  getLocationByCode(code: string, companyId: number): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  deleteLocation(id: number): Promise<void>;

  // Ledger Accounts
  getAllLedgerAccounts(companyId: number): Promise<LedgerAccount[]>;
  getLedgerAccountById(id: number): Promise<LedgerAccount | undefined>;
  getLedgerAccountByCode(code: string, companyId: number): Promise<LedgerAccount | undefined>;
  getLedgerAccountByName(name: string, companyId: number): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;
  updateLedgerAccount(account: schema.UpdateLedgerAccount): Promise<LedgerAccount>;
  deleteLedgerAccount(id: number): Promise<void>;

  // Employees
  getAllEmployees(companyId: number): Promise<Employee[]>;
  getEmployeesWithBalances(companyId: number): Promise<Array<Employee & { calculatedBalance: string }>>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  deleteEmployee(id: number, forceDelete?: boolean): Promise<{success: boolean, message?: string, employeeBalance?: number, ledgerBalance?: number}>;

  // Employee Groups
  getAllEmployeeGroups(companyId: number): Promise<schema.EmployeeGroup[]>;
  getEmployeeGroupById(id: number): Promise<schema.EmployeeGroup | undefined>;
  createEmployeeGroup(group: schema.InsertEmployeeGroup): Promise<schema.EmployeeGroup>;
  updateEmployeeGroup(id: number, updates: Partial<schema.InsertEmployeeGroup>): Promise<schema.EmployeeGroup>;
  deleteEmployeeGroup(id: number): Promise<void>;
  getEmployeeGroupMembers(groupId: number): Promise<any[]>;
  addEmployeeToGroup(groupId: number, employeeId: number): Promise<void>;
  removeEmployeeFromGroup(groupId: number, employeeId: number): Promise<void>;

  // Suppliers
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplierByCode(code: string): Promise<Supplier | undefined>;
  getSupplierById(id: number): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, updates: Partial<InsertSupplier>): Promise<Supplier>;

  // Stock Groups
  getAllStockGroups(companyId: number): Promise<StockGroup[]>;
  getStockGroupByCode(code: string, companyId: number): Promise<StockGroup | undefined>;
  createStockGroup(group: InsertStockGroup): Promise<StockGroup>;

  // Stock Items
  getAllStockItems(companyId: number): Promise<StockItem[]>;
  getStockItemByCode(code: string, companyId: number): Promise<StockItem | undefined>;
  getStockItemByCodeOrAlias(code: string, companyId: number): Promise<StockItem | undefined>;
  getStockItemById(id: number): Promise<StockItem | undefined>;
  createStockItem(item: InsertStockItem): Promise<StockItem>;
  updateStockItem(id: number, updates: Partial<InsertStockItem>): Promise<StockItem>;
  deleteStockItem(id: number): Promise<void>;
  bulkGetStockItemsByIds(ids: number[], companyId: number): Promise<StockItem[]>;
  bulkDeleteStockItems(ids: number[]): Promise<void>;
  
  // Stock Item Code Aliases
  getStockItemCodeAliases(stockItemId: number): Promise<schema.StockItemCodeAlias[]>;
  getStockItemCodeAliasById(id: number): Promise<schema.StockItemCodeAlias | undefined>;
  createStockItemCodeAlias(alias: schema.InsertStockItemCodeAlias): Promise<schema.StockItemCodeAlias>;
  deleteStockItemCodeAlias(id: number): Promise<void>;

  // Bank Accounts
  getAllBankAccounts(companyId: number): Promise<BankAccount[]>;
  getBankAccountByCode(code: string): Promise<BankAccount | undefined>;
  getBankAccountById(id: number, companyId: number): Promise<BankAccount | undefined>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(id: number, updates: Partial<InsertBankAccount>, companyId: number): Promise<BankAccount>;
  deleteBankAccount(id: number, companyId: number): Promise<void>;

  // Fixed Assets
  getAllFixedAssets(companyId: number): Promise<FixedAsset[]>;
  getFixedAssetByCode(code: string): Promise<FixedAsset | undefined>;
  createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset>;

  // Containers
  getAllContainers(companyId: number): Promise<Container[]>;
  getActiveContainers(companyId: number): Promise<Container[]>;
  getSoldContainers(companyId: number): Promise<any[]>;
  getContainerById(id: number): Promise<Container | undefined>;
  getContainerByNumber(containerNumber: string): Promise<Container | undefined>;
  createContainer(container: InsertContainer): Promise<Container>;
  updateContainer(id: number, updates: Partial<InsertContainer>): Promise<Container>;
  deleteContainer(id: number): Promise<void>;

  // Purchase Orders
  getAllPurchaseOrders(companyId: number): Promise<PurchaseOrder[]>;
  getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined>;
  getPurchaseOrdersByContainer(containerId: number): Promise<PurchaseOrder[]>;
  getPurchaseOrdersBySupplier(supplierId: number, companyId: number): Promise<any[]>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder>;
  deletePurchaseOrder(id: number): Promise<void>;

  // PO Line Items
  getLineItemsByPO(poId: number): Promise<POLineItem[]>;
  createPOLineItem(lineItem: InsertPOLineItem): Promise<POLineItem>;

  // Container Charges
  getChargesByContainer(containerId: number): Promise<ContainerCharge[]>;
  createContainerCharge(charge: InsertContainerCharge): Promise<ContainerCharge>;

  // Import Logs
  getImportLogByHash(hash: string): Promise<ImportLog | undefined>;
  createImportLog(log: InsertImportLog): Promise<ImportLog>;

  // Stock Items - Additional methods for barcode lookup
  getStockItemByBarcode(barcode: string): Promise<StockItem | undefined>;

  // Inventory - Location-based stock tracking
  getLocationInventory(locationId: number): Promise<any[]>;
  getCompanyInventory(companyId: number): Promise<any[]>;
  updateInventory(locationId: number, stockItemId: number, quantity: string, averageRate: string, totalValue: string): Promise<void>;

  // Container Offload
  offloadContainer(
    containerId: number, 
    locationId: number, 
    duties: string, 
    dutiesAccountId: number | null | undefined,
    officeCharges: string,
    officeChargesAccountId: number | null | undefined,
    officeChargesCashAccountId: number | null | undefined,
    transferCharges: string, 
    transportFees: string,
    transportAccountId: number | null | undefined,
    additionalCharges?: Array<{ description: string; amount: number; ledgerAccountId: number }>
  ): Promise<ContainerOffload>;

  // Vouchers and Journal Entries
  getAllVouchers(companyId: number): Promise<Voucher[]>;
  getVoucherById(id: number): Promise<Voucher | undefined>;
  getVouchersByDateRange(startDate: string, endDate: string): Promise<any[]>;
  getVoucherEntriesByLedger(ledgerAccountId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByBankAccount(bankAccountId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByFixedAsset(fixedAssetId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesBySupplier(supplierId: number, companyId?: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByEmployee(employeeId: number, companyId?: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByVoucher(voucherId: number): Promise<VoucherEntry[]>;
  getStockItemTransactions(stockItemId: number, companyId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getContainerCountBySupplier(supplierId: number, companyId?: number): Promise<number>;
  createVoucher(voucher: InsertVoucher): Promise<Voucher>;
  updateVoucher(id: number, updates: Partial<InsertVoucher>): Promise<Voucher>;
  createVoucherEntry(entry: InsertVoucherEntry): Promise<VoucherEntry>;
  updateVoucherEntry(id: number, updates: Partial<InsertVoucherEntry>): Promise<VoucherEntry>;
  updateStockTransferItem(id: number, updates: Partial<{ stockItemId: number; quantity: string; rate: string }>): Promise<StockTransferItem>;
  updateStockAdjustmentItem(id: number, updates: Partial<{ stockItemId: number; quantity: string; rate: string }>): Promise<StockAdjustmentItem>;
  deleteVoucherEntry(id: number): Promise<void>;
  deleteVoucher(id: number): Promise<void>;

  // Fiscal Period Closing
  closeFiscalPeriod(
    companyId: number,
    periodStartDate: string,
    periodEndDate: string,
    retainedEarningsAccountId: number,
    closedByUserId: string,
    notes?: string
  ): Promise<schema.FiscalPeriodClosure>;
  getFiscalPeriodClosures(companyId: number): Promise<schema.FiscalPeriodClosure[]>;

  // Stock Transfers
  createStockTransfer(voucherId: number, destinationLocationId: number, notes: string, items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>): Promise<any>;
  getStockTransferByVoucherId(voucherId: number): Promise<any | null>;
  updateStockTransfer(id: number, destinationLocationId: number, notes: string, items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>): Promise<any>;

  // Stock Adjustments
  createStockAdjustment(voucherId: number, locationId: number, adjustmentType: "Production" | "Consumption" | "Mixed", notes: string, items: Array<{stockItemId: number, quantity: string, rate: string}>): Promise<any>;
  getStockAdjustmentByVoucherId(voucherId: number): Promise<any | null>;
  updateStockAdjustment(id: number, locationId: number, adjustmentType: "Production" | "Consumption" | "Mixed", notes: string, items: Array<{stockItemId: number, quantity: string, rate: string}>): Promise<any>;

  // Stock Query
  getLastPurchaseOrderForItem(stockItemId: number, companyId: number): Promise<any | null>;
  getLastSaleForItem(stockItemId: number, companyId: number): Promise<any | null>;
  getAllPurchasesForItem(stockItemId: number, companyId: number): Promise<any[]>;
  getAllSalesForItem(stockItemId: number, companyId: number): Promise<any[]>;
  getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]>;
  getVoucherHistoryForItem(stockItemId: number, companyId: number): Promise<any[]>;

  // Customers
  getAllCustomers(companyId: number): Promise<schema.Customer[]>;
  getCustomerById(id: number): Promise<schema.Customer | undefined>;
  getCustomerByCode(code: string, companyId: number): Promise<schema.Customer | undefined>;
  createCustomer(customer: schema.InsertCustomer): Promise<schema.Customer>;
  updateCustomer(id: number, updates: Partial<schema.InsertCustomer>): Promise<schema.Customer>;

  // Container Sales
  getAllContainerSales(companyId: number): Promise<schema.ContainerSale[]>;
  getContainerSaleById(id: number): Promise<schema.ContainerSale | undefined>;
  getContainerSalesByCustomer(customerId: number): Promise<schema.ContainerSale[]>;
  getContainerSalesByContainer(containerId: number): Promise<schema.ContainerSale | undefined>;
  createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale>;

  // Inter-Company Transfers
  getAllInterCompanyTransfers(companyId?: number): Promise<schema.InterCompanyTransfer[]>;
  getInterCompanyTransferById(id: number): Promise<schema.InterCompanyTransfer | undefined>;
  createInterCompanyTransfer(transfer: schema.InsertInterCompanyTransfer): Promise<schema.InterCompanyTransfer>;

  // Salary Advances
  getAllSalaryAdvances(companyId: number): Promise<schema.SalaryAdvance[]>;
  getSalaryAdvanceById(id: number): Promise<schema.SalaryAdvance | undefined>;
  getSalaryAdvancesByEmployee(employeeId: number): Promise<schema.SalaryAdvance[]>;
  getUnpaidSalaryAdvancesByEmployee(employeeId: number): Promise<schema.SalaryAdvance[]>;
  createSalaryAdvance(advance: schema.InsertSalaryAdvance): Promise<schema.SalaryAdvance>;
  updateSalaryAdvance(id: number, updates: Partial<schema.InsertSalaryAdvance>): Promise<schema.SalaryAdvance>;

  // Salary Advance Deductions
  getSalaryAdvanceDeductions(salaryAdvanceId: number): Promise<schema.SalaryAdvanceDeduction[]>;
  createSalaryAdvanceDeduction(deduction: schema.InsertSalaryAdvanceDeduction): Promise<schema.SalaryAdvanceDeduction>;

  // Draft POS Sales
  getAllDraftPosSales(userId: string, locationId?: number): Promise<schema.DraftPosSale[]>;
  getDraftPosSaleById(id: number): Promise<any | undefined>;
  createDraftPosSale(draft: schema.InsertDraftPosSale, items: Array<{stockItemId: number, quantity: string, rate: string, amount: string}>): Promise<schema.DraftPosSale>;
  updateDraftPosSale(id: number, draft: Partial<schema.InsertDraftPosSale>, items?: Array<{stockItemId: number, quantity: string, rate: string, amount: string}>): Promise<schema.DraftPosSale>;
  deleteDraftPosSale(id: number): Promise<void>;

  // Company Settings
  getCompanySettings(companyId: number): Promise<schema.CompanySettings | undefined>;
  upsertCompanySettings(settings: schema.InsertCompanySettings): Promise<schema.CompanySettings>;

  // Bales
  getAllBales(companyId: number): Promise<schema.Bale[]>;
  getBaleById(id: number): Promise<schema.Bale | undefined>;
  getBaleByBarcode(barcode: string, companyId: number): Promise<schema.Bale | undefined>;
  createBale(bale: schema.InsertBale): Promise<schema.Bale>;
  updateBale(id: number, updates: Partial<schema.InsertBale>): Promise<schema.Bale>;
  deleteBale(id: number): Promise<void>;
  bulkCreateBales(bales: schema.InsertBale[]): Promise<schema.Bale[]>;
}

export class DbStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(schema.users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(schema.users);
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(schema.users).set(updates).where(eq(schema.users.id, id)).returning();
    return user;
  }

  async getUserCompanyRole(userId: string, companyId: number): Promise<schema.UserCompanyRole | undefined> {
    const [role] = await db
      .select()
      .from(schema.userCompanyRoles)
      .where(
        and(
          eq(schema.userCompanyRoles.userId, userId),
          eq(schema.userCompanyRoles.companyId, companyId)
        )
      );
    return role;
  }

  // Companies
  async getAllCompanies(): Promise<Company[]> {
    return await db.select().from(schema.companies);
  }

  async getCompanyById(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(schema.companies).values(company).returning();
    return created;
  }

  // User-Company Roles
  async getUserCompaniesWithRoles(userId: string): Promise<UserCompanyRole[]> {
    return await db
      .select()
      .from(schema.userCompanyRoles)
      .where(eq(schema.userCompanyRoles.userId, userId));
  }

  async createUserCompanyRole(role: InsertUserCompanyRole): Promise<UserCompanyRole> {
    const [created] = await db.insert(schema.userCompanyRoles).values(role).returning();
    return created;
  }

  async updateUserCompanyRole(id: number, updates: Partial<InsertUserCompanyRole>): Promise<UserCompanyRole> {
    const [updated] = await db
      .update(schema.userCompanyRoles)
      .set(updates)
      .where(eq(schema.userCompanyRoles.id, id))
      .returning();
    return updated;
  }

  async deleteUserCompanyRole(id: number): Promise<void> {
    await db.delete(schema.userCompanyRoles).where(eq(schema.userCompanyRoles.id, id));
  }

  // Locations
  async getAllLocations(companyId: number): Promise<Location[]> {
    console.log('[storage.getAllLocations] Querying locations for companyId:', companyId);
    const locations = await db.select().from(schema.locations).where(eq(schema.locations.companyId, companyId));
    console.log('[storage.getAllLocations] Query returned:', locations.length, 'locations');
    return locations;
  }

  async getLocationById(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
    return location;
  }

  async getLocationByCode(code: string, companyId: number): Promise<Location | undefined> {
    const [location] = await db.select().from(schema.locations).where(
      and(eq(schema.locations.code, code), eq(schema.locations.companyId, companyId))
    );
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(schema.locations).values(location as any).returning();
    return created;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.delete(schema.locations).where(eq(schema.locations.id, id));
  }

  // Ledger Accounts
  async getAllLedgerAccounts(companyId: number): Promise<LedgerAccount[]> {
    return await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.companyId, companyId));
  }

  async getLedgerAccountByCode(code: string, companyId: number): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(
      and(eq(schema.ledgerAccounts.code, code), eq(schema.ledgerAccounts.companyId, companyId))
    );
    return account;
  }

  async getLedgerAccountByName(name: string, companyId: number): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(
      and(eq(schema.ledgerAccounts.name, name), eq(schema.ledgerAccounts.companyId, companyId))
    );
    return account;
  }

  async createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
    const [created] = await db.insert(schema.ledgerAccounts).values([account as any]).returning();
    return created;
  }

  async deleteLedgerAccount(id: number): Promise<void> {
    await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, id));
  }

  async getLedgerAccountById(id: number): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.id, id));
    return account;
  }

  async updateLedgerAccount(account: schema.UpdateLedgerAccount): Promise<LedgerAccount> {
    const { id, ...updates } = account;
    const [updated] = await db
      .update(schema.ledgerAccounts)
      .set(updates)
      .where(eq(schema.ledgerAccounts.id, id))
      .returning();
    return updated;
  }

  // Employees
  async getAllEmployees(companyId: number): Promise<Employee[]> {
    const employees = await db.select().from(schema.employees).where(eq(schema.employees.companyId, companyId));
    // Ensure camelCase mapping works correctly
    return employees.map(emp => ({
      ...emp,
      firstName: (emp as any).firstName || (emp as any).first_name,
      lastName: (emp as any).lastName || (emp as any).last_name,
    })) as Employee[];
  }

  async getEmployeesWithBalances(companyId: number): Promise<Array<Employee & { calculatedBalance: string }>> {
    // Get all employees for the company
    const employees = await this.getAllEmployees(companyId);
    
    // Calculate balance for each employee from their voucher transactions
    const employeesWithBalances = await Promise.all(
      employees.map(async (employee) => {
        // Get all voucher entries for this employee
        const entries = await db
          .select({
            debitAmount: schema.voucherEntries.debitAmount,
            creditAmount: schema.voucherEntries.creditAmount,
          })
          .from(schema.voucherEntries)
          .innerJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
          .where(
            and(
              eq(schema.voucherEntries.employeeId, employee.id),
              eq(schema.vouchers.companyId, companyId)
            )
          );

        // Calculate balance: opening balance + credits - debits
        // Credits increase payable (we owe them salary), Debits decrease payable (we paid them)
        const openingBalance = parseFloat(employee.openingBalance || "0");
        const transactionBalance = entries.reduce((sum, entry) => {
          const credit = parseFloat(entry.creditAmount || "0");
          const debit = parseFloat(entry.debitAmount || "0");
          return sum + credit - debit;
        }, 0);
        
        const calculatedBalance = openingBalance + transactionBalance;

        return {
          ...employee,
          calculatedBalance: calculatedBalance.toFixed(2),
        };
      })
    );

    return employeesWithBalances;
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.code, code));
    return employee;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [created] = await db.insert(schema.employees).values([employee as any]).returning();
    return created;
  }

  async deleteEmployee(id: number, forceDelete: boolean = false): Promise<{success: boolean, message?: string, employeeBalance?: number, ledgerBalance?: number}> {
    return await db.transaction(async (tx) => {
      // Get the employee
      const [employee] = await tx
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.id, id));

      if (!employee) {
        return { success: false, message: "Employee not found" };
      }

      // Check if employee has any salary advances
      const salaryAdvances = await tx
        .select()
        .from(schema.salaryAdvances)
        .where(eq(schema.salaryAdvances.employeeId, id))
        .limit(1);

      if (salaryAdvances.length > 0) {
        return { 
          success: false, 
          message: "Cannot delete employee with salary advances. Please remove all salary advances first." 
        };
      }

      // Check employee's current balance
      const employeeBalance = parseFloat(employee.currentBalance || "0");
      
      // Find linked ledger account by matching employee code
      const [linkedAccount] = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.code, employee.code),
            eq(schema.ledgerAccounts.companyId, employee.companyId)
          )
        );

      let ledgerBalance = 0;

      if (linkedAccount) {
        // Check if ledger account has any voucher entries
        const voucherEntries = await tx
          .select({ id: schema.voucherEntries.id })
          .from(schema.voucherEntries)
          .where(eq(schema.voucherEntries.ledgerAccountId, linkedAccount.id))
          .limit(1);

        if (voucherEntries.length > 0) {
          return { 
            success: false, 
            message: "Cannot delete employee. The linked ledger account has transaction history." 
          };
        }

        // Calculate ledger account balance from opening balance
        const openingBalance = parseFloat(linkedAccount.openingBalance || "0");
        const openingSide = linkedAccount.openingBalanceSide || "Dr";
        ledgerBalance = openingSide === "Dr" ? openingBalance : -openingBalance;
      }

      // If either balance is non-zero and forceDelete is false, require confirmation
      if (!forceDelete && (Math.abs(employeeBalance) > 0.01 || Math.abs(ledgerBalance) > 0.01)) {
        return {
          success: false,
          message: "Employee or linked account has a non-zero balance. Admin confirmation required.",
          employeeBalance: employeeBalance,
          ledgerBalance: ledgerBalance
        };
      }

      // Proceed with deletion
      if (linkedAccount) {
        // Delete linked ledger account
        await tx
          .delete(schema.ledgerAccounts)
          .where(eq(schema.ledgerAccounts.id, linkedAccount.id));
      }

      // Remove employee from any groups
      await tx
        .delete(schema.employeeGroupMembers)
        .where(eq(schema.employeeGroupMembers.employeeId, id));

      // Delete the employee
      await tx
        .delete(schema.employees)
        .where(eq(schema.employees.id, id));

      return { success: true };
    });
  }

  // Employee Groups
  async getAllEmployeeGroups(companyId: number): Promise<schema.EmployeeGroup[]> {
    return await db.select().from(schema.employeeGroups).where(eq(schema.employeeGroups.companyId, companyId));
  }

  async getEmployeeGroupById(id: number): Promise<schema.EmployeeGroup | undefined> {
    const [group] = await db.select().from(schema.employeeGroups).where(eq(schema.employeeGroups.id, id));
    return group;
  }

  async createEmployeeGroup(group: schema.InsertEmployeeGroup): Promise<schema.EmployeeGroup> {
    const [created] = await db.insert(schema.employeeGroups).values(group).returning();
    return created;
  }

  async updateEmployeeGroup(id: number, updates: Partial<schema.InsertEmployeeGroup>): Promise<schema.EmployeeGroup> {
    const [updated] = await db
      .update(schema.employeeGroups)
      .set(updates)
      .where(eq(schema.employeeGroups.id, id))
      .returning();
    return updated;
  }

  async deleteEmployeeGroup(id: number): Promise<void> {
    // First, delete all members
    await db.delete(schema.employeeGroupMembers).where(eq(schema.employeeGroupMembers.employeeGroupId, id));
    // Then delete the group
    await db.delete(schema.employeeGroups).where(eq(schema.employeeGroups.id, id));
  }

  async getEmployeeGroupMembers(groupId: number): Promise<any[]> {
    const results = await db
      .select({
        id: schema.employeeGroupMembers.id,
        employeeId: schema.employees.id,
        employeeCode: schema.employees.code,
        firstName: schema.employees.firstName,
        lastName: schema.employees.lastName,
        email: schema.employees.email,
        department: schema.employees.department,
      })
      .from(schema.employeeGroupMembers)
      .leftJoin(schema.employees, eq(schema.employeeGroupMembers.employeeId, schema.employees.id))
      .where(eq(schema.employeeGroupMembers.employeeGroupId, groupId));
    return results;
  }

  async addEmployeeToGroup(groupId: number, employeeId: number): Promise<void> {
    // Check if already exists
    const [existing] = await db
      .select()
      .from(schema.employeeGroupMembers)
      .where(
        and(
          eq(schema.employeeGroupMembers.employeeGroupId, groupId),
          eq(schema.employeeGroupMembers.employeeId, employeeId)
        )
      );
    
    if (!existing) {
      await db.insert(schema.employeeGroupMembers).values({
        employeeGroupId: groupId,
        employeeId: employeeId,
      });
    }
  }

  async removeEmployeeFromGroup(groupId: number, employeeId: number): Promise<void> {
    await db
      .delete(schema.employeeGroupMembers)
      .where(
        and(
          eq(schema.employeeGroupMembers.employeeGroupId, groupId),
          eq(schema.employeeGroupMembers.employeeId, employeeId)
        )
      );
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return await db.select().from(schema.suppliers);
  }

  async getSupplierByCode(code: string): Promise<Supplier | undefined> {
    const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.code, code));
    return supplier;
  }

  async getSupplierById(id: number): Promise<Supplier | undefined> {
    const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
    return supplier;
  }

  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    const [created] = await db.insert(schema.suppliers).values(supplier as any).returning();
    return created;
  }

  async updateSupplier(id: number, updates: Partial<InsertSupplier>): Promise<Supplier> {
    const [updated] = await db
      .update(schema.suppliers)
      .set(updates)
      .where(eq(schema.suppliers.id, id))
      .returning();
    return updated;
  }

  // Stock Groups
  async getAllStockGroups(companyId: number): Promise<StockGroup[]> {
    return await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.companyId, companyId));
  }

  async getStockGroupByCode(code: string, companyId: number): Promise<StockGroup | undefined> {
    const [group] = await db.select().from(schema.stockGroups).where(
      and(
        eq(schema.stockGroups.code, code),
        eq(schema.stockGroups.companyId, companyId)
      )
    );
    return group;
  }

  async createStockGroup(group: InsertStockGroup): Promise<StockGroup> {
    const [created] = await db.insert(schema.stockGroups).values(group).returning();
    return created;
  }

  // Stock Items
  async getAllStockItems(companyId: number): Promise<StockItem[]> {
    return await db.select().from(schema.stockItems).where(eq(schema.stockItems.companyId, companyId));
  }

  async getStockItemByCode(code: string, companyId: number): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(
      and(
        eq(schema.stockItems.code, code),
        eq(schema.stockItems.companyId, companyId)
      )
    );
    return item;
  }

  async getStockItemById(id: number): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.id, id));
    return item;
  }

  async createStockItem(item: InsertStockItem): Promise<StockItem> {
    const [created] = await db.insert(schema.stockItems).values(item).returning();
    return created;
  }

  async updateStockItem(id: number, updates: Partial<InsertStockItem>): Promise<StockItem> {
    const [updated] = await db
      .update(schema.stockItems)
      .set(updates)
      .where(eq(schema.stockItems.id, id))
      .returning();
    return updated;
  }

  async deleteStockItem(id: number): Promise<void> {
    await db
      .delete(schema.stockItems)
      .where(eq(schema.stockItems.id, id));
  }

  async bulkGetStockItemsByIds(ids: number[], companyId: number): Promise<StockItem[]> {
    if (ids.length === 0) return [];
    return await db
      .select()
      .from(schema.stockItems)
      .where(
        and(
          inArray(schema.stockItems.id, ids),
          eq(schema.stockItems.companyId, companyId)
        )
      );
  }

  async bulkDeleteStockItems(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .delete(schema.stockItems)
      .where(inArray(schema.stockItems.id, ids));
  }

  async getStockItemByCodeOrAlias(code: string, companyId: number): Promise<StockItem | undefined> {
    // First check if it matches a primary code (case-insensitive)
    const [directMatch] = await db
      .select()
      .from(schema.stockItems)
      .where(
        and(
          sql`LOWER(${schema.stockItems.code}) = LOWER(${code})`,
          eq(schema.stockItems.companyId, companyId)
        )
      )
      .limit(1);
    
    if (directMatch) {
      return directMatch;
    }

    // If not found, check if it matches any alias (case-insensitive)
    const [aliasMatch] = await db
      .select({
        stockItem: schema.stockItems,
      })
      .from(schema.stockItemCodeAliases)
      .innerJoin(
        schema.stockItems,
        eq(schema.stockItemCodeAliases.stockItemId, schema.stockItems.id)
      )
      .where(
        and(
          sql`LOWER(${schema.stockItemCodeAliases.aliasCode}) = LOWER(${code})`,
          eq(schema.stockItemCodeAliases.companyId, companyId),
          eq(schema.stockItems.companyId, companyId)
        )
      )
      .limit(1);

    return aliasMatch?.stockItem;
  }

  // Stock Item Code Aliases
  async getStockItemCodeAliases(stockItemId: number): Promise<schema.StockItemCodeAlias[]> {
    return await db
      .select()
      .from(schema.stockItemCodeAliases)
      .where(eq(schema.stockItemCodeAliases.stockItemId, stockItemId));
  }

  async getStockItemCodeAliasById(id: number): Promise<schema.StockItemCodeAlias | undefined> {
    const [alias] = await db
      .select()
      .from(schema.stockItemCodeAliases)
      .where(eq(schema.stockItemCodeAliases.id, id))
      .limit(1);
    return alias;
  }

  async createStockItemCodeAlias(alias: schema.InsertStockItemCodeAlias): Promise<schema.StockItemCodeAlias> {
    const [created] = await db
      .insert(schema.stockItemCodeAliases)
      .values(alias)
      .returning();
    return created;
  }

  async deleteStockItemCodeAlias(id: number): Promise<void> {
    await db
      .delete(schema.stockItemCodeAliases)
      .where(eq(schema.stockItemCodeAliases.id, id));
  }

  // Bank Accounts
  async getAllBankAccounts(companyId: number): Promise<BankAccount[]> {
    return await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.companyId, companyId));
  }

  async getBankAccountByCode(code: string): Promise<BankAccount | undefined> {
    const [account] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.code, code));
    return account;
  }

  async getBankAccountById(id: number, companyId: number): Promise<BankAccount | undefined> {
    const [account] = await db.select()
      .from(schema.bankAccounts)
      .where(
        and(
          eq(schema.bankAccounts.id, id),
          eq(schema.bankAccounts.companyId, companyId)
        )
      );
    return account;
  }

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [created] = await db.insert(schema.bankAccounts).values(account).returning();
    return created;
  }

  async updateBankAccount(id: number, updates: Partial<InsertBankAccount>, companyId: number): Promise<BankAccount> {
    // Get the existing account scoped to company
    const existing = await this.getBankAccountById(id, companyId);
    if (!existing) {
      throw new Error("Bank account not found");
    }

    // If updating code, check uniqueness within company
    if (updates.code && updates.code !== existing.code) {
      const [duplicate] = await db.select()
        .from(schema.bankAccounts)
        .where(
          and(
            eq(schema.bankAccounts.code, updates.code),
            eq(schema.bankAccounts.companyId, companyId),
            ne(schema.bankAccounts.id, id)
          )
        );
      
      if (duplicate) {
        throw new Error("Bank account code already exists in this company");
      }
    }

    // Update the account - scoped to both id AND companyId
    const [updated] = await db.update(schema.bankAccounts)
      .set(updates)
      .where(
        and(
          eq(schema.bankAccounts.id, id),
          eq(schema.bankAccounts.companyId, companyId)
        )
      )
      .returning();
    
    if (!updated) {
      throw new Error("Bank account not found");
    }
    
    return updated;
  }

  async deleteBankAccount(id: number, companyId: number): Promise<void> {
    // Verify account exists and belongs to company
    const existing = await this.getBankAccountById(id, companyId);
    if (!existing) {
      throw new Error("Bank account not found");
    }

    // Check if bank account has any voucher entries
    const entries = await db.select({ count: sql<number>`count(*)` })
      .from(schema.voucherEntries)
      .where(eq(schema.voucherEntries.bankAccountId, id));

    const entryCount = entries[0]?.count || 0;
    if (entryCount > 0) {
      throw new Error(`Cannot delete bank account: ${entryCount} voucher entries exist`);
    }

    // Safe to delete - scoped to both id AND companyId
    await db.delete(schema.bankAccounts)
      .where(
        and(
          eq(schema.bankAccounts.id, id),
          eq(schema.bankAccounts.companyId, companyId)
        )
      );
  }

  // Fixed Assets
  async getAllFixedAssets(companyId: number): Promise<FixedAsset[]> {
    return await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, companyId));
  }

  async getFixedAssetByCode(code: string): Promise<FixedAsset | undefined> {
    const [asset] = await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.code, code));
    return asset;
  }

  async createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset> {
    const [created] = await db.insert(schema.fixedAssets).values(asset).returning();
    return created;
  }

  // Containers
  async getAllContainers(companyId: number): Promise<Container[]> {
    return await db.select().from(schema.containers).where(eq(schema.containers.companyId, companyId));
  }

  async getActiveContainers(companyId: number): Promise<Container[]> {
    return await db.select().from(schema.containers)
      .where(
        and(
          eq(schema.containers.companyId, companyId),
          ne(schema.containers.status, 'SOLD')
        )
      );
  }

  async getSoldContainers(companyId: number): Promise<any[]> {
    const results = await db
      .select({
        containerId: schema.containers.id,
        containerNumber: schema.containers.containerNumber,
        supplierId: schema.containers.supplierId,
        status: schema.containers.status,
        importDate: schema.containers.importDate,
        itemsTotal: schema.containers.itemsTotal,
        chargesTotal: schema.containers.chargesTotal,
        grandTotal: schema.containers.grandTotal,
        saleId: schema.containerSales.id,
        customerId: schema.containerSales.customerId,
        customerName: schema.customers.legalName,
        saleDate: schema.containerSales.saleDate,
        containerCost: schema.containerSales.containerCost,
        commission: schema.containerSales.commission,
        commissionAccountId: schema.containerSales.commissionAccountId,
        totalAmount: schema.containerSales.totalAmount,
        notes: schema.containerSales.notes,
      })
      .from(schema.containers)
      .innerJoin(schema.containerSales, eq(schema.containers.id, schema.containerSales.containerId))
      .innerJoin(schema.customers, eq(schema.containerSales.customerId, schema.customers.id))
      .where(
        and(
          eq(schema.containers.companyId, companyId),
          eq(schema.containers.status, 'SOLD')
        )
      )
      .orderBy(sql`${schema.containerSales.saleDate} DESC`);
    
    return results;
  }

  async getContainerById(id: number): Promise<Container | undefined> {
    const [container] = await db.select().from(schema.containers).where(eq(schema.containers.id, id));
    return container;
  }

  async getContainerByNumber(containerNumber: string): Promise<Container | undefined> {
    const [container] = await db.select().from(schema.containers).where(eq(schema.containers.containerNumber, containerNumber));
    return container;
  }

  async createContainer(container: InsertContainer): Promise<Container> {
    const [created] = await db.insert(schema.containers).values(container).returning();
    return created;
  }

  async updateContainer(id: number, updates: Partial<InsertContainer>): Promise<Container> {
    const [updated] = await db.update(schema.containers)
      .set(updates)
      .where(eq(schema.containers.id, id))
      .returning();
    return updated;
  }

  // Purchase Orders
  async getAllPurchaseOrders(companyId: number): Promise<PurchaseOrder[]> {
    return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, companyId));
  }

  async getPurchaseOrderById(id: number): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
    return po;
  }

  async getPurchaseOrdersByContainer(containerId: number): Promise<PurchaseOrder[]> {
    return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.containerId, containerId));
  }

  async getPurchaseOrdersBySupplier(supplierId: number, companyId: number): Promise<any[]> {
    const query = db
      .select({
        id: schema.purchaseOrders.id,
        poNumber: schema.purchaseOrders.poNumber,
        containerNumber: schema.containers.containerNumber,
        itemsTotal: schema.purchaseOrders.itemsTotal,
        currency: schema.purchaseOrders.currency,
        status: schema.purchaseOrders.status,
        createdAt: schema.purchaseOrders.createdAt,
        voucherId: schema.purchaseOrders.voucherId,
      })
      .from(schema.purchaseOrders)
      .leftJoin(schema.containers, eq(schema.purchaseOrders.containerId, schema.containers.id))
      .where(
        and(
          eq(schema.purchaseOrders.supplierId, supplierId),
          eq(schema.purchaseOrders.companyId, companyId)
        )
      )
      .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`);

    return await query;
  }

  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [created] = await db.insert(schema.purchaseOrders).values(po).returning();
    return created;
  }

  async updatePurchaseOrder(id: number, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder> {
    const [updated] = await db.update(schema.purchaseOrders)
      .set(updates)
      .where(eq(schema.purchaseOrders.id, id))
      .returning();
    return updated;
  }

  async deletePurchaseOrder(id: number): Promise<void> {
    // Get the PO first to get container info
    const [po] = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.id, id))
      .limit(1);

    if (!po) {
      throw new Error("Purchase order not found");
    }

    const containerId = po.containerId;
    const poTotal = parseFloat(po.itemsTotal || "0");

    // Delete PO line items
    await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, id));

    // Delete the PO
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));

    // Delete the voucher if it exists
    if (po.voucherId) {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, po.voucherId));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, po.voucherId));
    }

    // Check if there are any remaining POs for this container
    const remainingPOs = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.containerId, containerId))
      .limit(1);

    if (remainingPOs.length === 0) {
      // Delete the container and all its charges if no POs remain
      await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
      await db.delete(schema.importLogs).where(eq(schema.importLogs.containerId, containerId));
      await db.delete(schema.containers).where(eq(schema.containers.id, containerId));
    } else {
      // Update container totals
      const [container] = await db
        .select()
        .from(schema.containers)
        .where(eq(schema.containers.id, containerId))
        .limit(1);

      if (container) {
        const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - poTotal);
        const chargesTotal = parseFloat(container.chargesTotal || "0");
        const newGrandTotal = newItemsTotal + chargesTotal;

        await db
          .update(schema.containers)
          .set({
            itemsTotal: newItemsTotal.toString(),
            grandTotal: newGrandTotal.toString(),
          })
          .where(eq(schema.containers.id, containerId));
      }
    }
  }

  async deleteContainer(id: number): Promise<void> {
    // Get all purchase orders in this container
    const pos = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.containerId, id));

    // Delete each PO (which cascades to line items and vouchers)
    for (const po of pos) {
      // Delete PO line items
      await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, po.id));

      // Delete the voucher if it exists
      if (po.voucherId) {
        await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, po.voucherId));
        await db.delete(schema.vouchers).where(eq(schema.vouchers.id, po.voucherId));
      }

      // Delete the PO
      await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id));
    }

    // Delete container charges
    await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, id));

    // Delete import log entry to allow re-upload of the same file
    await db.delete(schema.importLogs).where(eq(schema.importLogs.containerId, id));

    // Delete the container
    await db.delete(schema.containers).where(eq(schema.containers.id, id));
  }

  // PO Line Items
  async getLineItemsByPO(poId: number): Promise<POLineItem[]> {
    const items = await db
      .select({
        id: schema.poLineItems.id,
        poId: schema.poLineItems.poId,
        stockItemId: schema.poLineItems.stockItemId,
        stockItemCode: schema.stockItems.code,
        stockItemName: schema.poLineItems.itemName,
        itemName: schema.poLineItems.itemName,
        quantity: schema.poLineItems.quantity,
        rate: schema.poLineItems.rate,
        lineTotal: schema.poLineItems.lineTotal,
        createdAt: schema.poLineItems.createdAt,
        totalCost: schema.poLineItems.lineTotal,
      })
      .from(schema.poLineItems)
      .leftJoin(schema.stockItems, eq(schema.poLineItems.stockItemId, schema.stockItems.id))
      .where(eq(schema.poLineItems.poId, poId));
    
    return items as any;
  }

  async createPOLineItem(lineItem: InsertPOLineItem): Promise<POLineItem> {
    const [created] = await db.insert(schema.poLineItems).values(lineItem).returning();
    return created;
  }

  // Container Charges
  async getChargesByContainer(containerId: number): Promise<ContainerCharge[]> {
    return await db.select().from(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
  }

  async createContainerCharge(charge: InsertContainerCharge): Promise<ContainerCharge> {
    const [created] = await db.insert(schema.containerCharges).values(charge).returning();
    return created;
  }

  // Import Logs
  async getImportLogByHash(hash: string): Promise<ImportLog | undefined> {
    const [log] = await db.select().from(schema.importLogs).where(eq(schema.importLogs.fileHash, hash));
    return log;
  }

  async createImportLog(log: InsertImportLog): Promise<ImportLog> {
    const [created] = await db.insert(schema.importLogs).values(log).returning();
    return created;
  }

  // Stock Items - Code/Barcode lookup
  async getStockItemByBarcode(barcode: string): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.code, barcode));
    return item;
  }

  // Inventory - Location-based stock tracking
  async getLocationInventory(locationId: number): Promise<any[]> {
    // First, get the basic inventory data
    const results = await db
      .select({
        inventoryId: schema.inventory.id,
        locationId: schema.inventory.locationId,
        stockItemId: schema.inventory.stockItemId,
        quantity: schema.inventory.quantity,
        averageRate: schema.inventory.averageRate,
        totalValue: schema.inventory.totalValue,
        lastUpdated: schema.inventory.lastUpdated,
        stockItemCode: schema.stockItems.code,
        stockItemName: schema.stockItems.name,
        stockItemUom: schema.stockItems.uom,
        stockGroupId: schema.stockItems.stockGroupId,
        stockGroupName: sql<string>`COALESCE(${schema.stockGroups.name}, '')`,
        stockGroupCode: sql<string>`COALESCE(${schema.stockGroups.code}, '')`,
      })
      .from(schema.inventory)
      .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .where(eq(schema.inventory.locationId, locationId));
    
    // Get last selling prices for all stock items in this location
    const stockItemIds = results.map(r => r.stockItemId);
    
    if (stockItemIds.length === 0) {
      return results;
    }
    
    // Query to get the most recent selling price for each stock item
    const lastPrices = await db
      .select({
        stockItemId: schema.salesItems.stockItemId,
        lastSellingPrice: schema.salesItems.sellingPrice,
        voucherId: schema.salesItems.voucherId,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(
        inArray(schema.salesItems.stockItemId, stockItemIds),
        eq(schema.vouchers.locationId, locationId)
      ))
      .orderBy(desc(schema.vouchers.voucherDate))
      .execute();
    
    // Create a map of stockItemId -> last selling price
    const priceMap = new Map<number, string>();
    for (const price of lastPrices) {
      if (!priceMap.has(price.stockItemId)) {
        priceMap.set(price.stockItemId, price.lastSellingPrice);
      }
    }
    
    // Add lastSellingPrice to results
    return results.map(item => ({
      ...item,
      lastSellingPrice: priceMap.get(item.stockItemId) || item.averageRate,
    }));
  }

  async getCompanyInventory(companyId: number): Promise<any[]> {
    const results = await db
      .select({
        inventoryId: schema.inventory.id,
        locationId: schema.inventory.locationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        stockItemId: schema.inventory.stockItemId,
        quantity: schema.inventory.quantity,
        averageRate: schema.inventory.averageRate,
        totalValue: schema.inventory.totalValue,
        lastUpdated: schema.inventory.lastUpdated,
        stockItemCode: schema.stockItems.code,
        stockItemName: schema.stockItems.name,
        stockItemUom: schema.stockItems.uom,
        stockGroupId: schema.stockItems.stockGroupId,
        stockGroupName: sql<string>`COALESCE(${schema.stockGroups.name}, '')`,
        stockGroupCode: sql<string>`COALESCE(${schema.stockGroups.code}, '')`,
      })
      .from(schema.inventory)
      .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .leftJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
      .where(eq(schema.inventory.companyId, companyId));
    
    return results;
  }

  async updateInventory(locationId: number, stockItemId: number, quantity: string, averageRate: string, totalValue: string): Promise<void> {
    // Get the location's companyId
    const [location] = await db
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId));
    
    if (!location) {
      throw new Error("Location not found");
    }

    // Check if inventory record exists
    const [existing] = await db
      .select()
      .from(schema.inventory)
      .where(and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.stockItemId, stockItemId)
      ));

    if (existing) {
      // Update existing record
      await db
        .update(schema.inventory)
        .set({
          quantity,
          averageRate,
          totalValue,
          lastUpdated: new Date(),
        })
        .where(eq(schema.inventory.id, existing.id));
    } else {
      // Create new record
      await db.insert(schema.inventory).values({
        companyId: location.companyId,
        locationId,
        stockItemId,
        quantity,
        averageRate,
        totalValue,
        lastUpdated: new Date(),
      });
    }
  }

  // Container Offload
  async offloadContainer(
    containerId: number, 
    locationId: number, 
    duties: string, 
    dutiesAccountId: number | null | undefined,
    officeCharges: string,
    officeChargesAccountId: number | null | undefined,
    officeChargesCashAccountId: number | null | undefined,
    transferCharges: string, 
    transportFees: string,
    transportAccountId: number | null | undefined,
    additionalCharges: Array<{ description: string; amount: number; ledgerAccountId: number }> = []
  ): Promise<ContainerOffload> {
    // Get all POs for this container
    const pos = await this.getPurchaseOrdersByContainer(containerId);
    
    // Get all line items for all POs
    const allLineItems: POLineItem[] = [];
    for (const po of pos) {
      const items = await this.getLineItemsByPO(po.id);
      allLineItems.push(...items);
    }

    // Calculate total bales (sum of all quantities) - exclude invalid items
    const totalBales = allLineItems.reduce((sum, item) => {
      // Skip invalid line items
      if (!item.stockItemId || item.stockItemId === 0) {
        return sum;
      }
      return sum + parseFloat(item.quantity);
    }, 0);

    // Calculate total charges including additional charges
    const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
    const totalCharges = 
      parseFloat(duties) + 
      parseFloat(officeCharges) + 
      parseFloat(transferCharges) + 
      parseFloat(transportFees) +
      additionalChargesTotal;

    // Calculate additional cost per bale
    const additionalCostPerBale = totalBales > 0 ? totalCharges / totalBales : 0;

    // Group line items by stock item and calculate new rates
    const itemsMap = new Map<number, { 
      stockItemId: number; 
      totalQuantity: number; 
      weightedRateSum: number;
    }>();

    for (const item of allLineItems) {
      const stockItemId = item.stockItemId;
      
      // Skip invalid line items with stockItemId = 0 or null
      if (!stockItemId || stockItemId === 0) {
        console.warn(`Skipping line item ${item.id} - invalid stock item ID: ${stockItemId}`);
        continue;
      }
      
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      
      if (itemsMap.has(stockItemId)) {
        const existing = itemsMap.get(stockItemId)!;
        existing.totalQuantity += quantity;
        existing.weightedRateSum += rate * quantity;
      } else {
        itemsMap.set(stockItemId, {
          stockItemId,
          totalQuantity: quantity,
          weightedRateSum: rate * quantity,
        });
      }
    }

    // Add inventory to destination location with weighted average cost
    for (const [stockItemId, data] of Array.from(itemsMap.entries())) {
      // Safety check for division by zero
      if (data.totalQuantity === 0) {
        console.error("Skipping item with zero quantity:", stockItemId);
        continue;
      }
      
      const averageOriginalRate = data.weightedRateSum / data.totalQuantity;
      const newRate = averageOriginalRate + additionalCostPerBale;
      
      // Safety check for infinity
      if (!isFinite(newRate)) {
        throw new Error(`Calculated rate is infinite for stock item ${stockItemId}. averageRate=${averageOriginalRate}, additionalCost=${additionalCostPerBale}`);
      }
      
      // Check if inventory exists
      const [existing] = await db
        .select()
        .from(schema.inventory)
        .where(and(
          eq(schema.inventory.locationId, locationId),
          eq(schema.inventory.stockItemId, stockItemId)
        ));

      if (existing) {
        // Add to existing inventory with weighted average rate
        const existingQty = parseFloat(existing.quantity);
        const existingRate = parseFloat(existing.averageRate);
        
        // Handle corrupt negative inventory - replace instead of add
        if (existingQty < 0) {
          console.warn(`Detected corrupt negative inventory for stock item ${stockItemId} at location ${locationId}. Existing qty: ${existingQty}. Replacing with new qty: ${data.totalQuantity}`);
          
          const newTotalValue = data.totalQuantity * newRate;
          
          await db
            .update(schema.inventory)
            .set({
              quantity: data.totalQuantity.toString(),
              averageRate: newRate.toFixed(2),
              totalValue: newTotalValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, existing.id));
          continue;
        }
        
        const newQty = existingQty + data.totalQuantity;
        
        // Safety check for division by zero
        if (newQty <= 0) {
          throw new Error(`New quantity is ${newQty} for stock item ${stockItemId}. Existing: ${existingQty}, Adding: ${data.totalQuantity}. This indicates corrupt inventory data.`);
        }
        
        const weightedAvgRate = ((existingQty * existingRate) + (data.totalQuantity * newRate)) / newQty;
        
        // Safety check for infinity
        if (!isFinite(weightedAvgRate)) {
          throw new Error(`Calculated weighted average rate is infinite for stock item ${stockItemId}. existingQty=${existingQty}, existingRate=${existingRate}, newQty=${newQty}, newRate=${newRate}`);
        }
        
        const newTotalValue = newQty * weightedAvgRate;

        await db
          .update(schema.inventory)
          .set({
            quantity: newQty.toString(),
            averageRate: weightedAvgRate.toFixed(2),
            totalValue: newTotalValue.toFixed(2),
            lastUpdated: new Date(),
          })
          .where(eq(schema.inventory.id, existing.id));
      } else {
        // Create new inventory record
        const [location] = await db
          .select()
          .from(schema.locations)
          .where(eq(schema.locations.id, locationId));

        const totalValue = data.totalQuantity * newRate;
        await db.insert(schema.inventory).values({
          companyId: location.companyId,
          locationId,
          stockItemId,
          quantity: data.totalQuantity.toString(),
          averageRate: newRate.toFixed(2),
          totalValue: totalValue.toFixed(2),
          lastUpdated: new Date(),
        });
      }
    }

    // Update container status to OFFLOADED
    await this.updateContainer(containerId, { status: "OFFLOADED" });

    // Get container and location details for voucher entries
    const container = await this.getContainerById(containerId);
    const location = await this.getLocationById(locationId);
    
    if (!container || !location) {
      throw new Error("Container or location not found");
    }

    // Create voucher entries for charges with associated supplier accounts
    const voucherDate = new Date().toISOString().split('T')[0];
    
    // Helper function to find or create expense accounts
    const findOrCreateExpenseAccount = async (code: string, name: string) => {
      let account = await db
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, code)
          )
        )
        .limit(1);

      if (!account.length) {
        const [newAccount] = await db.insert(schema.ledgerAccounts).values({
          companyId: location.companyId,
          code,
          name,
          accountType: "Expense",
          subType: "Direct Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
        }).returning();
        account = [newAccount];
      }

      return account[0].id;
    };
    
    // Duties voucher entry
    if (dutiesAccountId && parseFloat(duties) > 0) {
      const dutiesExpenseAccountId = await findOrCreateExpenseAccount("DUTIES", "Duties");
      const voucherNumber = `DUTY-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Duties for container ${container.containerNumber}`,
        totalAmount: duties,
      }).returning();

      // Debit: Duties Expense (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: dutiesExpenseAccountId,
        debitAmount: duties,
        creditAmount: "0",
        narration: `Duties for container ${container.containerNumber}`,
      });

      // Credit: Duty Agent account (Liability increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: dutiesAccountId,
        debitAmount: "0",
        creditAmount: duties,
        narration: `Duties for container ${container.containerNumber}`,
      });
    }

    // Office charges voucher entry
    if (officeChargesAccountId && officeChargesCashAccountId && parseFloat(officeCharges) > 0) {
      const officeExpenseAccountId = await findOrCreateExpenseAccount("OFFICE_CHARGES", "Office Charges");
      const voucherNumber = `OFFICE-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Office charges for container ${container.containerNumber}`,
        totalAmount: officeCharges,
      }).returning();

      // Debit: Office Charges Expense (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: officeExpenseAccountId,
        debitAmount: officeCharges,
        creditAmount: "0",
        narration: `Office charges for container ${container.containerNumber}`,
      });

      // Credit: Cash Account (Cash decreases - money set aside)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: officeChargesCashAccountId,
        debitAmount: "0",
        creditAmount: officeCharges,
        narration: `Office charges for container ${container.containerNumber}`,
      });
    }

    // Transport fees voucher entry
    if (transportAccountId && parseFloat(transportFees) > 0) {
      const transportExpenseAccountId = await findOrCreateExpenseAccount("TRANSPORT", "Transport Charges");
      const voucherNumber = `TRANS-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Transport fees for container ${container.containerNumber}`,
        totalAmount: transportFees,
      }).returning();

      // Debit: Transport Expense (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: transportExpenseAccountId,
        debitAmount: transportFees,
        creditAmount: "0",
        narration: `Transport fees for container ${container.containerNumber}`,
      });

      // Credit: Transporter account (Liability increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: transportAccountId,
        debitAmount: "0",
        creditAmount: transportFees,
        narration: `Transport fees for container ${container.containerNumber}`,
      });
    }

    // Transfer charges (if any)
    if (parseFloat(transferCharges) > 0) {
      const transferExpenseAccountId = await findOrCreateExpenseAccount("TRANSFER_CHARGES", "Transfer Charges");
      // Note: Transfer charges don't have a supplier account, so we'll need to specify one in the UI
      // For now, we'll skip creating a voucher entry if no supplier is specified
    }

    // Additional charges voucher entries
    for (const charge of additionalCharges) {
      if (charge.amount > 0) {
        const voucherNumber = `CHG-${container.containerNumber}-${Date.now()}`;
        const [voucher] = await db.insert(schema.vouchers).values({
          companyId: location.companyId,
          voucherNumber,
          voucherType: "Payment",
          voucherDate,
          description: `${charge.description} for container ${container.containerNumber}`,
          totalAmount: charge.amount.toFixed(2),
        }).returning();

        // Debit: Additional Charge Expense (Expense increases)
        const additionalExpenseAccountId = await findOrCreateExpenseAccount(
          "ADDITIONAL_CHARGES", 
          "Additional Container Charges"
        );
        await db.insert(schema.voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: additionalExpenseAccountId,
          debitAmount: charge.amount.toFixed(2),
          creditAmount: "0",
          narration: `${charge.description} for container ${container.containerNumber}`,
        });

        // Credit: Specified ledger account (Liability increases)
        await db.insert(schema.voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: charge.ledgerAccountId,
          debitAmount: "0",
          creditAmount: charge.amount.toFixed(2),
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
      }
    }

    // Create offload record with all calculated values
    const [offload] = await db.insert(schema.containerOffloads).values({
      containerId,
      locationId,
      duties,
      officeCharges,
      transferCharges,
      transportFees,
      totalCharges: totalCharges.toFixed(2),
      totalBales: totalBales.toFixed(3),
      additionalCostPerBale: additionalCostPerBale.toFixed(2),
    }).returning();

    return offload;
  }

  // Vouchers and Journal Entries
  async getAllVouchers(companyId: number): Promise<Voucher[]> {
    return await db.select().from(schema.vouchers).where(eq(schema.vouchers.companyId, companyId));
  }

  async getVoucherById(id: number): Promise<Voucher | undefined> {
    const [voucher] = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id));
    return voucher;
  }

  async getVouchersByDateRange(startDate: string, endDate: string): Promise<any[]> {
    const vouchers = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          sql`${schema.vouchers.voucherDate} >= ${startDate}`,
          sql`${schema.vouchers.voucherDate} <= ${endDate}`
        )
      );
    return vouchers;
  }

  async getVoucherEntriesByLedger(
    ledgerAccountId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.ledgerAccountId, ledgerAccountId),
      eq(schema.vouchers.optional, false)
    ];
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    const query = db
      .select({
        entryId: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        voucherDescription: schema.vouchers.description,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions));

    return await query;
  }

  async getVoucherEntriesByBankAccount(
    bankAccountId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.bankAccountId, bankAccountId),
      eq(schema.vouchers.optional, false)
    ];
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    const query = db
      .select({
        entryId: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        voucherDescription: schema.vouchers.description,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions));

    return await query;
  }

  async getVoucherEntriesByFixedAsset(
    fixedAssetId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.fixedAssetId, fixedAssetId),
      eq(schema.vouchers.optional, false)
    ];
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    const query = db
      .select({
        entryId: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        voucherDescription: schema.vouchers.description,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions));

    return await query;
  }

  async getVoucherEntriesBySupplier(
    supplierId: number,
    companyId?: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.supplierId, supplierId),
      eq(schema.vouchers.optional, false)
    ];
    
    if (companyId) {
      conditions.push(eq(schema.vouchers.companyId, companyId));
    }
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    const query = db
      .select({
        entryId: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        voucherDescription: schema.vouchers.description,
        companyId: schema.vouchers.companyId,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`);

    return await query;
  }

  async getVoucherEntriesByEmployee(
    employeeId: number,
    companyId?: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.employeeId, employeeId),
      eq(schema.vouchers.optional, false)
    ];
    
    if (companyId) {
      conditions.push(eq(schema.vouchers.companyId, companyId));
    }
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    const query = db
      .select({
        entryId: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        voucherDescription: schema.vouchers.description,
        companyId: schema.vouchers.companyId,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`);

    return await query;
  }

  async getContainerCountBySupplier(supplierId: number, companyId?: number): Promise<number> {
    const conditions = [eq(schema.containers.supplierId, supplierId)];
    
    if (companyId !== undefined) {
      conditions.push(eq(schema.containers.companyId, companyId));
    }
    
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.containers)
      .where(and(...conditions));
    
    return result[0]?.count || 0;
  }

  async createVoucher(voucher: InsertVoucher): Promise<Voucher> {
    const [created] = await db.insert(schema.vouchers).values(voucher).returning();
    return created;
  }

  async updateVoucher(id: number, updates: Partial<InsertVoucher>): Promise<Voucher> {
    const [updated] = await db
      .update(schema.vouchers)
      .set(updates)
      .where(eq(schema.vouchers.id, id))
      .returning();
    return updated;
  }

  async getVoucherEntriesByVoucher(voucherId: number): Promise<any[]> {
    const entries = await db
      .select({
        id: schema.voucherEntries.id,
        voucherId: schema.voucherEntries.voucherId,
        ledgerAccountId: schema.voucherEntries.ledgerAccountId,
        bankAccountId: schema.voucherEntries.bankAccountId,
        fixedAssetId: schema.voucherEntries.fixedAssetId,
        supplierId: schema.voucherEntries.supplierId,
        employeeId: schema.voucherEntries.employeeId,
        debitAmount: schema.voucherEntries.debitAmount,
        creditAmount: schema.voucherEntries.creditAmount,
        narration: schema.voucherEntries.narration,
        createdAt: schema.voucherEntries.createdAt,
        accountName: schema.ledgerAccounts.name,
        accountCode: schema.ledgerAccounts.code,
        bankAccountName: schema.bankAccounts.name,
        bankAccountCode: schema.bankAccounts.code,
        fixedAssetName: schema.fixedAssets.name,
        fixedAssetCode: schema.fixedAssets.code,
        supplierName: schema.suppliers.legalName,
        supplierCode: schema.suppliers.code,
        employeeFirstName: schema.employees.firstName,
        employeeLastName: schema.employees.lastName,
        employeeCode: schema.employees.code,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.ledgerAccounts, eq(schema.voucherEntries.ledgerAccountId, schema.ledgerAccounts.id))
      .leftJoin(schema.bankAccounts, eq(schema.voucherEntries.bankAccountId, schema.bankAccounts.id))
      .leftJoin(schema.fixedAssets, eq(schema.voucherEntries.fixedAssetId, schema.fixedAssets.id))
      .leftJoin(schema.suppliers, eq(schema.voucherEntries.supplierId, schema.suppliers.id))
      .leftJoin(schema.employees, eq(schema.voucherEntries.employeeId, schema.employees.id))
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    return entries.map(entry => {
      const employeeName = entry.employeeFirstName && entry.employeeLastName 
        ? `${entry.employeeFirstName} ${entry.employeeLastName}` 
        : null;
      
      return {
        ...entry,
        accountName: entry.accountName || entry.bankAccountName || entry.fixedAssetName || entry.supplierName || employeeName || 'Unknown Account',
        accountCode: entry.accountCode || entry.bankAccountCode || entry.fixedAssetCode || entry.supplierCode || entry.employeeCode || '-',
      };
    });
  }

  async getStockItemTransactions(stockItemId: number, companyId: number, startDate?: string, endDate?: string): Promise<any[]> {
    const conditions: any[] = [eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)];
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    // Get sales items for this stock item
    const salesItems = await db
      .select({
        id: schema.salesItems.id,
        type: sql<string>`'sales'`.as('type'),
        voucherId: schema.salesItems.voucherId,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherDate: schema.vouchers.voucherDate,
        quantity: schema.salesItems.quantity,
        rate: schema.salesItems.sellingPrice,
        totalAmount: schema.salesItems.totalSales,
        stockItemId: schema.salesItems.stockItemId,
        notes: schema.vouchers.description,
      })
      .from(schema.salesItems)
      .leftJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .where(and(eq(schema.salesItems.stockItemId, stockItemId), ...conditions));

    // Get stock transfer items for this stock item
    const transferItems = await db
      .select({
        id: schema.stockTransferItems.id,
        type: sql<string>`'transfer'`.as('type'),
        voucherId: schema.stockTransferVouchers.voucherId,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherDate: schema.vouchers.voucherDate,
        quantity: schema.stockTransferItems.quantity,
        rate: schema.stockTransferItems.rate,
        totalAmount: schema.stockTransferItems.totalAmount,
        stockItemId: schema.stockTransferItems.stockItemId,
        notes: schema.stockTransferVouchers.notes,
      })
      .from(schema.stockTransferItems)
      .leftJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
      .leftJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
      .where(and(eq(schema.stockTransferItems.stockItemId, stockItemId), ...conditions));

    // Get stock adjustment items for this stock item
    const adjustmentItems = await db
      .select({
        id: schema.stockAdjustmentItems.id,
        type: sql<string>`'adjustment'`.as('type'),
        voucherId: schema.stockAdjustmentVouchers.voucherId,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherDate: schema.vouchers.voucherDate,
        quantity: schema.stockAdjustmentItems.quantity,
        rate: schema.stockAdjustmentItems.rate,
        totalAmount: schema.stockAdjustmentItems.totalAmount,
        stockItemId: schema.stockAdjustmentItems.stockItemId,
        notes: schema.stockAdjustmentVouchers.notes,
      })
      .from(schema.stockAdjustmentItems)
      .leftJoin(schema.stockAdjustmentVouchers, eq(schema.stockAdjustmentItems.adjustmentId, schema.stockAdjustmentVouchers.id))
      .leftJoin(schema.vouchers, eq(schema.stockAdjustmentVouchers.voucherId, schema.vouchers.id))
      .where(and(eq(schema.stockAdjustmentItems.stockItemId, stockItemId), ...conditions));

    // Combine and sort by date
    const allTransactions = [...salesItems, ...transferItems, ...adjustmentItems].sort((a, b) => {
      if (!a.voucherDate || !b.voucherDate) return 0;
      return new Date(b.voucherDate).getTime() - new Date(a.voucherDate).getTime();
    });

    return allTransactions;
  }

  async createVoucherEntry(entry: InsertVoucherEntry): Promise<VoucherEntry> {
    const [created] = await db.insert(schema.voucherEntries).values(entry).returning();
    return created;
  }

  async updateVoucherEntry(id: number, updates: Partial<InsertVoucherEntry>): Promise<VoucherEntry> {
    const [updated] = await db
      .update(schema.voucherEntries)
      .set(updates)
      .where(eq(schema.voucherEntries.id, id))
      .returning();
    return updated;
  }

  async updateStockTransferItem(id: number, updates: Partial<{ stockItemId: number; quantity: string; rate: string }>): Promise<StockTransferItem> {
    // Fetch current item to get existing values for recalculation
    const [currentItem] = await db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.id, id));
    if (!currentItem) {
      throw new Error("Stock transfer item not found");
    }

    const updateData: any = {};
    if (updates.stockItemId !== undefined) updateData.stockItemId = updates.stockItemId;
    if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
    if (updates.rate !== undefined) updateData.rate = updates.rate;
    
    // Recalculate total amount using new or existing values
    const finalQuantity = updates.quantity !== undefined ? updates.quantity : currentItem.quantity;
    const finalRate = updates.rate !== undefined ? updates.rate : currentItem.rate;
    const qty = parseFloat(finalQuantity);
    const rate = parseFloat(finalRate);
    updateData.totalAmount = (qty * rate).toFixed(2);
    
    const [updated] = await db
      .update(schema.stockTransferItems)
      .set(updateData)
      .where(eq(schema.stockTransferItems.id, id))
      .returning();
    return updated;
  }

  async updateStockAdjustmentItem(id: number, updates: Partial<{ stockItemId: number; quantity: string; rate: string }>): Promise<StockAdjustmentItem> {
    // Fetch current item to get existing values for recalculation
    const [currentItem] = await db.select().from(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.id, id));
    if (!currentItem) {
      throw new Error("Stock adjustment item not found");
    }

    const updateData: any = {};
    if (updates.stockItemId !== undefined) updateData.stockItemId = updates.stockItemId;
    if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
    if (updates.rate !== undefined) updateData.rate = updates.rate;
    
    // Recalculate total amount using new or existing values
    const finalQuantity = updates.quantity !== undefined ? updates.quantity : currentItem.quantity;
    const finalRate = updates.rate !== undefined ? updates.rate : currentItem.rate;
    const qty = parseFloat(finalQuantity);
    const rate = parseFloat(finalRate);
    updateData.totalAmount = (qty * rate).toFixed(2);
    
    const [updated] = await db
      .update(schema.stockAdjustmentItems)
      .set(updateData)
      .where(eq(schema.stockAdjustmentItems.id, id))
      .returning();
    return updated;
  }

  async deleteVoucherEntry(id: number): Promise<void> {
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.id, id));
  }

  async deleteVoucher(id: number): Promise<void> {
    // First, get the voucher to check its type and location
    const [voucher] = await db
      .select()
      .from(schema.vouchers)
      .where(eq(schema.vouchers.id, id));

    if (!voucher) {
      throw new Error("Voucher not found");
    }

    // STEP 1: Reverse inventory movements based on voucher type
    if (voucher.voucherType === "Sales" && voucher.locationId) {
      // Restore items back to location inventory
      const salesItemsList = await db
        .select()
        .from(schema.salesItems)
        .where(eq(schema.salesItems.voucherId, id));

      for (const saleItem of salesItemsList) {
        const quantity = parseFloat(saleItem.quantity);
        const costPrice = parseFloat(saleItem.costPrice);

        // Get current inventory
        const [currentInventory] = await db
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, voucher.locationId),
            eq(schema.inventory.stockItemId, saleItem.stockItemId)
          ));

        if (currentInventory) {
          // Add back the quantity
          const newQuantity = parseFloat(currentInventory.quantity) + quantity;
          const currentTotalValue = parseFloat(currentInventory.totalValue);
          const newTotalValue = currentTotalValue + (quantity * costPrice);
          const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

          await db
            .update(schema.inventory)
            .set({
              quantity: newQuantity.toFixed(3),
              averageRate: newAverageRate.toFixed(2),
              totalValue: newTotalValue.toFixed(2),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else {
          // Create new inventory record (shouldn't normally happen, but handle it)
          await db.insert(schema.inventory).values({
            companyId: voucher.companyId,
            locationId: voucher.locationId,
            stockItemId: saleItem.stockItemId,
            quantity: quantity.toFixed(3),
            averageRate: costPrice.toFixed(2),
            totalValue: (quantity * costPrice).toFixed(2),
          });
        }
      }

      // Delete sales items
      await db.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, id));
    }

    if (voucher.voucherType === "Stock Transfer") {
      // Reverse the stock transfer
      const [transferVoucher] = await db
        .select()
        .from(schema.stockTransferVouchers)
        .where(eq(schema.stockTransferVouchers.voucherId, id));

      if (transferVoucher) {
        const transferItems = await db
          .select()
          .from(schema.stockTransferItems)
          .where(eq(schema.stockTransferItems.transferId, transferVoucher.id));

        for (const item of transferItems) {
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);

          // Note: Each transfer item now has its own sourceLocationId
          // We need to get it from the item if stored, or from the transfer voucher as fallback
          const sourceLocationId = transferVoucher.sourceLocationId;
          const destinationLocationId = transferVoucher.destinationLocationId;

          // Add back to source location
          const [sourceInventory] = await db
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, sourceLocationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (sourceInventory) {
            const newQuantity = parseFloat(sourceInventory.quantity) + quantity;
            const newTotalValue = parseFloat(sourceInventory.totalValue) + (quantity * rate);
            const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(schema.inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(schema.inventory.id, sourceInventory.id));
          } else {
            await db.insert(schema.inventory).values({
              companyId: voucher.companyId,
              locationId: sourceLocationId,
              stockItemId: item.stockItemId,
              quantity: quantity.toFixed(3),
              averageRate: rate.toFixed(2),
              totalValue: (quantity * rate).toFixed(2),
            });
          }

          // Subtract from destination location
          const [destInventory] = await db
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, destinationLocationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (destInventory) {
            const newQuantity = Math.max(0, parseFloat(destInventory.quantity) - quantity);
            const newTotalValue = Math.max(0, parseFloat(destInventory.totalValue) - (quantity * rate));
            const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(schema.inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(schema.inventory.id, destInventory.id));
          }
        }

        // Delete transfer items and transfer voucher
        await db.delete(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transferVoucher.id));
        await db.delete(schema.stockTransferVouchers).where(eq(schema.stockTransferVouchers.id, transferVoucher.id));
      }
    }

    if (voucher.voucherType === "Production" || voucher.voucherType === "Consumption") {
      // Reverse stock adjustments (Production/Consumption)
      const [adjustmentVoucher] = await db
        .select()
        .from(schema.stockAdjustmentVouchers)
        .where(eq(schema.stockAdjustmentVouchers.voucherId, id));

      if (adjustmentVoucher) {
        const adjustmentItems = await db
          .select()
          .from(schema.stockAdjustmentItems)
          .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

        for (const item of adjustmentItems) {
          // Reverse the adjustment (negate the quantity)
          const quantity = parseFloat(item.quantity);
          const rate = parseFloat(item.rate);
          const reversedQuantity = -quantity; // Flip the sign to reverse

          const [currentInventory] = await db
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, adjustmentVoucher.locationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (currentInventory) {
            const newQuantity = Math.max(0, parseFloat(currentInventory.quantity) + reversedQuantity);
            const currentTotalValue = parseFloat(currentInventory.totalValue);
            const newTotalValue = Math.max(0, currentTotalValue + (reversedQuantity * rate));
            const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await db
              .update(schema.inventory)
              .set({
                quantity: newQuantity.toFixed(3),
                averageRate: newAverageRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
              })
              .where(eq(schema.inventory.id, currentInventory.id));
          }
        }

        // Delete adjustment items and adjustment voucher
        await db.delete(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));
        await db.delete(schema.stockAdjustmentVouchers).where(eq(schema.stockAdjustmentVouchers.id, adjustmentVoucher.id));
      }
    }

    // STEP 2: Handle Purchase Orders (existing logic)
    const linkedPOs = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.voucherId, id));

    if (linkedPOs.length > 0) {
      const containerUpdates = new Map<number, { itemsTotal: number }>();
      
      for (const po of linkedPOs) {
        const itemsTotal = parseFloat(po.itemsTotal || "0");
        const existing = containerUpdates.get(po.containerId) || { itemsTotal: 0 };
        containerUpdates.set(po.containerId, {
          itemsTotal: existing.itemsTotal + itemsTotal,
        });

        await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, po.id));
      }

      await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.voucherId, id));

      for (const [containerId, totals] of Array.from(containerUpdates.entries())) {
        const [container] = await db
          .select()
          .from(schema.containers)
          .where(eq(schema.containers.id, containerId))
          .limit(1);

        if (container) {
          const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - totals.itemsTotal);
          const newChargesTotal = parseFloat(container.chargesTotal || "0");
          const newGrandTotal = newItemsTotal + newChargesTotal;

          const remainingPOs = await db
            .select()
            .from(schema.purchaseOrders)
            .where(eq(schema.purchaseOrders.containerId, containerId))
            .limit(1);

          if (remainingPOs.length === 0) {
            await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
            await db.delete(schema.containers).where(eq(schema.containers.id, containerId));
          } else {
            await db
              .update(schema.containers)
              .set({
                itemsTotal: newItemsTotal.toString(),
                grandTotal: newGrandTotal.toString(),
              })
              .where(eq(schema.containers.id, containerId));
          }
        }
      }
    }

    // STEP 3: Delete voucher entries (this automatically restores account balances)
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, id));
    
    // STEP 4: Delete the voucher itself
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, id));
  }

  // Fiscal Period Closing
  async closeFiscalPeriod(
    companyId: number,
    periodStartDate: string,
    periodEndDate: string,
    retainedEarningsAccountId: number,
    closedByUserId: string,
    notes?: string
  ): Promise<schema.FiscalPeriodClosure> {
    return await db.transaction(async (tx) => {
      // Check if closure already exists for this period
      const existingClosure = await tx
        .select()
        .from(schema.fiscalPeriodClosures)
        .where(
          and(
            eq(schema.fiscalPeriodClosures.companyId, companyId),
            eq(schema.fiscalPeriodClosures.periodEndDate, periodEndDate)
          )
        );

      if (existingClosure.length > 0) {
        throw new Error(`Fiscal period ending ${periodEndDate} has already been closed`);
      }

      // Get all Income and Expense ledger accounts for this company
      const accounts = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, companyId),
            or(
              eq(schema.ledgerAccounts.accountType, "Income"),
              eq(schema.ledgerAccounts.accountType, "Expense")
            )
          )
        );

      if (accounts.length === 0) {
        throw new Error("No Income or Expense accounts found for this company");
      }

      // Calculate balances for each account
      interface AccountBalance {
        accountId: number;
        accountCode: string;
        accountName: string;
        accountType: string;
        balance: number;
      }

      const accountBalances: AccountBalance[] = [];
      let totalIncome = 0;
      let totalExpense = 0;

      for (const account of accounts) {
        // Start with opening balance
        const openingBalance = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        let balance = openingSide === "Dr" ? openingBalance : -openingBalance;

        // Get voucher entries for this account within the fiscal period only
        const entries = await tx
          .select()
          .from(schema.voucherEntries)
          .innerJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
          .where(
            and(
              eq(schema.voucherEntries.ledgerAccountId, account.id),
              sql`${schema.vouchers.voucherDate} >= ${periodStartDate}`,
              sql`${schema.vouchers.voucherDate} <= ${periodEndDate}`,
              eq(schema.vouchers.companyId, companyId),
              eq(schema.vouchers.optional, false)
            )
          );

        // Sum up debits and credits
        for (const entry of entries) {
          const debit = parseFloat(entry.voucher_entries.debitAmount || "0");
          const credit = parseFloat(entry.voucher_entries.creditAmount || "0");
          balance += debit - credit;
        }

        // For Income accounts, credit balance is positive (we track as negative for closing)
        // For Expense accounts, debit balance is positive
        if (account.accountType === "Income") {
          totalIncome += -balance; // Income accounts have credit balances (negative)
          accountBalances.push({
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            accountType: account.accountType,
            balance: -balance, // Store as positive for income
          });
        } else {
          totalExpense += balance; // Expense accounts have debit balances (positive)
          accountBalances.push({
            accountId: account.id,
            accountCode: account.code,
            accountName: account.name,
            accountType: account.accountType,
            balance: balance,
          });
        }
      }

      const netIncome = totalIncome - totalExpense;

      // Create the closing voucher
      const voucherNumber = `FISCAL-CLOSE-${periodEndDate}-${Date.now()}`;
      const [closingVoucher] = await tx.insert(schema.vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: periodEndDate,
        description: `Fiscal Period Close: ${periodStartDate} to ${periodEndDate}${notes ? ` - ${notes}` : ''}`,
        totalAmount: Math.abs(netIncome).toFixed(2),
        optional: false,
      }).returning();

      // Create voucher entries to zero out each Income and Expense account
      for (const account of accountBalances) {
        if (account.balance === 0) continue;

        if (account.accountType === "Income") {
          // Debit Income accounts to zero them out
          await tx.insert(schema.voucherEntries).values({
            voucherId: closingVoucher.id,
            ledgerAccountId: account.accountId,
            debitAmount: account.balance.toFixed(2),
            creditAmount: "0",
            narration: `Close ${account.accountName} for period ending ${periodEndDate}`,
          });
        } else {
          // Credit Expense accounts to zero them out
          await tx.insert(schema.voucherEntries).values({
            voucherId: closingVoucher.id,
            ledgerAccountId: account.accountId,
            debitAmount: "0",
            creditAmount: account.balance.toFixed(2),
            narration: `Close ${account.accountName} for period ending ${periodEndDate}`,
          });
        }
      }

      // Create entry to Retained Earnings for net income
      if (netIncome !== 0) {
        if (netIncome > 0) {
          // Profit: Credit Retained Earnings
          await tx.insert(schema.voucherEntries).values({
            voucherId: closingVoucher.id,
            ledgerAccountId: retainedEarningsAccountId,
            debitAmount: "0",
            creditAmount: netIncome.toFixed(2),
            narration: `Net Income for period ending ${periodEndDate}`,
          });
        } else {
          // Loss: Debit Retained Earnings
          await tx.insert(schema.voucherEntries).values({
            voucherId: closingVoucher.id,
            ledgerAccountId: retainedEarningsAccountId,
            debitAmount: Math.abs(netIncome).toFixed(2),
            creditAmount: "0",
            narration: `Net Loss for period ending ${periodEndDate}`,
          });
        }
      }

      // Record the closure
      const [closure] = await tx.insert(schema.fiscalPeriodClosures).values({
        companyId,
        periodStartDate,
        periodEndDate,
        closedByUserId,
        closingVoucherId: closingVoucher.id,
        retainedEarningsAccountId,
        totalIncome: totalIncome.toFixed(2),
        totalExpense: totalExpense.toFixed(2),
        netIncome: netIncome.toFixed(2),
        status: "CLOSED",
        notes: notes || null,
      }).returning();

      // Reset opening balances for Income/Expense accounts to 0 for next period
      for (const account of accountBalances) {
        await tx
          .update(schema.ledgerAccounts)
          .set({
            openingBalance: "0",
            openingBalanceSide: "Dr",
          })
          .where(eq(schema.ledgerAccounts.id, account.accountId));
      }

      return closure;
    });
  }

  async getFiscalPeriodClosures(companyId: number): Promise<schema.FiscalPeriodClosure[]> {
    return await db
      .select()
      .from(schema.fiscalPeriodClosures)
      .where(eq(schema.fiscalPeriodClosures.companyId, companyId))
      .orderBy(sql`${schema.fiscalPeriodClosures.periodEndDate} DESC`);
  }

  // Stock Transfers
  async createStockTransfer(
    voucherId: number,
    destinationLocationId: number,
    notes: string,
    items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    return await db.transaction(async (tx) => {
      // Check if voucher is optional - if so, skip inventory updates
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.id, voucherId));
      
      if (!voucher) {
        throw new Error(`Voucher ${voucherId} not found`);
      }
      
      const isOptional = voucher.optional;

      // Create the stock transfer voucher record (note: no global sourceLocationId)
      const [transfer] = await tx.insert(schema.stockTransferVouchers).values({
        voucherId,
        sourceLocationId: items[0].sourceLocationId, // Store first item's source for legacy compatibility
        destinationLocationId,
        notes,
      }).returning();

      // Process each item
      const transferItems: StockTransferItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const totalAmount = quantity * rate;

        // Insert transfer item with source location
        const [transferItem] = await tx.insert(schema.stockTransferItems).values({
          transferId: transfer.id,
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        transferItems.push(transferItem);

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at THIS ITEM's source location
          const [sourceInventory] = await tx
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, item.sourceLocationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (sourceInventory) {
            // Decrease quantity at this item's source location
            const currentQty = parseFloat(sourceInventory.quantity);
            const currentValue = parseFloat(sourceInventory.totalValue);
            const currentRate = parseFloat(sourceInventory.averageRate);
            
            const newQty = currentQty - quantity;
            const newValue = newQty > 0 ? newQty * currentRate : 0;
            
            // Get location's companyId
            const [location] = await tx
              .select()
              .from(schema.locations)
              .where(eq(schema.locations.id, item.sourceLocationId));
            
            if (!location) {
              throw new Error(`Source location ${item.sourceLocationId} not found`);
            }

            // Update inventory directly in transaction
            await tx
              .update(schema.inventory)
              .set({
                quantity: newQty.toFixed(3),
                averageRate: currentRate.toFixed(2),
                totalValue: newValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, sourceInventory.id));
          }

          // Get current inventory at destination location
          const [destInventory] = await tx
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, destinationLocationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (destInventory) {
            // Increase quantity at destination location using weighted average
            const currentQty = parseFloat(destInventory.quantity);
            const currentValue = parseFloat(destInventory.totalValue);
            
            const newQty = currentQty + quantity;
            const newValue = currentValue + totalAmount;
            const newRate = newQty > 0 ? newValue / newQty : 0;
            
            await tx
              .update(schema.inventory)
              .set({
                quantity: newQty.toFixed(3),
                averageRate: newRate.toFixed(2),
                totalValue: newValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, destInventory.id));
          } else {
            // Create new inventory record at destination
            const [destLocation] = await tx
              .select()
              .from(schema.locations)
              .where(eq(schema.locations.id, destinationLocationId));
            
            if (!destLocation) {
              throw new Error(`Destination location ${destinationLocationId} not found`);
            }

            await tx.insert(schema.inventory).values({
              companyId: destLocation.companyId,
              locationId: destinationLocationId,
              stockItemId: item.stockItemId,
              quantity: item.quantity,
              averageRate: item.rate,
              totalValue: totalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
          }
        }
      }

      return {
        transfer,
        items: transferItems,
      };
    });
  }

  // Stock Adjustments
  async createStockAdjustment(
    voucherId: number,
    locationId: number,
    adjustmentType: "Production" | "Consumption",
    notes: string,
    items: Array<{stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    return await db.transaction(async (tx) => {
      // Check if voucher is optional - if so, skip inventory updates
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.id, voucherId));
      
      if (!voucher) {
        throw new Error(`Voucher ${voucherId} not found`);
      }
      
      const isOptional = voucher.optional;

      // Create the stock adjustment voucher record
      const [adjustment] = await tx.insert(schema.stockAdjustmentVouchers).values({
        voucherId,
        locationId,
        adjustmentType,
        notes,
      }).returning();

      // Get location's companyId
      const [location] = await tx
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, locationId));
      
      if (!location) {
        throw new Error(`Location ${locationId} not found`);
      }

      // Process each item
      const adjustmentItems: StockAdjustmentItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const totalAmount = Math.abs(quantity) * rate;

        // Insert adjustment item
        const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
          adjustmentId: adjustment.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        adjustmentItems.push(adjustmentItem);

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at location
          const [currentInventory] = await tx
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, locationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (currentInventory) {
            // Adjust quantity at location
            const currentQty = parseFloat(currentInventory.quantity);
            const currentValue = parseFloat(currentInventory.totalValue);
            const currentRate = parseFloat(currentInventory.averageRate);
            
            let newQty: number;
            let newValue: number;
            let newRate: number;

            if (adjustmentType === "Production") {
              // Positive adjustment - add to inventory
              newQty = currentQty + quantity;
              newValue = currentValue + totalAmount;
              newRate = newQty > 0 ? newValue / newQty : 0;
            } else {
              // Consumption - subtract from inventory (use absolute value to ensure reduction)
              newQty = currentQty - Math.abs(quantity);
              newValue = newQty > 0 ? newQty * currentRate : 0;
              newRate = currentRate;
            }
            
            await tx
              .update(schema.inventory)
              .set({
                quantity: newQty.toFixed(3),
                averageRate: newRate.toFixed(2),
                totalValue: newValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, currentInventory.id));
          } else if (adjustmentType === "Production") {
            // Create new inventory record for production
            await tx.insert(schema.inventory).values({
              companyId: location.companyId,
              locationId,
              stockItemId: item.stockItemId,
              quantity: item.quantity,
              averageRate: item.rate,
              totalValue: totalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
          }
        }
      }

      return {
        adjustment,
        items: adjustmentItems,
      };
    });
  }

  async getStockTransferByVoucherId(voucherId: number): Promise<any | null> {
    const [transfer] = await db
      .select()
      .from(schema.stockTransferVouchers)
      .where(eq(schema.stockTransferVouchers.voucherId, voucherId));

    if (!transfer) {
      return null;
    }

    const items = await db
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, transfer.id));

    return {
      ...transfer,
      items,
    };
  }

  async getStockAdjustmentByVoucherId(voucherId: number): Promise<any | null> {
    const [adjustment] = await db
      .select()
      .from(schema.stockAdjustmentVouchers)
      .where(eq(schema.stockAdjustmentVouchers.voucherId, voucherId));

    if (!adjustment) {
      return null;
    }

    const items = await db
      .select()
      .from(schema.stockAdjustmentItems)
      .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustment.id));

    return {
      ...adjustment,
      items,
    };
  }

  async updateStockTransfer(
    id: number,
    destinationLocationId: number,
    notes: string,
    items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    console.log('[storage.updateStockTransfer] Starting update for transfer ID:', id);
    
    return await db.transaction(async (tx) => {
      // Step 1: Get the existing stock transfer with its items
      const [existingTransfer] = await tx
        .select()
        .from(schema.stockTransferVouchers)
        .where(eq(schema.stockTransferVouchers.id, id));

      if (!existingTransfer) {
        throw new Error(`Stock transfer ${id} not found`);
      }

      // Check if voucher is optional - if so, skip inventory updates
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.id, existingTransfer.voucherId));
      
      if (!voucher) {
        throw new Error(`Voucher ${existingTransfer.voucherId} not found`);
      }
      
      const isOptional = voucher.optional;

      const existingItems = await tx
        .select()
        .from(schema.stockTransferItems)
        .where(eq(schema.stockTransferItems.transferId, id));

      console.log('[storage.updateStockTransfer] Found existing transfer with', existingItems.length, 'items');

      // CRITICAL: Validate that all items have sourceLocationId before allowing edit
      // Legacy transfers (created before the column was added) cannot be safely edited
      const itemsWithoutSource = existingItems.filter(item => !item.sourceLocationId);
      if (itemsWithoutSource.length > 0) {
        throw new Error(
          `Cannot edit this stock transfer: ${itemsWithoutSource.length} items missing source location data. ` +
          `This transfer was created before per-item source locations were tracked. ` +
          `Please create a new transfer instead to avoid inventory corruption.`
        );
      }

      // Step 2: REVERSE inventory changes for each OLD item (only if not optional)
      if (!isOptional) {
        for (const oldItem of existingItems) {
        const quantity = parseFloat(oldItem.quantity);
        const rate = parseFloat(oldItem.rate);
        const totalAmount = quantity * rate;

        console.log('[storage.updateStockTransfer] Reversing item:', oldItem.stockItemId, 'qty:', quantity);

        // REVERSE: Add back to source location (we previously subtracted)
        // Use the item's sourceLocationId if available, otherwise fall back to transfer's sourceLocationId
        const sourceLocationId = oldItem.sourceLocationId || existingTransfer.sourceLocationId;

        const [sourceInventory] = await tx
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, sourceLocationId),
            eq(schema.inventory.stockItemId, oldItem.stockItemId)
          ));

        if (sourceInventory) {
          // Add back to source (reverse the subtraction)
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentValue = parseFloat(sourceInventory.totalValue);
          
          const newQty = currentQty + quantity;
          const newValue = currentValue + totalAmount;
          const newRate = newQty > 0 ? newValue / newQty : 0;

          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          // Create new inventory record at source (it may have been deleted if quantity reached 0)
          const [sourceLocation] = await tx
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, sourceLocationId));
          
          if (sourceLocation) {
            await tx.insert(schema.inventory).values({
              companyId: sourceLocation.companyId,
              locationId: sourceLocationId,
              stockItemId: oldItem.stockItemId,
              quantity: quantity.toFixed(3),
              averageRate: rate.toFixed(2),
              totalValue: totalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
          }
        }

        // REVERSE: Subtract from destination location (we previously added)
        const [destInventory] = await tx
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, existingTransfer.destinationLocationId),
            eq(schema.inventory.stockItemId, oldItem.stockItemId)
          ));

        if (destInventory) {
          // Subtract from destination (reverse the addition)
          const currentQty = parseFloat(destInventory.quantity);
          const currentValue = parseFloat(destInventory.totalValue);
          const currentRate = parseFloat(destInventory.averageRate);
          
          const newQty = currentQty - quantity;
          const newValue = newQty > 0 ? newQty * currentRate : 0;

          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: currentRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, destInventory.id));
        }
        }
      }

      // Step 3: Delete all existing stock transfer items
      await tx
        .delete(schema.stockTransferItems)
        .where(eq(schema.stockTransferItems.transferId, id));

      console.log('[storage.updateStockTransfer] Deleted old items');

      // Step 4: Update the stock transfer record
      const [updatedTransfer] = await tx
        .update(schema.stockTransferVouchers)
        .set({
          sourceLocationId: items[0].sourceLocationId, // Store first item's source for legacy compatibility
          destinationLocationId,
          notes,
        })
        .where(eq(schema.stockTransferVouchers.id, id))
        .returning();

      console.log('[storage.updateStockTransfer] Updated transfer record');

      // Step 5: Create NEW items and apply inventory changes (only if not optional)
      const transferItems: StockTransferItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const totalAmount = quantity * rate;

        console.log('[storage.updateStockTransfer] Creating new item:', item.stockItemId, 'qty:', quantity);

        // Insert transfer item with source location
        const [transferItem] = await tx.insert(schema.stockTransferItems).values({
          transferId: updatedTransfer.id,
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        transferItems.push(transferItem);

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at THIS ITEM's source location
          const [sourceInventory] = await tx
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, item.sourceLocationId),
            eq(schema.inventory.stockItemId, item.stockItemId)
          ));

        if (sourceInventory) {
          // Decrease quantity at this item's source location
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentValue = parseFloat(sourceInventory.totalValue);
          const currentRate = parseFloat(sourceInventory.averageRate);
          
          const newQty = currentQty - quantity;
          const newValue = newQty > 0 ? newQty * currentRate : 0;
          
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: currentRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          throw new Error(`Insufficient inventory at source location ${item.sourceLocationId} for stock item ${item.stockItemId}`);
        }

        // Get current inventory at destination location
        const [destInventory] = await tx
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, destinationLocationId),
            eq(schema.inventory.stockItemId, item.stockItemId)
          ));

        if (destInventory) {
          // Increase quantity at destination location using weighted average
          const currentQty = parseFloat(destInventory.quantity);
          const currentValue = parseFloat(destInventory.totalValue);
          
          const newQty = currentQty + quantity;
          const newValue = currentValue + totalAmount;
          const newRate = newQty > 0 ? newValue / newQty : 0;
          
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, destInventory.id));
        } else {
          // Create new inventory record at destination
          const [destLocation] = await tx
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, destinationLocationId));
          
          if (!destLocation) {
            throw new Error(`Destination location ${destinationLocationId} not found`);
          }

          await tx.insert(schema.inventory).values({
            companyId: destLocation.companyId,
            locationId: destinationLocationId,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            averageRate: item.rate,
            totalValue: totalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
        }
        }
      }

      console.log('[storage.updateStockTransfer] Transfer updated successfully with', transferItems.length, 'new items');

      return {
        transfer: updatedTransfer,
        items: transferItems,
      };
    });
  }

  async updateStockAdjustment(
    id: number,
    locationId: number,
    adjustmentType: "Production" | "Consumption" | "Mixed",
    notes: string,
    items: Array<{stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    console.log('[storage.updateStockAdjustment] Starting update for adjustment ID:', id);
    
    return await db.transaction(async (tx) => {
      // Step 1: Get the existing stock adjustment with its items
      const [existingAdjustment] = await tx
        .select()
        .from(schema.stockAdjustmentVouchers)
        .where(eq(schema.stockAdjustmentVouchers.id, id));

      if (!existingAdjustment) {
        throw new Error(`Stock adjustment ${id} not found`);
      }

      // Check if voucher is optional - if so, skip inventory updates
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.id, existingAdjustment.voucherId));
      
      if (!voucher) {
        throw new Error(`Voucher ${existingAdjustment.voucherId} not found`);
      }
      
      const isOptional = voucher.optional;

      const existingItems = await tx
        .select()
        .from(schema.stockAdjustmentItems)
        .where(eq(schema.stockAdjustmentItems.adjustmentId, id));

      console.log('[storage.updateStockAdjustment] Found existing adjustment with', existingItems.length, 'items');

      // Get location's companyId
      const [location] = await tx
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, existingAdjustment.locationId));
      
      if (!location) {
        throw new Error(`Location ${existingAdjustment.locationId} not found`);
      }

      // Step 2: REVERSE inventory changes for each OLD item (only if not optional)
      if (!isOptional) {
        for (const oldItem of existingItems) {
        const quantity = parseFloat(oldItem.quantity);
        const rate = parseFloat(oldItem.rate);
        const totalAmount = Math.abs(quantity) * rate;
        const oldAdjustmentType = existingAdjustment.adjustmentType;

        console.log('[storage.updateStockAdjustment] Reversing item:', oldItem.stockItemId, 'qty:', quantity, 'type:', oldAdjustmentType);

        // Get current inventory at location
        const [currentInventory] = await tx
          .select()
          .from(schema.inventory)
          .where(and(
            eq(schema.inventory.locationId, existingAdjustment.locationId),
            eq(schema.inventory.stockItemId, oldItem.stockItemId)
          ));

        if (currentInventory) {
          const currentQty = parseFloat(currentInventory.quantity);
          const currentValue = parseFloat(currentInventory.totalValue);
          const currentRate = parseFloat(currentInventory.averageRate);
          
          let newQty: number;
          let newValue: number;
          let newRate: number;

          if (oldAdjustmentType === "Production") {
            // REVERSE Production: Subtract the quantity that was added
            newQty = currentQty - quantity;
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
          } else {
            // REVERSE Consumption: Add back the quantity that was subtracted
            newQty = currentQty + Math.abs(quantity);
            newValue = currentValue + totalAmount;
            newRate = newQty > 0 ? newValue / newQty : 0;
          }
          
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else if (oldAdjustmentType === "Consumption") {
          // If reversing consumption and no inventory exists, create it
          await tx.insert(schema.inventory).values({
            companyId: location.companyId,
            locationId: existingAdjustment.locationId,
            stockItemId: oldItem.stockItemId,
            quantity: Math.abs(quantity).toFixed(3),
            averageRate: rate.toFixed(2),
            totalValue: totalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
        }
        }
      }

      // Step 3: Delete all existing stock adjustment items
      await tx
        .delete(schema.stockAdjustmentItems)
        .where(eq(schema.stockAdjustmentItems.adjustmentId, id));

      console.log('[storage.updateStockAdjustment] Deleted old items');

      // Step 4: Update the stock adjustment record
      const [updatedAdjustment] = await tx
        .update(schema.stockAdjustmentVouchers)
        .set({
          locationId,
          adjustmentType,
          notes,
        })
        .where(eq(schema.stockAdjustmentVouchers.id, id))
        .returning();

      console.log('[storage.updateStockAdjustment] Updated adjustment record');

      // Get new location's companyId if location changed
      const [newLocation] = await tx
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, locationId));
      
      if (!newLocation) {
        throw new Error(`Location ${locationId} not found`);
      }

      // Step 5: Create NEW items and apply inventory changes (same logic as createStockAdjustment)
      const adjustmentItems: StockAdjustmentItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const totalAmount = Math.abs(quantity) * rate;

        console.log('[storage.updateStockAdjustment] Creating new item:', item.stockItemId, 'qty:', quantity);

        // Insert adjustment item
        const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
          adjustmentId: updatedAdjustment.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        adjustmentItems.push(adjustmentItem);

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at location
          const [currentInventory] = await tx
            .select()
            .from(schema.inventory)
            .where(and(
              eq(schema.inventory.locationId, locationId),
              eq(schema.inventory.stockItemId, item.stockItemId)
            ));

          if (currentInventory) {
          // Adjust quantity at location
          const currentQty = parseFloat(currentInventory.quantity);
          const currentValue = parseFloat(currentInventory.totalValue);
          const currentRate = parseFloat(currentInventory.averageRate);
          
          let newQty: number;
          let newValue: number;
          let newRate: number;

          if (adjustmentType === "Production") {
            // Positive adjustment - add to inventory
            newQty = currentQty + quantity;
            newValue = currentValue + totalAmount;
            newRate = newQty > 0 ? newValue / newQty : 0;
          } else {
            // Consumption - subtract from inventory (use absolute value to ensure reduction)
            newQty = currentQty - Math.abs(quantity);
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
          }
          
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else if (adjustmentType === "Production") {
          // Create new inventory record for production
          await tx.insert(schema.inventory).values({
            companyId: newLocation.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            averageRate: item.rate,
            totalValue: totalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
        } else {
          throw new Error(`Insufficient inventory at location ${locationId} for stock item ${item.stockItemId}`);
        }
        }
      }

      console.log('[storage.updateStockAdjustment] Adjustment updated successfully with', adjustmentItems.length, 'new items');

      return {
        adjustment: updatedAdjustment,
        items: adjustmentItems,
      };
    });
  }

  // Stock Query Methods
  async getLastPurchaseOrderForItem(stockItemId: number, companyId: number): Promise<any | null> {
    const result = await db
      .select({
        poNumber: schema.purchaseOrders.poNumber,
        poDate: schema.purchaseOrders.createdAt,
        supplierName: schema.suppliers.legalName,
        quantity: schema.poLineItems.quantity,
        rate: schema.poLineItems.rate,
        amount: schema.poLineItems.lineTotal,
      })
      .from(schema.poLineItems)
      .innerJoin(schema.purchaseOrders, eq(schema.poLineItems.poId, schema.purchaseOrders.id))
      .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
      .where(and(
        eq(schema.poLineItems.stockItemId, stockItemId),
        eq(schema.purchaseOrders.companyId, companyId)
      ))
      .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`)
      .limit(1);

    return result.length > 0 ? result[0] : null;
  }

  async getLastSaleForItem(stockItemId: number, companyId: number): Promise<any | null> {
    const result = await db
      .select({
        voucherNumber: schema.vouchers.voucherNumber,
        saleDate: schema.vouchers.voucherDate,
        locationName: schema.locations.name,
        quantity: schema.salesItems.quantity,
        sellingPrice: schema.salesItems.sellingPrice,
        totalSales: schema.salesItems.totalSales,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
      .where(and(
        eq(schema.salesItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId)
      ))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`)
      .limit(1);

    return result.length > 0 ? result[0] : null;
  }

  async getAllPurchasesForItem(stockItemId: number, companyId: number): Promise<any[]> {
    const results = await db
      .select({
        poNumber: schema.purchaseOrders.poNumber,
        poDate: schema.purchaseOrders.createdAt,
        supplierName: schema.suppliers.legalName,
        containerNumber: schema.containers.containerNumber,
        quantity: schema.poLineItems.quantity,
        rate: schema.poLineItems.rate,
        amount: schema.poLineItems.lineTotal,
      })
      .from(schema.poLineItems)
      .innerJoin(schema.purchaseOrders, eq(schema.poLineItems.poId, schema.purchaseOrders.id))
      .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
      .leftJoin(schema.containers, eq(schema.purchaseOrders.containerId, schema.containers.id))
      .where(and(
        eq(schema.poLineItems.stockItemId, stockItemId),
        eq(schema.purchaseOrders.companyId, companyId)
      ))
      .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`);

    return results;
  }

  async getAllSalesForItem(stockItemId: number, companyId: number): Promise<any[]> {
    const results = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        saleDate: schema.vouchers.voucherDate,
        locationName: schema.locations.name,
        quantity: schema.salesItems.quantity,
        sellingPrice: schema.salesItems.sellingPrice,
        totalSales: schema.salesItems.totalSales,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
      .where(and(
        eq(schema.salesItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.optional, false)
      ))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`);

    return results;
  }

  async getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]> {
    const results = await db
      .select({
        locationId: schema.inventory.locationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        quantity: schema.inventory.quantity,
        averageRate: schema.inventory.averageRate,
        totalValue: schema.inventory.totalValue,
      })
      .from(schema.inventory)
      .innerJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
      .where(and(
        eq(schema.inventory.stockItemId, stockItemId),
        eq(schema.locations.companyId, companyId),
        sql`${schema.inventory.quantity}::numeric > 0` // Only show locations with positive inventory
      ))
      .orderBy(schema.locations.name);

    return results;
  }

  async getVoucherHistoryForItem(stockItemId: number, companyId: number): Promise<any[]> {
    // Get all voucher transactions for this item from various sources
    // Sales (exclude optional/draft vouchers)
    const sales = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        locationId: schema.vouchers.locationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        quantityOut: schema.salesItems.quantity,
        quantityIn: sql<string>`'0'`,
        rate: schema.salesItems.sellingPrice,
        amount: schema.salesItems.totalSales,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
      .where(and(
        eq(schema.salesItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.optional, false)
      ));

    // Stock Transfers (as source location - outward, exclude optional/draft vouchers)
    const transfersOut = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        locationId: schema.stockTransferItems.sourceLocationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        quantityOut: schema.stockTransferItems.quantity,
        quantityIn: sql<string>`'0'`,
        rate: schema.stockTransferItems.rate,
        amount: sql<string>`(${schema.stockTransferItems.quantity}::numeric * ${schema.stockTransferItems.rate}::numeric)::text`,
      })
      .from(schema.stockTransferItems)
      .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.stockTransferVoucherId, schema.stockTransferVouchers.id))
      .innerJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.stockTransferItems.sourceLocationId, schema.locations.id))
      .where(and(
        eq(schema.stockTransferItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.optional, false)
      ));

    // Stock Transfers (as destination location - inward, exclude optional/draft vouchers)
    const transfersIn = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        locationId: schema.stockTransferVouchers.destinationLocationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        quantityOut: sql<string>`'0'`,
        quantityIn: schema.stockTransferItems.quantity,
        rate: schema.stockTransferItems.rate,
        amount: sql<string>`(${schema.stockTransferItems.quantity}::numeric * ${schema.stockTransferItems.rate}::numeric)::text`,
      })
      .from(schema.stockTransferItems)
      .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.stockTransferVoucherId, schema.stockTransferVouchers.id))
      .innerJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.stockTransferVouchers.destinationLocationId, schema.locations.id))
      .where(and(
        eq(schema.stockTransferItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.optional, false)
      ));

    // Stock Adjustments (Production/Consumption, exclude optional/draft vouchers)
    const adjustments = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        voucherType: schema.vouchers.voucherType,
        voucherDate: schema.vouchers.voucherDate,
        locationId: schema.stockAdjustmentVouchers.locationId,
        locationName: schema.locations.name,
        locationCode: schema.locations.code,
        quantityOut: sql<string>`CASE WHEN ${schema.stockAdjustmentItems.quantity}::numeric < 0 THEN ABS(${schema.stockAdjustmentItems.quantity}::numeric)::text ELSE '0' END`,
        quantityIn: sql<string>`CASE WHEN ${schema.stockAdjustmentItems.quantity}::numeric > 0 THEN ${schema.stockAdjustmentItems.quantity} ELSE '0' END`,
        rate: schema.stockAdjustmentItems.rate,
        amount: sql<string>`(${schema.stockAdjustmentItems.quantity}::numeric * ${schema.stockAdjustmentItems.rate}::numeric)::text`,
      })
      .from(schema.stockAdjustmentItems)
      .innerJoin(schema.stockAdjustmentVouchers, eq(schema.stockAdjustmentItems.stockAdjustmentVoucherId, schema.stockAdjustmentVouchers.id))
      .innerJoin(schema.vouchers, eq(schema.stockAdjustmentVouchers.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.stockAdjustmentVouchers.locationId, schema.locations.id))
      .where(and(
        eq(schema.stockAdjustmentItems.stockItemId, stockItemId),
        eq(schema.vouchers.companyId, companyId),
        eq(schema.vouchers.optional, false)
      ));

    // Combine all transactions and sort by date
    const allTransactions = [...sales, ...transfersOut, ...transfersIn, ...adjustments];
    allTransactions.sort((a, b) => new Date(b.voucherDate).getTime() - new Date(a.voucherDate).getTime());

    return allTransactions;
  }

  // Customer Methods
  async getAllCustomers(companyId: number): Promise<schema.Customer[]> {
    return await db.select().from(schema.customers)
      .where(eq(schema.customers.companyId, companyId))
      .orderBy(schema.customers.legalName);
  }

  async getCustomerById(id: number): Promise<schema.Customer | undefined> {
    const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
    return customer;
  }

  async getCustomerByCode(code: string, companyId: number): Promise<schema.Customer | undefined> {
    const [customer] = await db.select().from(schema.customers)
      .where(and(eq(schema.customers.code, code), eq(schema.customers.companyId, companyId)));
    return customer;
  }

  async createCustomer(customer: schema.InsertCustomer): Promise<schema.Customer> {
    const [newCustomer] = await db.insert(schema.customers).values(customer as any).returning();
    return newCustomer;
  }

  async updateCustomer(id: number, updates: Partial<schema.InsertCustomer>): Promise<schema.Customer> {
    const [customer] = await db.update(schema.customers).set(updates).where(eq(schema.customers.id, id)).returning();
    return customer;
  }

  // Container Sales Methods
  async getAllContainerSales(companyId: number): Promise<schema.ContainerSale[]> {
    return await db.select().from(schema.containerSales)
      .where(eq(schema.containerSales.companyId, companyId))
      .orderBy(sql`${schema.containerSales.saleDate} DESC`);
  }

  async getContainerSaleById(id: number): Promise<schema.ContainerSale | undefined> {
    const [sale] = await db.select().from(schema.containerSales).where(eq(schema.containerSales.id, id));
    return sale;
  }

  async getContainerSalesByCustomer(customerId: number): Promise<schema.ContainerSale[]> {
    return await db.select().from(schema.containerSales)
      .where(eq(schema.containerSales.customerId, customerId))
      .orderBy(sql`${schema.containerSales.saleDate} DESC`);
  }

  async getContainerSalesByContainer(containerId: number): Promise<schema.ContainerSale | undefined> {
    const [sale] = await db.select().from(schema.containerSales)
      .where(eq(schema.containerSales.containerId, containerId));
    return sale;
  }

  async createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale> {
    const [newSale] = await db.insert(schema.containerSales).values(sale).returning();
    return newSale;
  }

  // Inter-Company Transfer Methods
  async getAllInterCompanyTransfers(companyId?: number): Promise<schema.InterCompanyTransfer[]> {
    if (companyId) {
      return await db.select().from(schema.interCompanyTransfers)
        .where(or(
          eq(schema.interCompanyTransfers.fromCompanyId, companyId),
          eq(schema.interCompanyTransfers.toCompanyId, companyId)
        ))
        .orderBy(sql`${schema.interCompanyTransfers.transferDate} DESC`);
    }
    return await db.select().from(schema.interCompanyTransfers)
      .orderBy(sql`${schema.interCompanyTransfers.transferDate} DESC`);
  }

  async getInterCompanyTransferById(id: number): Promise<schema.InterCompanyTransfer | undefined> {
    const [transfer] = await db.select().from(schema.interCompanyTransfers)
      .where(eq(schema.interCompanyTransfers.id, id));
    return transfer;
  }

  async createInterCompanyTransfer(transfer: schema.InsertInterCompanyTransfer): Promise<schema.InterCompanyTransfer> {
    const [newTransfer] = await db.insert(schema.interCompanyTransfers).values(transfer).returning();
    return newTransfer;
  }

  // Salary Advance Methods
  async getAllSalaryAdvances(companyId: number): Promise<schema.SalaryAdvance[]> {
    return await db.select().from(schema.salaryAdvances)
      .where(eq(schema.salaryAdvances.companyId, companyId))
      .orderBy(sql`${schema.salaryAdvances.advanceDate} DESC`);
  }

  async getSalaryAdvanceById(id: number): Promise<schema.SalaryAdvance | undefined> {
    const [advance] = await db.select().from(schema.salaryAdvances)
      .where(eq(schema.salaryAdvances.id, id));
    return advance;
  }

  async getSalaryAdvancesByEmployee(employeeId: number): Promise<schema.SalaryAdvance[]> {
    return await db.select().from(schema.salaryAdvances)
      .where(eq(schema.salaryAdvances.employeeId, employeeId))
      .orderBy(sql`${schema.salaryAdvances.advanceDate} DESC`);
  }

  async getUnpaidSalaryAdvancesByEmployee(employeeId: number): Promise<schema.SalaryAdvance[]> {
    return await db.select().from(schema.salaryAdvances)
      .where(and(
        eq(schema.salaryAdvances.employeeId, employeeId),
        eq(schema.salaryAdvances.fullyPaid, false)
      ))
      .orderBy(sql`${schema.salaryAdvances.advanceDate}`);
  }

  async createSalaryAdvance(advance: schema.InsertSalaryAdvance): Promise<schema.SalaryAdvance> {
    const [newAdvance] = await db.insert(schema.salaryAdvances).values(advance).returning();
    return newAdvance;
  }

  async updateSalaryAdvance(id: number, updates: Partial<schema.InsertSalaryAdvance>): Promise<schema.SalaryAdvance> {
    const [advance] = await db.update(schema.salaryAdvances).set(updates)
      .where(eq(schema.salaryAdvances.id, id)).returning();
    return advance;
  }

  // Salary Advance Deduction Methods
  async getSalaryAdvanceDeductions(salaryAdvanceId: number): Promise<schema.SalaryAdvanceDeduction[]> {
    return await db.select().from(schema.salaryAdvanceDeductions)
      .where(eq(schema.salaryAdvanceDeductions.salaryAdvanceId, salaryAdvanceId))
      .orderBy(schema.salaryAdvanceDeductions.payrollMonth);
  }

  async createSalaryAdvanceDeduction(deduction: schema.InsertSalaryAdvanceDeduction): Promise<schema.SalaryAdvanceDeduction> {
    const [newDeduction] = await db.insert(schema.salaryAdvanceDeductions).values(deduction).returning();
    return newDeduction;
  }

  // Draft POS Sales Methods
  async getAllDraftPosSales(userId: string, locationId?: number): Promise<schema.DraftPosSale[]> {
    if (locationId) {
      return await db.select().from(schema.draftPosSales)
        .where(and(
          eq(schema.draftPosSales.userId, userId),
          eq(schema.draftPosSales.locationId, locationId)
        ))
        .orderBy(sql`${schema.draftPosSales.updatedAt} DESC`);
    }
    return await db.select().from(schema.draftPosSales)
      .where(eq(schema.draftPosSales.userId, userId))
      .orderBy(sql`${schema.draftPosSales.updatedAt} DESC`);
  }

  async getDraftPosSaleById(id: number): Promise<any | undefined> {
    const [draft] = await db.select().from(schema.draftPosSales)
      .where(eq(schema.draftPosSales.id, id));
    
    if (!draft) return undefined;

    const items = await db.select({
      id: schema.draftPosSaleItems.id,
      stockItemId: schema.draftPosSaleItems.stockItemId,
      stockItemName: schema.stockItems.name,
      stockItemCode: schema.stockItems.code,
      quantity: schema.draftPosSaleItems.quantity,
      rate: schema.draftPosSaleItems.rate,
      amount: schema.draftPosSaleItems.amount,
    })
      .from(schema.draftPosSaleItems)
      .leftJoin(schema.stockItems, eq(schema.draftPosSaleItems.stockItemId, schema.stockItems.id))
      .where(eq(schema.draftPosSaleItems.draftId, id));

    return { ...draft, items };
  }

  async createDraftPosSale(
    draft: schema.InsertDraftPosSale, 
    items: Array<{stockItemId: number, quantity: string, rate: string, amount: string}>
  ): Promise<schema.DraftPosSale> {
    const [newDraft] = await db.insert(schema.draftPosSales).values(draft).returning();
    
    if (items && items.length > 0) {
      const draftItems = items.map(item => ({
        draftId: newDraft.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      }));
      await db.insert(schema.draftPosSaleItems).values(draftItems);
    }
    
    return newDraft;
  }

  async updateDraftPosSale(
    id: number, 
    draft: Partial<schema.InsertDraftPosSale>, 
    items?: Array<{stockItemId: number, quantity: string, rate: string, amount: string}>
  ): Promise<schema.DraftPosSale> {
    const updateData = { ...draft, updatedAt: sql`now()` };
    const [updatedDraft] = await db.update(schema.draftPosSales)
      .set(updateData)
      .where(eq(schema.draftPosSales.id, id))
      .returning();
    
    if (items) {
      // Delete existing items and insert new ones
      await db.delete(schema.draftPosSaleItems)
        .where(eq(schema.draftPosSaleItems.draftId, id));
      
      if (items.length > 0) {
        const draftItems = items.map(item => ({
          draftId: id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        }));
        await db.insert(schema.draftPosSaleItems).values(draftItems);
      }
    }
    
    return updatedDraft;
  }

  async deleteDraftPosSale(id: number): Promise<void> {
    await db.delete(schema.draftPosSaleItems)
      .where(eq(schema.draftPosSaleItems.draftId, id));
    await db.delete(schema.draftPosSales)
      .where(eq(schema.draftPosSales.id, id));
  }

  // Company Settings
  async getCompanySettings(companyId: number): Promise<schema.CompanySettings | undefined> {
    const [settings] = await db
      .select()
      .from(schema.companySettings)
      .where(eq(schema.companySettings.companyId, companyId));
    return settings;
  }

  async upsertCompanySettings(settings: schema.InsertCompanySettings): Promise<schema.CompanySettings> {
    const existing = await this.getCompanySettings(settings.companyId);
    
    if (existing) {
      const [updated] = await db
        .update(schema.companySettings)
        .set({ ...settings, updatedAt: sql`now()` })
        .where(eq(schema.companySettings.companyId, settings.companyId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(schema.companySettings)
        .values(settings)
        .returning();
      return created;
    }
  }

  // Bales
  async getAllBales(companyId: number): Promise<schema.Bale[]> {
    return await db
      .select()
      .from(schema.bales)
      .where(and(
        eq(schema.bales.companyId, companyId),
        eq(schema.bales.active, true)
      ))
      .orderBy(desc(schema.bales.createdAt));
  }

  async getBaleById(id: number): Promise<schema.Bale | undefined> {
    const [bale] = await db
      .select()
      .from(schema.bales)
      .where(eq(schema.bales.id, id));
    return bale;
  }

  async getBaleByBarcode(barcode: string, companyId: number): Promise<schema.Bale | undefined> {
    const [bale] = await db
      .select()
      .from(schema.bales)
      .where(and(
        eq(schema.bales.barcode, barcode),
        eq(schema.bales.companyId, companyId)
      ));
    return bale;
  }

  async createBale(bale: schema.InsertBale): Promise<schema.Bale> {
    const [created] = await db
      .insert(schema.bales)
      .values(bale)
      .returning();
    return created;
  }

  async updateBale(id: number, updates: Partial<schema.InsertBale>): Promise<schema.Bale> {
    const [updated] = await db
      .update(schema.bales)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(schema.bales.id, id))
      .returning();
    return updated;
  }

  async deleteBale(id: number): Promise<void> {
    await db
      .update(schema.bales)
      .set({ active: false })
      .where(eq(schema.bales.id, id));
  }

  async bulkCreateBales(bales: schema.InsertBale[]): Promise<schema.Bale[]> {
    if (bales.length === 0) return [];
    return await db
      .insert(schema.bales)
      .values(bales)
      .returning();
  }

  // Mix Batches
  async getAllMixBatches(companyId: number): Promise<schema.MixBatch[]> {
    return await db
      .select()
      .from(schema.mixBatches)
      .where(eq(schema.mixBatches.companyId, companyId))
      .orderBy(desc(schema.mixBatches.createdAt));
  }

  async getMixBatchById(id: number, companyId: number): Promise<schema.MixBatch | undefined> {
    const [batch] = await db
      .select()
      .from(schema.mixBatches)
      .where(and(
        eq(schema.mixBatches.id, id),
        eq(schema.mixBatches.companyId, companyId)
      ));
    return batch;
  }

  async createMixBatch(batch: schema.InsertMixBatch): Promise<schema.MixBatch> {
    const [created] = await db
      .insert(schema.mixBatches)
      .values(batch)
      .returning();
    return created;
  }

  async updateMixBatch(id: number, updates: Partial<schema.InsertMixBatch>): Promise<schema.MixBatch> {
    const [updated] = await db
      .update(schema.mixBatches)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(schema.mixBatches.id, id))
      .returning();
    return updated;
  }

  // Mix Batch Sources
  async getMixBatchSources(mixBatchId: number, companyId: number): Promise<schema.MixBatchSource[]> {
    // First verify the mix batch belongs to this company
    const batch = await this.getMixBatchById(mixBatchId, companyId);
    if (!batch) {
      return [];
    }
    
    return await db
      .select()
      .from(schema.mixBatchSources)
      .where(eq(schema.mixBatchSources.mixBatchId, mixBatchId));
  }

  async addMixBatchSource(source: schema.InsertMixBatchSource): Promise<schema.MixBatchSource> {
    const [created] = await db
      .insert(schema.mixBatchSources)
      .values(source)
      .returning();
    return created;
  }

  // Production Bales
  async getAllProductionBales(companyId: number, filters?: {
    mixBatchId?: number;
    status?: string;
    category?: string;
    grade?: string;
  }): Promise<schema.ProductionBale[]> {
    let conditions = [eq(schema.productionBales.companyId, companyId)];
    
    if (filters?.mixBatchId) {
      conditions.push(eq(schema.productionBales.mixBatchId, filters.mixBatchId));
    }
    if (filters?.status) {
      conditions.push(eq(schema.productionBales.status, filters.status));
    }
    if (filters?.category) {
      conditions.push(eq(schema.productionBales.category, filters.category));
    }
    if (filters?.grade) {
      conditions.push(eq(schema.productionBales.grade, filters.grade));
    }

    return await db
      .select()
      .from(schema.productionBales)
      .where(and(...conditions))
      .orderBy(desc(schema.productionBales.createdAt));
  }

  async getProductionBaleById(id: number): Promise<schema.ProductionBale | undefined> {
    const [bale] = await db
      .select()
      .from(schema.productionBales)
      .where(eq(schema.productionBales.id, id));
    return bale;
  }

  async getProductionBaleByBarcode(barcodeValue: string, companyId: number): Promise<schema.ProductionBale | undefined> {
    const [bale] = await db
      .select()
      .from(schema.productionBales)
      .where(and(
        eq(schema.productionBales.barcodeValue, barcodeValue),
        eq(schema.productionBales.companyId, companyId)
      ));
    return bale;
  }

  async createProductionBale(bale: schema.InsertProductionBale): Promise<schema.ProductionBale> {
    // Convert pressedAt string to Date if provided
    const baleData: any = { ...bale };
    if (bale.pressedAt) {
      baleData.pressedAt = new Date(bale.pressedAt);
    }
    
    const [created] = await db
      .insert(schema.productionBales)
      .values(baleData)
      .returning();
    return created;
  }

  async updateProductionBale(id: number, updates: Partial<schema.InsertProductionBale>): Promise<schema.ProductionBale> {
    // Convert pressedAt string to Date if provided
    const updateData: any = { ...updates, updatedAt: sql`now()` };
    if (updates.pressedAt) {
      updateData.pressedAt = new Date(updates.pressedAt);
    }
    
    const [updated] = await db
      .update(schema.productionBales)
      .set(updateData)
      .where(eq(schema.productionBales.id, id))
      .returning();
    return updated;
  }

  async bulkCreateProductionBales(bales: schema.InsertProductionBale[]): Promise<schema.ProductionBale[]> {
    if (bales.length === 0) return [];
    
    // Convert pressedAt strings to Dates
    const balesData = bales.map(bale => {
      const data: any = { ...bale };
      if (bale.pressedAt) {
        data.pressedAt = new Date(bale.pressedAt);
      }
      return data;
    });
    
    return await db
      .insert(schema.productionBales)
      .values(balesData)
      .returning();
  }

  // Update bale from scan (for factory floor scanning)
  async updateProductionBaleFromScan(
    barcodeValue: string,
    companyId: number,
    updates: {
      weightKg: string;
      category: string;
      grade: string;
      warehouseLocation?: string;
    }
  ): Promise<schema.ProductionBale> {
    const bale = await this.getProductionBaleByBarcode(barcodeValue, companyId);
    if (!bale) {
      throw new Error(`Bale with barcode ${barcodeValue} not found`);
    }

    // Get mix batch to calculate cost
    let costPerKg = "0";
    let totalCost = "0";

    if (bale.mixBatchId) {
      const batch = await this.getMixBatchById(bale.mixBatchId, companyId);
      if (batch) {
        costPerKg = batch.costPerKg;
        const weight = parseFloat(updates.weightKg);
        const cost = parseFloat(costPerKg);
        totalCost = (weight * cost).toFixed(2);
      }
    }

    const [updated] = await db
      .update(schema.productionBales)
      .set({
        weightKg: updates.weightKg,
        category: updates.category,
        grade: updates.grade,
        warehouseLocation: updates.warehouseLocation,
        costPerKg,
        totalCost,
        status: "PRESSED",
        pressedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.productionBales.id, bale.id))
      .returning();

    return updated;
  }
}

export const storage = new DbStorage();
