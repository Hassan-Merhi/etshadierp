import { eq, and, or, sql, inArray, desc } from "drizzle-orm";
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
  getLedgerAccountByCode(code: string): Promise<LedgerAccount | undefined>;
  getLedgerAccountByName(name: string, companyId: number): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;
  updateLedgerAccount(account: schema.UpdateLedgerAccount): Promise<LedgerAccount>;
  deleteLedgerAccount(id: number): Promise<void>;

  // Employees
  getAllEmployees(companyId: number): Promise<Employee[]>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;

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
  
  // Stock Item Code Aliases
  getStockItemCodeAliases(stockItemId: number): Promise<schema.StockItemCodeAlias[]>;
  getStockItemCodeAliasById(id: number): Promise<schema.StockItemCodeAlias | undefined>;
  createStockItemCodeAlias(alias: schema.InsertStockItemCodeAlias): Promise<schema.StockItemCodeAlias>;
  deleteStockItemCodeAlias(id: number): Promise<void>;

  // Bank Accounts
  getAllBankAccounts(companyId: number): Promise<BankAccount[]>;
  getBankAccountByCode(code: string): Promise<BankAccount | undefined>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;

  // Fixed Assets
  getAllFixedAssets(companyId: number): Promise<FixedAsset[]>;
  getFixedAssetByCode(code: string): Promise<FixedAsset | undefined>;
  createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset>;

  // Containers
  getAllContainers(companyId: number): Promise<Container[]>;
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

  // Stock Transfers
  createStockTransfer(voucherId: number, destinationLocationId: number, notes: string, items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>): Promise<any>;

  // Stock Adjustments
  createStockAdjustment(voucherId: number, locationId: number, adjustmentType: "Production" | "Consumption" | "Mixed", notes: string, items: Array<{stockItemId: number, quantity: string, rate: string}>): Promise<any>;

  // Stock Query
  getLastPurchaseOrderForItem(stockItemId: number, companyId: number): Promise<any | null>;
  getLastSaleForItem(stockItemId: number, companyId: number): Promise<any | null>;
  getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]>;

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
    const [created] = await db.insert(schema.locations).values(location).returning();
    return created;
  }

  async deleteLocation(id: number): Promise<void> {
    await db.delete(schema.locations).where(eq(schema.locations.id, id));
  }

  // Ledger Accounts
  async getAllLedgerAccounts(companyId: number): Promise<LedgerAccount[]> {
    return await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.companyId, companyId));
  }

  async getLedgerAccountByCode(code: string): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.code, code));
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
    return await db.select().from(schema.employees).where(eq(schema.employees.companyId, companyId));
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.code, code));
    return employee;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [created] = await db.insert(schema.employees).values([employee as any]).returning();
    return created;
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
    const [created] = await db.insert(schema.suppliers).values(supplier).returning();
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

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [created] = await db.insert(schema.bankAccounts).values(account).returning();
    return created;
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

    // Calculate total bales (sum of all quantities)
    const totalBales = allLineItems.reduce((sum, item) => {
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

    // Create inventory records at destination location with new rates
    for (const [stockItemId, data] of Array.from(itemsMap.entries())) {
      const averageOriginalRate = data.weightedRateSum / data.totalQuantity;
      const newRate = averageOriginalRate + additionalCostPerBale;
      const totalValue = data.totalQuantity * newRate;

      await this.updateInventory(
        locationId,
        stockItemId,
        data.totalQuantity.toString(),
        newRate.toFixed(2),
        totalValue.toFixed(2)
      );
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
    
    // Find or create "IMPORT_CHARGES" ledger account for debiting inventory-related costs
    let importChargesAccount = await db
      .select()
      .from(schema.ledgerAccounts)
      .where(
        and(
          eq(schema.ledgerAccounts.companyId, location.companyId),
          eq(schema.ledgerAccounts.code, "IMPORT_CHARGES")
        )
      )
      .limit(1);

    if (!importChargesAccount.length) {
      const [newAccount] = await db.insert(schema.ledgerAccounts).values({
        companyId: location.companyId,
        code: "IMPORT_CHARGES",
        name: "Import Charges",
        accountType: "Expense",
        subType: "Direct Expense",
        openingBalance: "0",
        openingBalanceSide: "Debit",
      }).returning();
      importChargesAccount = [newAccount];
    }

    const importChargesLedgerId = importChargesAccount[0].id;
    
    // Duties voucher entry
    if (dutiesAccountId && parseFloat(duties) > 0) {
      const voucherNumber = `DUTY-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Duties for container ${container.containerNumber}`,
        totalAmount: duties,
      }).returning();

      // Debit: Import Charges (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: importChargesLedgerId,
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
      const voucherNumber = `OFFICE-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Office charges for container ${container.containerNumber}`,
        totalAmount: officeCharges,
      }).returning();

      // Debit: Office Charges Account (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: officeChargesAccountId,
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
      const voucherNumber = `TRANS-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await db.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Transport fees for container ${container.containerNumber}`,
        totalAmount: transportFees,
      }).returning();

      // Debit: Import Charges (Expense increases)
      await db.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: importChargesLedgerId,
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

        // Debit: Import Charges (Expense increases)
        await db.insert(schema.voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: importChargesLedgerId,
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

  async getVoucherEntriesByVoucher(voucherId: number): Promise<VoucherEntry[]> {
    return await db.select().from(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, voucherId));
  }

  async getStockItemTransactions(stockItemId: number, companyId: number, startDate?: string, endDate?: string): Promise<any[]> {
    const conditions: any[] = [eq(schema.vouchers.companyId, companyId)];
    
    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

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
    const allTransactions = [...transferItems, ...adjustmentItems].sort((a, b) => {
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

  // Stock Transfers
  async createStockTransfer(
    voucherId: number,
    destinationLocationId: number,
    notes: string,
    items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    return await db.transaction(async (tx) => {
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

        // Insert transfer item
        const [transferItem] = await tx.insert(schema.stockTransferItems).values({
          transferId: transfer.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        }).returning();

        transferItems.push(transferItem);

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
            // Consumption - subtract from inventory
            newQty = currentQty - quantity;
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

      return {
        adjustment,
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
    const [newCustomer] = await db.insert(schema.customers).values(customer).returning();
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
}

export const storage = new DbStorage();
