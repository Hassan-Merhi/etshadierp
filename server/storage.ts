import { eq, and, or, sql, inArray, desc, ne, isNull, isNotNull, asc, ilike } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import { adjustInventory } from "./inventoryHelper";
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
  deleteUser(id: string): Promise<void>;
  getUserCompanyRole(userId: string, companyId: number): Promise<schema.UserCompanyRole | undefined>;

  // Companies
  getAllCompanies(): Promise<Company[]>;
  getCompanyById(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;

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
  getAllLedgerAccounts(companyId: number, includeHidden?: boolean): Promise<LedgerAccount[]>;
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
  getEmployeeById(id: number): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: number, companyId: number, updates: Partial<InsertEmployee>): Promise<Employee | undefined>;
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
  getAllSuppliers(search?: string, limit?: number): Promise<Supplier[]>;
  getSupplierByCode(code: string): Promise<Supplier | undefined>;
  getSupplierById(id: number): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, updates: Partial<InsertSupplier>): Promise<Supplier>;
  deleteSupplier(id: number): Promise<void>;

  // Stock Groups
  getAllStockGroups(companyId: number): Promise<StockGroup[]>;
  getStockGroupByCode(code: string, companyId: number): Promise<StockGroup | undefined>;
  getStockGroupById(id: number, companyId: number): Promise<StockGroup | undefined>;
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
  getAllCompanyCodeAliases(companyId: number): Promise<schema.StockItemCodeAlias[]>;
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
  createPurchaseOrder(po: InsertPurchaseOrder, voucherDateOverride?: string): Promise<PurchaseOrder>;
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
  getStockItemByBarcode(barcode: string, companyId?: number): Promise<StockItem | undefined>;

  // Stock Item Location Prices
  getStockItemLocationPrices(stockItemId: number): Promise<(schema.StockItemLocationPrice & { locationName: string })[]>;
  getAllLocationPrices(companyId: number): Promise<{ stockItemId: number; locationId: number; locationName: string; sellingPrice: string }[]>;
  upsertLocationPrice(stockItemId: number, locationId: number, sellingPrice: string): Promise<void>;
  deleteLocationPrice(id: number): Promise<void>;

  // Inventory - Location-based stock tracking
  getLocationInventory(locationId: number): Promise<any[]>;
  getCompanyInventory(companyId: number): Promise<any[]>;
  updateInventory(locationId: number, stockItemId: number, quantity: string, averageRate: string, totalValue: string): Promise<void>;
  updateCostPricesByBarcode(locationId: number, companyId: number, updates: Array<{ barcode: string; costPrice: number }>): Promise<{ updated: number; errors: string[] }>;

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
    additionalCharges?: Array<{ description: string; amount: number; ledgerAccountId: number }>,
    offloadDate?: string,
    inventoryCostCorrections?: Array<{ stockItemId: number; correctRate: number }>
  ): Promise<ContainerOffload>;

  // Vouchers and Journal Entries
  getAllVouchers(companyId: number): Promise<Voucher[]>;
  getVoucherById(id: number): Promise<Voucher | undefined>;
  getVouchersByDateRange(companyId: number, startDate: string, endDate: string): Promise<any[]>;
  getVoucherEntriesByLedger(ledgerAccountId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByCustomer(customerId: number, startDate?: string, endDate?: string): Promise<any[]>;
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

  // Exchange Rates
  getExchangeRates(companyId: number): Promise<schema.ExchangeRate[]>;
  getLatestExchangeRate(companyId: number, fromCurrency: string, toCurrency: string): Promise<schema.ExchangeRate | undefined>;
  getExchangeRateForDate(companyId: number, fromCurrency: string, toCurrency: string, date: string): Promise<schema.ExchangeRate | undefined>;
  createExchangeRate(rate: schema.InsertExchangeRate): Promise<schema.ExchangeRate>;

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
  getLastSoldPrices(companyId: number): Promise<Record<number, string>>;
  getAllPurchasesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]>;
  getAllSalesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]>;
  getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]>;
  getVoucherHistoryForItem(stockItemId: number, companyId: number): Promise<any[]>;

  // Customers
  getAllCustomers(companyId: number, search?: string, limit?: number): Promise<schema.Customer[]>;
  getCustomerById(id: number): Promise<schema.Customer | undefined>;
  getCustomerByCode(code: string, companyId: number): Promise<schema.Customer | undefined>;
  createCustomer(customer: schema.InsertCustomer): Promise<schema.Customer>;
  updateCustomer(id: number, updates: Partial<schema.InsertCustomer>): Promise<schema.Customer>;
  deleteCustomer(id: number): Promise<void>;

  // Container Sales
  createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale>;
  getContainerSales(companyId: number): Promise<schema.ContainerSale[]>;
  getContainerSaleById(id: number, companyId: number): Promise<schema.ContainerSale | undefined>;
  getContainerSaleByContainerId(containerId: number, companyId: number): Promise<schema.ContainerSale | undefined>;
  getContainerSalesByCustomer(customerId: number, companyId: number): Promise<schema.ContainerSale[]>;
  updateContainerSalePayment(id: number, companyId: number, paidAmount: string, paymentStatus: "PENDING" | "PARTIAL" | "PAID"): Promise<schema.ContainerSale>;
  
  // Customer Balances
  addCustomerBalanceEntry(entry: schema.InsertCustomerBalance): Promise<schema.CustomerBalance>;
  getCustomerBalance(customerId: number, companyId: number): Promise<number>;
  getCustomerStatement(customerId: number, companyId: number, startDate?: string, endDate?: string): Promise<schema.CustomerBalance[]>;

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
  deleteSalaryAdvance(id: number): Promise<void>;

  // Employee Bale Rates (per-location)
  getEmployeeBaleRates(employeeId: number, companyId: number): Promise<schema.EmployeeBaleRate[]>;
  setEmployeeBaleRates(employeeId: number, companyId: number, rates: { locationId: number; rate: string; sourceCompanyId?: number | null }[]): Promise<void>;

  // Employee Bale Pct Rates (per-location % bonus)
  getEmployeeBalePctRates(employeeId: number, companyId: number): Promise<schema.EmployeeBalePctRate[]>;
  setEmployeeBalePctRates(employeeId: number, companyId: number, rates: { locationId: number; pct: string; sourceCompanyId?: number | null }[]): Promise<void>;

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


  // Pending Barcodes
  getAllPendingBarcodes(companyId: number): Promise<schema.PendingBarcode[]>;
  getPendingBarcodeByCode(barcode: string, companyId: number): Promise<schema.PendingBarcode | undefined>;
  createPendingBarcode(data: schema.InsertPendingBarcode): Promise<schema.PendingBarcode>;
  updatePendingBarcode(id: number, updates: Partial<schema.InsertPendingBarcode>): Promise<schema.PendingBarcode>;
  deletePendingBarcode(id: number): Promise<void>;
  bulkCreatePendingBarcodes(barcodes: schema.InsertPendingBarcode[]): Promise<schema.PendingBarcode[]>;
  markBarcodesAsPrinted(ids: number[]): Promise<void>;
  // Bale Product Categories
  getAllBaleProductCategories(companyId: number): Promise<schema.BaleProductCategory[]>;
  getBaleProductCategoryById(id: number): Promise<schema.BaleProductCategory | undefined>;
  getBaleProductCategoryByName(name: string, companyId: number): Promise<schema.BaleProductCategory | undefined>;
  createBaleProductCategory(category: schema.InsertBaleProductCategory): Promise<schema.BaleProductCategory>;
  updateBaleProductCategory(id: number, updates: Partial<schema.InsertBaleProductCategory>): Promise<schema.BaleProductCategory>;
  deleteBaleProductCategory(id: number): Promise<void>;

  // Bale Products
  getAllBaleProducts(companyId: number): Promise<schema.BaleProduct[]>;
  getBaleProductById(id: number): Promise<schema.BaleProduct | undefined>;
  getBaleProductByCode(code: string, companyId: number): Promise<schema.BaleProduct | undefined>;
  createBaleProduct(product: schema.InsertBaleProduct): Promise<schema.BaleProduct>;
  updateBaleProduct(id: number, updates: Partial<schema.InsertBaleProduct>): Promise<schema.BaleProduct>;
  deleteBaleProduct(id: number): Promise<void>;
  bulkCreateBaleProducts(products: schema.InsertBaleProduct[]): Promise<schema.BaleProduct[]>;

  // Bale Label Prints
  createBaleLabelPrint(data: schema.InsertBaleLabelPrint): Promise<schema.BaleLabelPrint>;
  getBaleLabelPrintByReference(referenceNumber: string, companyId: number): Promise<schema.BaleLabelPrint | undefined>;
  getBaleLabelPrintsByArticle(articleCode: string, companyId: number): Promise<schema.BaleLabelPrint[]>;
  getBaleProductByArticleCode(articleCode: string, companyId: number): Promise<schema.BaleProduct | undefined>;

  // Bale Transfers
  getAllBaleTransfers(companyId: number): Promise<schema.BaleTransfer[]>;
  getBaleTransferById(id: number): Promise<schema.BaleTransfer | undefined>;
  createBaleTransfer(transfer: schema.InsertBaleTransfer): Promise<schema.BaleTransfer>;
  updateBaleTransfer(id: number, updates: Partial<schema.InsertBaleTransfer>): Promise<schema.BaleTransfer>;
  deleteBaleTransfer(id: number): Promise<void>;
  
  // Bale Transfer Items
  getBaleTransferItems(transferId: number): Promise<schema.BaleTransferItem[]>;
  createBaleTransferItem(item: schema.InsertBaleTransferItem): Promise<schema.BaleTransferItem>;
  updateBaleTransferItem(id: number, updates: Partial<schema.InsertBaleTransferItem>): Promise<schema.BaleTransferItem>;
  deleteBaleTransferItem(id: number): Promise<void>;
  getProductionBalesByLocation(companyId: number, locationId: number): Promise<schema.ProductionBale[]>;

  // Role Feature Permissions
  getRoleFeaturePermissions(companyId: number): Promise<schema.RoleFeaturePermission[]>;
  getRoleFeaturePermission(companyId: number, role: string, featureKey: string): Promise<schema.RoleFeaturePermission | undefined>;
  upsertRoleFeaturePermission(permission: schema.InsertRoleFeaturePermission): Promise<schema.RoleFeaturePermission>;
  bulkUpsertRoleFeaturePermissions(permissions: schema.InsertRoleFeaturePermission[]): Promise<schema.RoleFeaturePermission[]>;

  // ERP User Page Access
  getErpUserPageAccess(companyId: number, userId: string): Promise<string[]>;
  setErpUserPageAccess(companyId: number, userId: string, pageKeys: string[]): Promise<void>;

  // ERP User Hidden Cost Fields
  getErpUserHiddenCostFields(userId: string): Promise<string[]>;
  setErpUserHiddenCostFields(userId: string, fields: string[]): Promise<void>;

  // System Settings (global app-wide settings)
  getSystemSetting(key: string): Promise<schema.SystemSetting | undefined>;
  setSystemSetting(key: string, value: string | null): Promise<schema.SystemSetting>;
  getParentCompanyId(): Promise<number | null>;
  setParentCompanyId(companyId: number | null): Promise<void>;

  // POS Shifts
  getCurrentShift(userId: string, locationId: number): Promise<schema.PosShift | undefined>;
  getShiftById(id: number): Promise<schema.PosShift | undefined>;
  getShiftsByLocation(locationId: number, limit?: number): Promise<schema.PosShift[]>;
  openShift(shift: schema.InsertPosShift): Promise<schema.PosShift>;
  closeShift(id: number, closingCash: string, notes?: string): Promise<schema.PosShift>;
  updateShiftStats(id: number, salesCount: number, salesTotal: string): Promise<void>;

  // Spreadsheets
  listSpreadsheets(companyId: number): Promise<Pick<schema.Spreadsheet, "id" | "name" | "createdBy" | "updatedAt">[]>;
  getSpreadsheet(id: number, companyId: number): Promise<schema.Spreadsheet | undefined>;
  createSpreadsheet(companyId: number, name: string, data: any, createdBy?: string): Promise<schema.Spreadsheet>;
  updateSpreadsheet(id: number, companyId: number, fields: { name?: string; data?: any }): Promise<schema.Spreadsheet | undefined>;
  deleteSpreadsheet(id: number, companyId: number): Promise<void>;

  // Live Spreadsheets
  getLiveSpreadsheets(companyId: number, activeOnly?: boolean): Promise<schema.LiveSpreadsheet[]>;
  getLiveSpreadsheetById(id: number, companyId: number): Promise<schema.LiveSpreadsheet | undefined>;
  createLiveSpreadsheet(data: schema.InsertLiveSpreadsheet): Promise<schema.LiveSpreadsheet>;
  updateLiveSpreadsheet(id: number, companyId: number, fields: Partial<schema.InsertLiveSpreadsheet>): Promise<schema.LiveSpreadsheet | undefined>;
  deleteLiveSpreadsheet(id: number, companyId: number): Promise<void>;
}

export class DbStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(schema.users).where(sql`LOWER(${schema.users.username}) = LOWER(${username})`);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(schema.users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(schema.users).orderBy(asc(schema.users.username));
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(schema.users).set(updates).where(eq(schema.users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    // First delete all user company roles
    await db.delete(schema.userCompanyRoles).where(eq(schema.userCompanyRoles.userId, id));
    // Then delete the user
    await db.delete(schema.users).where(eq(schema.users.id, id));
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
    return await db.select().from(schema.companies).orderBy(asc(schema.companies.name));
  }

  async getCompanyById(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(schema.companies).values(company).returning();
    return created;
  }

  async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    const [updated] = await db
      .update(schema.companies)
      .set(updates)
      .where(eq(schema.companies.id, id))
      .returning();
    return updated;
  }

  async deleteCompany(id: number): Promise<void> {
    const safe = async (query: any) => {
      try { await db.execute(query); } catch (e: any) {
        if (e.code === '42P01' || e.message?.includes('does not exist')) return;
        throw e;
      }
    };

    // === CUSTOMER ORDER CHAIN ===
    await safe(sql`DELETE FROM customer_order_charges WHERE order_id IN (SELECT id FROM customer_orders WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM customer_order_bales WHERE order_id IN (SELECT id FROM customer_orders WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM customer_order_lines WHERE order_id IN (SELECT id FROM customer_orders WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM customer_orders WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM customer_proforma_lines WHERE proforma_id IN (SELECT id FROM customer_proformas WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM customer_proformas WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM customer_invoice_sequences WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM credit_note_items WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${id})`);

    // === VOUCHER CHAIN ===
    await db.execute(sql`DELETE FROM voucher_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${id})`);
    await db.execute(sql`DELETE FROM sales_items WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${id})`);
    await db.execute(sql`DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT stv.id FROM stock_transfer_vouchers stv JOIN vouchers v ON stv.voucher_id = v.id WHERE v.company_id = ${id})`);
    await db.execute(sql`DELETE FROM stock_transfer_vouchers WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${id})`);
    await db.execute(sql`DELETE FROM stock_adjustment_items WHERE adjustment_id IN (SELECT sav.id FROM stock_adjustment_vouchers sav JOIN vouchers v ON sav.voucher_id = v.id WHERE v.company_id = ${id})`);
    await db.execute(sql`DELETE FROM stock_adjustment_vouchers WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id = ${id})`);
    await db.delete(schema.vouchers).where(eq(schema.vouchers.companyId, id));

    // === FACTORY SNAPSHOT / LEAF TABLES ===
    await safe(sql`DELETE FROM factory_bale_cost_snapshots WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_bale_photos WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_container_profit_snapshots WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_supplier_score_snapshots WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_daily_kpi_snapshots WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_alerts WHERE company_id = ${id}`);

    // === FACTORY OPERATIONAL TABLES ===
    await safe(sql`DELETE FROM factory_waste_entries WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_daybook_entry_edits WHERE entry_id IN (SELECT id FROM factory_daybook_entries WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_daybook_entries WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_worker_documents WHERE worker_id IN (SELECT id FROM factory_workers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_payrolls WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_workers WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_bales WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_pressing_batches WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_mix_batch_sources WHERE mix_batch_id IN (SELECT id FROM factory_mix_batches WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_mix_batches WHERE company_id = ${id}`);

    // === FACTORY CONTAINER CHAIN ===
    await safe(sql`DELETE FROM factory_offload_additional_charges WHERE container_id IN (SELECT id FROM factory_containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_container_commissions WHERE container_id IN (SELECT id FROM factory_containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_duty_audit_log WHERE container_id IN (SELECT id FROM factory_containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_raw_stock WHERE container_id IN (SELECT id FROM factory_containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM factory_containers WHERE company_id = ${id}`);

    // === FACTORY BASE TABLES ===
    await safe(sql`DELETE FROM factory_bale_sequences WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_bale_products WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_categories WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_fx_rates WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_suppliers WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_settings WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_user_profiles WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM factory_user_page_access WHERE company_id = ${id}`);

    // === POS TABLES ===
    await db.execute(sql`DELETE FROM draft_pos_sale_items WHERE draft_id IN (SELECT dps.id FROM draft_pos_sales dps JOIN locations l ON dps.location_id = l.id WHERE l.company_id = ${id})`);
    await db.execute(sql`DELETE FROM draft_pos_sales WHERE location_id IN (SELECT id FROM locations WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM pos_offline_queue WHERE shift_id IN (SELECT id FROM pos_shifts WHERE location_id IN (SELECT id FROM locations WHERE company_id = ${id}))`);
    await safe(sql`DELETE FROM pos_shifts WHERE location_id IN (SELECT id FROM locations WHERE company_id = ${id})`);

    // === PURCHASE ORDER / CONTAINER CHAIN ===
    await db.execute(sql`DELETE FROM po_line_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id = ${id})`);
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, id));
    await safe(sql`DELETE FROM supplier_container_loaded_items WHERE container_id IN (SELECT id FROM containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM container_offload_items WHERE offload_id IN (SELECT co.id FROM container_offloads co WHERE co.container_id IN (SELECT id FROM containers WHERE company_id = ${id}))`);
    await db.execute(sql`DELETE FROM container_charges WHERE container_id IN (SELECT id FROM containers WHERE company_id = ${id})`);
    await db.execute(sql`DELETE FROM container_offloads WHERE container_id IN (SELECT id FROM containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM container_freight_payments WHERE freight_id IN (SELECT cf.id FROM container_freight cf WHERE cf.container_id IN (SELECT id FROM containers WHERE company_id = ${id}))`);
    await safe(sql`DELETE FROM container_freight WHERE container_id IN (SELECT id FROM containers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM container_documents WHERE container_id IN (SELECT id FROM containers WHERE company_id = ${id})`);
    await db.delete(schema.containers).where(eq(schema.containers.companyId, id));

    // === INVENTORY / STOCK ===
    await db.delete(schema.inventory).where(eq(schema.inventory.companyId, id));
    await db.delete(schema.stockItemCodeAliases).where(eq(schema.stockItemCodeAliases.companyId, id));
    await db.execute(sql`DELETE FROM stock_item_location_prices WHERE stock_item_id IN (SELECT id FROM stock_items WHERE company_id = ${id})`);
    await db.delete(schema.stockItems).where(eq(schema.stockItems.companyId, id));
    await db.delete(schema.stockGroups).where(eq(schema.stockGroups.companyId, id));
    await safe(sql`DELETE FROM stock_group_location_archive_items WHERE archive_id IN (SELECT id FROM stock_group_location_archives WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM stock_group_location_archives WHERE company_id = ${id}`);

    // === ERP BALE TABLES ===
    await safe(sql`DELETE FROM mix_batch_sources WHERE mix_batch_id IN (SELECT id FROM mix_batches WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM mix_batches WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM pressing_batches WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM production_raw_stock WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM production_bales WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bale_label_prints WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bale_transfer_items WHERE transfer_id IN (SELECT id FROM bale_transfers WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM bale_transfers WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bale_product_categories WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bale_products WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bale_sequences WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM bales WHERE company_id = ${id}`);

    // === SALARY / EMPLOYEES ===
    await safe(sql`DELETE FROM salary_advance_deductions WHERE advance_id IN (SELECT id FROM salary_advances WHERE company_id = ${id})`);
    await db.delete(schema.salaryAdvances).where(eq(schema.salaryAdvances.companyId, id));
    await db.execute(sql`DELETE FROM employee_group_members WHERE employee_group_id IN (SELECT id FROM employee_groups WHERE company_id = ${id})`);
    await db.delete(schema.employeeGroups).where(eq(schema.employeeGroups.companyId, id));
    await db.delete(schema.employees).where(eq(schema.employees.companyId, id));

    // === CUSTOMERS ===
    await db.delete(schema.customerBalances).where(eq(schema.customerBalances.companyId, id));
    await db.delete(schema.customers).where(eq(schema.customers.companyId, id));
    await db.delete(schema.containerSales).where(eq(schema.containerSales.companyId, id));

    // === SUPPLIER PROFORMAS ===
    await safe(sql`DELETE FROM supplier_proforma_lines WHERE proforma_id IN (SELECT id FROM supplier_proformas WHERE company_id = ${id})`);
    await safe(sql`DELETE FROM supplier_proformas WHERE company_id = ${id}`);

    // === INTER-COMPANY ===
    try {
      await db.delete(schema.interCompanyTransfers).where(or(eq(schema.interCompanyTransfers.fromCompanyId, id), eq(schema.interCompanyTransfers.toCompanyId, id)));
    } catch (e: any) {
      if (!e.message?.includes('does not exist')) throw e;
    }

    // === USER ROLES & LOCATIONS (before locations/ledger_accounts) ===
    await db.delete(schema.userCompanyRoles).where(eq(schema.userCompanyRoles.companyId, id));
    await safe(sql`DELETE FROM user_locations WHERE company_id = ${id}`);

    // === ACCOUNTS / LOCATIONS / SETTINGS ===
    await db.delete(schema.bankAccounts).where(eq(schema.bankAccounts.companyId, id));
    await db.delete(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, id));
    await db.delete(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.companyId, id));
    await db.delete(schema.locations).where(eq(schema.locations.companyId, id));
    await db.delete(schema.fiscalPeriodClosures).where(eq(schema.fiscalPeriodClosures.companyId, id));
    await db.delete(schema.dashboardCashAccounts).where(eq(schema.dashboardCashAccounts.companyId, id));
    await db.delete(schema.dashboardPayableAccounts).where(eq(schema.dashboardPayableAccounts.companyId, id));
    await safe(sql`DELETE FROM dashboard_account_selections WHERE company_id = ${id}`);
    await db.delete(schema.companySettings).where(eq(schema.companySettings.companyId, id));

    // === REMAINING COMPANY-SCOPED TABLES ===
    await safe(sql`DELETE FROM pending_barcodes WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM exchange_rates WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM reference_sequences WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM role_feature_permissions WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM login_history WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM stored_files WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM erp_user_page_access WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM audit_log WHERE company_id = ${id}`);
    await safe(sql`DELETE FROM user_presence WHERE company_id = ${id}`);

    // === FINALLY DELETE COMPANY ===
    await db.delete(schema.companies).where(eq(schema.companies.id, id));
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
    const locations = await db.select().from(schema.locations).where(
      and(
        eq(schema.locations.companyId, companyId),
        isNull(schema.locations.deletedAt)
      )
    ).orderBy(asc(schema.locations.name));
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
    // Soft delete - set deletedAt and active=false instead of hard delete
    await db.update(schema.locations)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(schema.locations.id, id));
  }

  // Ledger Accounts
  async getAllLedgerAccounts(companyId: number, includeHidden: boolean = false): Promise<LedgerAccount[]> {
    const conditions = [
      eq(schema.ledgerAccounts.companyId, companyId),
      isNull(schema.ledgerAccounts.deletedAt)
    ];
    if (!includeHidden) {
      conditions.push(eq(schema.ledgerAccounts.isHidden, false));
    }
    return await db.select().from(schema.ledgerAccounts).where(
      and(...conditions)
    ).orderBy(asc(schema.ledgerAccounts.code));
  }

  async getLedgerAccountByCode(code: string, companyId: number): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(
      and(
        eq(schema.ledgerAccounts.code, code),
        eq(schema.ledgerAccounts.companyId, companyId),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    );
    return account;
  }

  async getLedgerAccountByName(name: string, companyId: number): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(
      and(
        eq(schema.ledgerAccounts.name, name),
        eq(schema.ledgerAccounts.companyId, companyId),
        isNull(schema.ledgerAccounts.deletedAt)
      )
    );
    return account;
  }

  async createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
    const [created] = await db.insert(schema.ledgerAccounts).values({
      ...account,
      code: account.code || `LA-${Date.now()}`,
    }).returning();
    return created;
  }

  async deleteLedgerAccount(id: number): Promise<void> {
    // Soft delete - set deletedAt and active=false instead of hard delete
    await db.update(schema.ledgerAccounts)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(schema.ledgerAccounts.id, id));
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
    const employees = await db.select().from(schema.employees).where(
      and(
        eq(schema.employees.companyId, companyId),
        isNull(schema.employees.deletedAt)
      )
    ).orderBy(asc(schema.employees.firstName), asc(schema.employees.lastName));
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
    
    // Calculate balance for each employee - use stored currentBalance which includes deposits
    const employeesWithBalances = employees.map((employee) => {
      // Use employee.currentBalance which is updated by deposits/bonuses/withdrawals
      // This includes opening balance + all deposits made via the deposit endpoint
      const calculatedBalance = parseFloat(employee.currentBalance || "0");

      return {
        ...employee,
        calculatedBalance: calculatedBalance.toFixed(2),
      };
    });

    return employeesWithBalances;
  }

  async getEmployeeByCode(code: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.code, code));
    return employee;
  }

  async getEmployeeById(id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, id));
    return employee;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [created] = await db.insert(schema.employees).values([employee as any]).returning();
    return created;
  }

  async updateEmployee(id: number, companyId: number, updates: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [updated] = await db
      .update(schema.employees)
      .set(updates as any)
      .where(and(eq(schema.employees.id, id), eq(schema.employees.companyId, companyId)))
      .returning();
    return updated;
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

      // Proceed with soft deletion
      const now = new Date();
      
      if (linkedAccount) {
        // Soft delete linked ledger account
        await tx
          .update(schema.ledgerAccounts)
          .set({ deletedAt: now, active: false })
          .where(eq(schema.ledgerAccounts.id, linkedAccount.id));
      }

      // Remove employee from any groups (keep hard delete for association table)
      await tx
        .delete(schema.employeeGroupMembers)
        .where(eq(schema.employeeGroupMembers.employeeId, id));

      // Soft delete the employee
      await tx
        .update(schema.employees)
        .set({ deletedAt: now, active: false })
        .where(eq(schema.employees.id, id));

      return { success: true };
    });
  }

  // Employee Groups
  async getAllEmployeeGroups(companyId: number): Promise<any[]> {
    const results = await db
      .select()
      .from(schema.employeeGroups)
      .where(eq(schema.employeeGroups.companyId, companyId))
      .orderBy(asc(schema.employeeGroups.name));
    // Explicitly map groupType for API compatibility
    return results.map(g => ({
      ...g,
      groupType: (g as any).groupType || "Employee"
    }));
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
  async getAllSuppliers(search?: string, limit?: number): Promise<Supplier[]> {
    const conditions: any[] = [isNull(schema.suppliers.deletedAt)];
    if (search) {
      conditions.push(ilike(schema.suppliers.legalName, `%${search}%`));
    }
    let query = db.select().from(schema.suppliers)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(asc(schema.suppliers.legalName)) as any;
    if (limit) {
      query = query.limit(limit);
    }
    return await query;
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

  async deleteSupplier(id: number): Promise<void> {
    await db.update(schema.suppliers)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(schema.suppliers.id, id));
  }

  // Stock Groups
  async getAllStockGroups(companyId: number): Promise<StockGroup[]> {
    return await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.companyId, companyId)).orderBy(asc(schema.stockGroups.name));
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

  async getStockGroupById(id: number, companyId: number): Promise<StockGroup | undefined> {
    const [group] = await db.select().from(schema.stockGroups).where(
      and(
        eq(schema.stockGroups.id, id),
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
    return await db.select().from(schema.stockItems).where(
      and(
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
      )
    ).orderBy(asc(schema.stockItems.code));
  }

  async getStockItemByCode(code: string, companyId: number): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(
      and(
        eq(schema.stockItems.code, code),
        eq(schema.stockItems.companyId, companyId),
        isNull(schema.stockItems.deletedAt)
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
    // Soft delete - set deletedAt and active=false instead of hard delete
    await db
      .update(schema.stockItems)
      .set({ deletedAt: new Date(), active: false })
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
    // Soft delete - set deletedAt and active=false instead of hard delete
    await db
      .update(schema.stockItems)
      .set({ deletedAt: new Date(), active: false })
      .where(inArray(schema.stockItems.id, ids));
  }

  async getStockItemByCodeOrAlias(code: string, companyId: number): Promise<StockItem | undefined> {
    // First check if it matches a primary code (case-insensitive) - exclude soft-deleted items
    const [directMatch] = await db
      .select()
      .from(schema.stockItems)
      .where(
        and(
          sql`LOWER(${schema.stockItems.code}) = LOWER(${code})`,
          eq(schema.stockItems.companyId, companyId),
          isNull(schema.stockItems.deletedAt)
        )
      )
      .limit(1);
    
    if (directMatch) {
      return directMatch;
    }

    // If not found, check if it matches any alias (case-insensitive) - exclude soft-deleted items
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
          eq(schema.stockItems.companyId, companyId),
          isNull(schema.stockItems.deletedAt)
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

  async getAllCompanyCodeAliases(companyId: number): Promise<schema.StockItemCodeAlias[]> {
    return await db
      .select()
      .from(schema.stockItemCodeAliases)
      .where(eq(schema.stockItemCodeAliases.companyId, companyId))
      .orderBy(asc(schema.stockItemCodeAliases.aliasCode));
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
    return await db.select().from(schema.bankAccounts).where(
      and(
        eq(schema.bankAccounts.companyId, companyId),
        isNull(schema.bankAccounts.deletedAt)
      )
    ).orderBy(asc(schema.bankAccounts.code));
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

    // Soft delete - scoped to both id AND companyId
    await db.update(schema.bankAccounts)
      .set({ deletedAt: new Date(), active: false })
      .where(
        and(
          eq(schema.bankAccounts.id, id),
          eq(schema.bankAccounts.companyId, companyId)
        )
      );
  }

  // Fixed Assets
  async getAllFixedAssets(companyId: number): Promise<FixedAsset[]> {
    return await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, companyId)).orderBy(asc(schema.fixedAssets.code));
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
    return await db.select().from(schema.containers).where(eq(schema.containers.companyId, companyId)).orderBy(asc(schema.containers.containerNumber));
  }

  async getActiveContainers(companyId: number): Promise<Container[]> {
    return await db.select().from(schema.containers)
      .where(
        and(
          eq(schema.containers.companyId, companyId),
          ne(schema.containers.status, 'SOLD')
        )
      ).orderBy(asc(schema.containers.containerNumber));
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
    return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, companyId)).orderBy(asc(schema.purchaseOrders.poNumber));
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
        companyId: schema.purchaseOrders.companyId,
        containerId: schema.purchaseOrders.containerId,
        containerNumber: schema.containers.containerNumber,
        importDate: schema.containers.importDate,
        itemsTotal: schema.purchaseOrders.itemsTotal,
        freight: schema.purchaseOrders.freight,
        surcharge: schema.purchaseOrders.surcharge,
        fumigation: schema.purchaseOrders.fumigation,
        documentCharges: schema.purchaseOrders.documentCharges,
        discount: schema.purchaseOrders.discount,
        otherCharges: schema.purchaseOrders.otherCharges,
        currency: schema.purchaseOrders.currency,
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

  async createPurchaseOrder(po: InsertPurchaseOrder, voucherDateOverride?: string): Promise<PurchaseOrder> {
    const [created] = await db.insert(schema.purchaseOrders).values(po).returning();
    
    // ============================================================
    // INTER-COMPANY CREDIT ACCOUNTING
    // Create purchase vouchers when PO is imported, not when offloaded
    // For subsidiaries: DR Purchases CR [Parent] Credit (subsidiary) + DR [Subsidiary] Credit CR Supplier (parent)
    // For parent company: DR Purchases CR Supplier
    // 
    // IMPORTANT: Skip voucher creation if voucherId is already provided!
    // This happens when the PO import route (routes.ts) already creates vouchers.
    // ============================================================
    
    // Skip voucher creation if voucher was already created by the caller (e.g., PO import route)
    if (po.voucherId) {
      return created;
    }
    
    // Calculate PO total: items + freight + other charges
    const poItemsTotal = parseFloat(po.itemsTotal || "0");
    const poFreight = parseFloat(po.freight || "0");
    const poSurcharge = parseFloat(po.surcharge || "0");
    const poFumigation = parseFloat(po.fumigation || "0");
    const poDocumentCharges = parseFloat(po.documentCharges || "0");
    const poDiscount = parseFloat(po.discount || "0");
    const poOtherCharges = parseFloat(po.otherCharges || "0");
    const poChargesAmount = poFreight + poSurcharge + poFumigation + poDocumentCharges - poDiscount + poOtherCharges;
    const poTotal = poItemsTotal + poChargesAmount;
    
    if (poTotal > 0 && po.companyId) {
      // Look up container number and supplier name for daybook description
      let containerNum = '';
      let supplierDisplayName = '';
      if (po.containerId) {
        const [cont] = await db
          .select({ containerNumber: schema.containers.containerNumber })
          .from(schema.containers)
          .where(eq(schema.containers.id, po.containerId))
          .limit(1);
        containerNum = cont?.containerNumber || '';
      }
      if (po.supplierId) {
        const [sup] = await db
          .select({ legalName: schema.suppliers.legalName })
          .from(schema.suppliers)
          .where(eq(schema.suppliers.id, po.supplierId))
          .limit(1);
        supplierDisplayName = sup?.legalName || '';
      }
      const descBase = containerNum || supplierDisplayName
        ? [containerNum, supplierDisplayName].filter(Boolean).join(' ')
        : '';

      // Get parent company from system settings (not hardcoded name)
      const parentCompanyId = await this.getParentCompanyId();
      const allCompanies = await db.select().from(schema.companies);
      const parentCompany = parentCompanyId ? allCompanies.find(c => c.id === parentCompanyId) : null;
      const currentCompany = allCompanies.find(c => c.id === po.companyId);
      
      // Get or create PURCHASES ledger account for this company
      let purchasesAccount = await db
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, po.companyId),
            eq(schema.ledgerAccounts.code, "PURCHASES"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      
      if (!purchasesAccount.length) {
        const [newAccount] = await db.insert(schema.ledgerAccounts).values({
          companyId: po.companyId,
          code: "PURCHASES",
          name: "Purchases",
          accountType: "Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
        }).returning();
        purchasesAccount = [newAccount];
      }
      
      // Phase 11: Prefer caller-supplied date (built from client timezone via getClientDate(req)).
      // Fallback to server UTC only if caller didn't pass one (legacy / non-HTTP entry points).
      const voucherDate = voucherDateOverride || new Date().toISOString().split('T')[0];

      if (parentCompany && po.companyId !== parentCompany.id) {
        // ============================================================
        // SUBSIDIARY COMPANY - Create TWO vouchers
        // 1. In subsidiary: DR Purchases (goods), [DR Purchases (freight)], CR [Parent] Credit
        // 2. In Parent: DR [Subsidiary] Credit, CR Supplier (goods only), [CR Freight account]
        //
        // When freightPaidBy='parent', the parent fronts the freight on behalf of the
        // subsidiary. The child owes the parent the full grossTotal. The supplier only
        // gets credited for goods (intercoTotal). The freight account gets the freight CR.
        // ============================================================

        // Determine freight split
        const isParentFreight = (po as any).freightPaidBy === 'parent' && poFreight > 0;
        // intercoTotal = goods-only portion (grossTotal minus freight when parent pays freight)
        const poIntercoTotal = isParentFreight ? poTotal - poFreight : poTotal;
        // freightParentAccountId: account in parent company to credit for freight
        const freightParentAcctId: number | null = isParentFreight
          ? ((po as any).freightParentAccountId ?? null)
          : null;
        
        // --- SUBSIDIARY VOUCHER ---
        // Get or create "[Parent] Credit" liability account in subsidiary
        const parentCreditCode = parentCompany.name.toUpperCase().replace(/\s+/g, '_') + "_CREDIT";
        const parentCreditName = parentCompany.name + " Credit";
        
        let parentCreditAccount = await db
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, po.companyId),
              eq(schema.ledgerAccounts.code, parentCreditCode),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        if (!parentCreditAccount.length) {
          const [newAccount] = await db.insert(schema.ledgerAccounts).values({
            companyId: po.companyId,
            code: parentCreditCode,
            name: parentCreditName,
            accountType: "Liability",
            subType: "Current Liability",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          }).returning();
          parentCreditAccount = [newAccount];
        }
        
        // Create Purchase voucher in subsidiary
        // Total is always grossTotal — child owes parent the full amount
        const subsidiaryVoucherNumber = `PURCH-${created.poNumber}-${Date.now()}`;
        const [subsidiaryVoucher] = await db.insert(schema.vouchers).values({
          companyId: po.companyId,
          voucherNumber: subsidiaryVoucherNumber,
          voucherType: "Purchase",
          voucherDate,
          description: descBase || `Purchase for PO ${created.poNumber} (${parentCompany.name} paid supplier)`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        }).returning();
        
        // DR Purchases — goods portion
        await db.insert(schema.voucherEntries).values({
          voucherId: subsidiaryVoucher.id,
          ledgerAccountId: purchasesAccount[0].id,
          debitAmount: poIntercoTotal.toFixed(2),
          creditAmount: "0",
          narration: `PO ${created.poNumber} - Purchases`,
        });

        // DR Purchases — freight portion (only when parent pays freight)
        if (isParentFreight) {
          await db.insert(schema.voucherEntries).values({
            voucherId: subsidiaryVoucher.id,
            ledgerAccountId: purchasesAccount[0].id,
            debitAmount: poFreight.toFixed(2),
            creditAmount: "0",
            narration: `PO ${created.poNumber} - Freight (paid by ${parentCompany.name})`,
          });
        }
        
        // CR [Parent] Credit (we owe parent company the full grossTotal)
        await db.insert(schema.voucherEntries).values({
          voucherId: subsidiaryVoucher.id,
          ledgerAccountId: parentCreditAccount[0].id,
          debitAmount: "0",
          creditAmount: poTotal.toFixed(2),
          narration: `PO ${created.poNumber} - ${parentCompany.name} paid supplier`,
        });
        
        // Update PO with voucher reference
        await db.update(schema.purchaseOrders)
          .set({ voucherId: subsidiaryVoucher.id })
          .where(eq(schema.purchaseOrders.id, created.id));
        
        // --- PARENT COMPANY VOUCHER ---
        // Get or create "[Subsidiary] Credit" receivable account in parent company
        const subsidiaryCode = currentCompany?.name?.toUpperCase().replace(/\s+/g, '_') + "_CREDIT" || "SUBSIDIARY_CREDIT";
        const subsidiaryName = (currentCompany?.name || "Subsidiary") + " Credit";
        
        let subsidiaryReceivableAccount = await db
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, parentCompany.id),
              eq(schema.ledgerAccounts.code, subsidiaryCode),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        if (!subsidiaryReceivableAccount.length) {
          const [newAccount] = await db.insert(schema.ledgerAccounts).values({
            companyId: parentCompany.id,
            code: subsidiaryCode,
            name: subsidiaryName,
            accountType: "Asset",
            subType: "Current Asset",
            openingBalance: "0",
            openingBalanceSide: "Dr",
          }).returning();
          subsidiaryReceivableAccount = [newAccount];
        }
        
        // Create Journal voucher in parent company
        // Total = grossTotal when parent-freight, else intercoTotal
        const parentVoucherNumber = `INTERCO-PARENT-${created.poNumber}-${Date.now()}`;
        const [parentVoucher] = await db.insert(schema.vouchers).values({
          companyId: parentCompany.id,
          voucherNumber: parentVoucherNumber,
          voucherType: "Journal",
          voucherDate,
          description: descBase
            ? `${descBase} - ${currentCompany?.name || 'Subsidiary'}`
            : `Inter-company PO ${created.poNumber} - ${currentCompany?.name || 'Subsidiary'}`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        }).returning();
        
        const intercoNarration = containerNum
          ? `${currentCompany?.name || 'Subsidiary'} PO ${created.poNumber} - Container ${containerNum}`
          : `PO ${created.poNumber} - ${currentCompany?.name || 'Subsidiary'} owes us`;

        // DR [Subsidiary] Credit (they owe us the full grossTotal)
        await db.insert(schema.voucherEntries).values({
          voucherId: parentVoucher.id,
          ledgerAccountId: subsidiaryReceivableAccount[0].id,
          debitAmount: poTotal.toFixed(2),
          creditAmount: "0",
          narration: intercoNarration,
        });
        
        // CR Supplier — goods only (intercoTotal, excludes freight when parent pays it)
        if (po.supplierId) {
          await db.insert(schema.voucherEntries).values({
            voucherId: parentVoucher.id,
            supplierId: po.supplierId,
            debitAmount: "0",
            creditAmount: poIntercoTotal.toFixed(2),
            narration: intercoNarration,
          });
        }

        // CR Freight account in parent (when parent pays freight and account is configured)
        if (isParentFreight && freightParentAcctId) {
          await db.insert(schema.voucherEntries).values({
            voucherId: parentVoucher.id,
            ledgerAccountId: freightParentAcctId,
            debitAmount: "0",
            creditAmount: poFreight.toFixed(2),
            narration: containerNum
              ? `Freight - ${currentCompany?.name || 'Subsidiary'} PO ${created.poNumber} - Container ${containerNum}`
              : `Freight - PO ${created.poNumber}`,
          });
        }
        
      } else {
        // ============================================================
        // PARENT COMPANY (or no parent set) - Standard purchase voucher
        // DR Purchases, CR Supplier
        // ============================================================
        const voucherNumber = `PURCH-${created.poNumber}-${Date.now()}`;
        const [purchaseVoucher] = await db.insert(schema.vouchers).values({
          companyId: po.companyId,
          voucherNumber,
          voucherType: "Purchase",
          voucherDate,
          description: descBase || `Purchase for PO ${created.poNumber}`,
          totalAmount: poTotal.toFixed(2),
          optional: false,
        }).returning();
        
        // DR Purchases
        await db.insert(schema.voucherEntries).values({
          voucherId: purchaseVoucher.id,
          ledgerAccountId: purchasesAccount[0].id,
          debitAmount: poTotal.toFixed(2),
          creditAmount: "0",
          narration: `PO ${created.poNumber} - Purchases`,
        });
        
        // CR Supplier
        if (po.supplierId) {
          await db.insert(schema.voucherEntries).values({
            voucherId: purchaseVoucher.id,
            supplierId: po.supplierId,
            debitAmount: "0",
            creditAmount: poTotal.toFixed(2),
            narration: `PO ${created.poNumber} - Supplier`,
          });
        }
        
        // Update PO with voucher reference
        await db.update(schema.purchaseOrders)
          .set({ voucherId: purchaseVoucher.id })
          .where(eq(schema.purchaseOrders.id, created.id));
      }
    }
    
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
    const poItemsTotal = parseFloat(po.itemsTotal || "0");
    const poFreight = parseFloat(po.freight || "0");
    const poOtherCharges = parseFloat(po.otherCharges || "0");
    const poCharges = poFreight + poOtherCharges;

    // Get container info for deleting charge vouchers
    const [container] = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.id, containerId))
      .limit(1);

    // Delete PO line items
    await db.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, id));

    // Delete the PO
    await db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));

    // Delete the voucher if it exists (this removes the supplier payable entry).
    // Guard against: voucher already deleted from daybook, or a restrict FK on another
    // table (e.g. container_sales, stock_transfer_vouchers) still pointing to this voucher.
    if (po.voucherId) {
      try {
        // Hard-delete entries first (they CASCADE anyway, but be explicit)
        await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, po.voucherId));
        await db.delete(schema.vouchers).where(eq(schema.vouchers.id, po.voucherId));
      } catch (_hardDeleteErr) {
        // FK restrict from another table is blocking the hard-delete.
        // Fall back to a soft-delete so the voucher is hidden from the daybook
        // but the referencing rows remain valid.
        try {
          await db
            .update(schema.vouchers)
            .set({ deletedAt: new Date() })
            .where(and(eq(schema.vouchers.id, po.voucherId), isNull(schema.vouchers.deletedAt)));
        } catch (_softDeleteErr) {
          // Voucher is already gone or already soft-deleted — nothing to do.
        }
      }
    }

    // Check if there are any remaining POs for this container
    const remainingPOs = await db
      .select()
      .from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.containerId, containerId))
      .limit(1);

    if (remainingPOs.length === 0 && container) {
      // Delete container charge vouchers (Freight, Surcharge, Fumigation, Document Charges, Discount)
      // These vouchers have descriptions like "Freight - Container MRKUS557707"
      const chargeVouchers = await db
        .select()
        .from(schema.vouchers)
        .where(
          and(
            eq(schema.vouchers.companyId, po.companyId),
            sql`${schema.vouchers.description} LIKE ${'% - Container ' + container.containerNumber}`
          )
        );

      for (const chargeVoucher of chargeVouchers) {
        await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
        await db.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
      }

      // Delete the container and all its charges if no POs remain
      await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
      await db.delete(schema.importLogs).where(eq(schema.importLogs.containerId, containerId));
      await db.delete(schema.containers).where(eq(schema.containers.id, containerId));
    } else if (container) {
      // Update container totals - subtract both items and charges from the PO
      const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - poItemsTotal);
      const newChargesTotal = Math.max(0, parseFloat(container.chargesTotal || "0") - poCharges);
      const newGrandTotal = newItemsTotal + newChargesTotal;

      await db
        .update(schema.containers)
        .set({
          itemsTotal: newItemsTotal.toString(),
          chargesTotal: newChargesTotal.toString(),
          grandTotal: newGrandTotal.toString(),
        })
        .where(eq(schema.containers.id, containerId));
    }
  }

  async deleteContainer(id: number): Promise<void> {
    // Get container info for deleting charge vouchers
    const [container] = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.id, id))
      .limit(1);

    if (!container) {
      throw new Error("Container not found");
    }

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

    // Delete container charge vouchers (Freight, Surcharge, Fumigation, Document Charges, Discount)
    // These vouchers have descriptions like "Freight - Container MRKUS557707"
    const chargeVouchers = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          eq(schema.vouchers.companyId, container.companyId),
          sql`${schema.vouchers.description} LIKE ${'% - Container ' + container.containerNumber}`
        )
      );

    for (const chargeVoucher of chargeVouchers) {
      await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
      await db.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
    }

    // Delete container charges
    await db.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, id));

    // Delete container sale voucher (DR: customer account, CR: commission revenue)
    const sales = await db
      .select()
      .from(schema.containerSales)
      .where(eq(schema.containerSales.containerId, id));

    for (const sale of sales) {
      if (sale.voucherId) {
        await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, sale.voucherId));
        await db.delete(schema.vouchers).where(eq(schema.vouchers.id, sale.voucherId));
      }
    }
    await db.delete(schema.containerSales).where(eq(schema.containerSales.containerId, id));

    // Delete container offload items then offloads
    const offloads = await db
      .select({ id: schema.containerOffloads.id })
      .from(schema.containerOffloads)
      .where(eq(schema.containerOffloads.containerId, id));

    for (const offload of offloads) {
      await db.delete(schema.containerOffloadItems).where(eq(schema.containerOffloadItems.offloadId, offload.id));
    }
    await db.delete(schema.containerOffloads).where(eq(schema.containerOffloads.containerId, id));

    // Delete container freight payments then freight records
    const freights = await db
      .select({ id: schema.containerFreight.id })
      .from(schema.containerFreight)
      .where(eq(schema.containerFreight.containerId, id));

    for (const freight of freights) {
      await db.delete(schema.containerFreightPayments).where(eq(schema.containerFreightPayments.containerFreightId, freight.id));
    }
    await db.delete(schema.containerFreight).where(eq(schema.containerFreight.containerId, id));

    // Delete container documents
    await db.delete(schema.containerDocuments).where(eq(schema.containerDocuments.containerId, id));

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
        stockGroupId: schema.stockItems.stockGroupId,
        stockGroupName: sql<string>`COALESCE(${schema.stockGroups.name}, '')`,
        gradeId: schema.stockItems.gradeId,
        gradeName: sql<string | null>`${schema.stockGrades.name}`,
        categoryId: schema.stockItems.categoryId,
        categoryName: sql<string | null>`${schema.stockCategories.name}`,
      })
      .from(schema.poLineItems)
      .leftJoin(schema.stockItems, eq(schema.poLineItems.stockItemId, schema.stockItems.id))
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .leftJoin(schema.stockGrades, eq(schema.stockItems.gradeId, schema.stockGrades.id))
      .leftJoin(schema.stockCategories, eq(schema.stockItems.categoryId, schema.stockCategories.id))
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
  async getStockItemByBarcode(barcode: string, companyId?: number): Promise<StockItem | undefined> {
    const conditions: any[] = [eq(schema.stockItems.code, barcode)];
    if (companyId) conditions.push(eq(schema.stockItems.companyId, companyId));
    const [item] = await db.select().from(schema.stockItems).where(and(...conditions));
    return item;
  }

  // Stock Item Location Prices
  async getStockItemLocationPrices(stockItemId: number, companyId?: number): Promise<any[]> {
    const conditions = [eq(schema.stockItemLocationPrices.stockItemId, stockItemId)];
    if (companyId) {
      conditions.push(eq(schema.locations.companyId, companyId));
    }
    return await db
      .select({
        id: schema.stockItemLocationPrices.id,
        stockItemId: schema.stockItemLocationPrices.stockItemId,
        locationId: schema.stockItemLocationPrices.locationId,
        sellingPrice: schema.stockItemLocationPrices.sellingPrice,
        createdAt: schema.stockItemLocationPrices.createdAt,
        updatedAt: schema.stockItemLocationPrices.updatedAt,
        locationName: schema.locations.name,
      })
      .from(schema.stockItemLocationPrices)
      .leftJoin(schema.locations, eq(schema.stockItemLocationPrices.locationId, schema.locations.id))
      .where(and(...conditions));
  }

  async getAllLocationPrices(companyId: number): Promise<{ stockItemId: number; locationId: number; locationName: string; sellingPrice: string }[]> {
    return await db
      .select({
        stockItemId: schema.stockItemLocationPrices.stockItemId,
        locationId: schema.stockItemLocationPrices.locationId,
        locationName: schema.locations.name,
        sellingPrice: schema.stockItemLocationPrices.sellingPrice,
      })
      .from(schema.stockItemLocationPrices)
      .innerJoin(schema.locations, eq(schema.stockItemLocationPrices.locationId, schema.locations.id))
      .where(eq(schema.locations.companyId, companyId)) as any;
  }

  async upsertLocationPrice(stockItemId: number, locationId: number, sellingPrice: string): Promise<void> {
    await db
      .insert(schema.stockItemLocationPrices)
      .values({
        stockItemId,
        locationId,
        sellingPrice: sellingPrice,
      })
      .onConflictDoUpdate({
        target: [schema.stockItemLocationPrices.stockItemId, schema.stockItemLocationPrices.locationId],
        set: {
          sellingPrice: sellingPrice,
          updatedAt: new Date(),
        },
      });
  }

  async deleteLocationPrice(id: number): Promise<void> {
    await db.delete(schema.stockItemLocationPrices).where(eq(schema.stockItemLocationPrices.id, id));
  }

  // Inventory - Location-based stock tracking
  async getLocationInventory(locationId: number): Promise<any[]> {
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
        lastSellingPrice: sql<string>`COALESCE(${schema.stockItemLocationPrices.sellingPrice}, ${schema.stockItems.sellingPrice})`.as('configured_price'),
        stockItemActive: schema.stockItems.active,
        categoryId: schema.stockItems.categoryId,
        categoryName: schema.stockCategories.name,
      })
      .from(schema.inventory)
      .leftJoin(
        schema.stockItems,
        eq(schema.inventory.stockItemId, schema.stockItems.id)
      )
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .leftJoin(schema.stockCategories, eq(schema.stockItems.categoryId, schema.stockCategories.id))
      .leftJoin(
        schema.stockItemLocationPrices,
        and(
          eq(schema.stockItemLocationPrices.stockItemId, schema.inventory.stockItemId),
          eq(schema.stockItemLocationPrices.locationId, locationId)
        )
      )
      .where(
        and(
          eq(schema.inventory.locationId, locationId),
          isNotNull(schema.stockItems.id)
        )
      );

    return results;
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
        categoryId: schema.stockItems.categoryId,
        categoryName: schema.stockCategories.name,
      })
      .from(schema.inventory)
      .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .leftJoin(schema.stockCategories, eq(schema.stockItems.categoryId, schema.stockCategories.id))
      .innerJoin(schema.locations, eq(schema.inventory.locationId, schema.locations.id))
      .where(
        and(
          eq(schema.inventory.companyId, companyId),
          isNull(schema.locations.deletedAt),
        )
      );

    return results;
  }

  async updateInventory(locationId: number, stockItemId: number, quantity: string, averageRate: string, totalValue: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Get the location's companyId
      const [location] = await tx
        .select()
        .from(schema.locations)
        .where(eq(schema.locations.id, locationId));
      
      if (!location) {
        throw new Error("Location not found");
      }

      // Check if inventory record exists (with row lock)
      const existingRows = await (tx as any).execute(
        sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId} FOR UPDATE`
      );
      const existing = existingRows.rows?.[0] || existingRows[0];

      const numericQuantity = parseFloat(quantity);
      if (existing) {
        // Update existing record
        await tx
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
        await tx.insert(schema.inventory).values({
          companyId: location.companyId,
          locationId,
          stockItemId,
          quantity,
          averageRate,
          totalValue,
          lastUpdated: new Date(),
        });
      }
    });
  }

  async updateCostPricesByBarcode(locationId: number, companyId: number, updates: Array<{ barcode: string; costPrice: number }>): Promise<{ updated: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;

    for (const update of updates) {
      try {
        // Find stock item by barcode (code or alias)
        const stockItem = await this.getStockItemByCodeOrAlias(update.barcode, companyId);
        if (!stockItem) {
          errors.push(`Barcode not found: ${update.barcode}`);
          continue;
        }

        await db.transaction(async (tx) => {
          // Find inventory record (with row lock)
          const inventoryRows = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItem.id} FOR UPDATE`
          );
          const inventory = inventoryRows.rows?.[0] || inventoryRows[0];

          if (inventory) {
            // Update existing inventory record (including those with 0 quantity from POS sales)
            const newTotalValue = (parseFloat(inventory.quantity) * update.costPrice).toFixed(2);
            await tx
              .update(schema.inventory)
              .set({
                averageRate: update.costPrice.toFixed(2),
                totalValue: newTotalValue,
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, inventory.id));
            updated++;
          } else {
            errors.push(`Item not found in inventory for barcode: ${update.barcode}`);
          }
        });
      } catch (err: any) {
        errors.push(`Error processing ${update.barcode}: ${err.message}`);
      }
    }

    return { updated, errors };
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
    additionalCharges: Array<{ description: string; amount: number; ledgerAccountId: number }> = [],
    offloadDate?: string,
    inventoryCostCorrections: Array<{ stockItemId: number; correctRate: number }> = []
  ): Promise<ContainerOffload> {
    // Get container to access PO charges (freight + otherCharges from purchase orders)
    const container = await this.getContainerById(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }
    
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

    // Calculate total charges including additional charges AND PO charges (freight + otherCharges)
    // ALL import-related charges are capitalized into inventory cost to keep import cycle balanced:
    // - Duties, Transfer Charges, Transport Fees (agent liabilities)
    // - Office Charges (stored as Loans liability - money owed for office/clearing expenses)
    // - Additional Charges (misc charges with specific ledger accounts)
    // - PO Charges (freight + otherCharges from purchase orders)
    const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
    const poCharges = parseFloat(container.chargesTotal || "0"); // Freight + otherCharges from POs
    const totalCharges = 
      parseFloat(duties) + 
      parseFloat(officeCharges) +  // Office charges are capitalized to balance Loans liability
      parseFloat(transferCharges) + 
      parseFloat(transportFees) +
      additionalChargesTotal +
      poCharges; // Include PO freight/charges in inventory cost

    // Calculate additional cost per bale
    // Round to 2 decimal places to prevent floating-point accumulation errors
    const additionalCostPerBale = totalBales > 0 ? Math.round((totalCharges / totalBales) * 100) / 100 : 0;
    
    // Calculate rounding difference to distribute to last item
    // This ensures total charges added to inventory exactly matches voucher entries
    const expectedChargesApplied = additionalCostPerBale * totalBales;
    const roundingDifference = Math.round((totalCharges - expectedChargesApplied) * 100) / 100;

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

    // Track offload items for exact reversal later
    const offloadItemsToStore: Array<{stockItemId: number; quantity: number; rate: number; totalValue: number}> = [];

    // Convert itemsMap to array to identify last item for rounding adjustment
    const itemsArray = Array.from(itemsMap.entries());
    const lastItemIndex = itemsArray.length - 1;

    // Add inventory to destination location with weighted average cost
    // Wrapped in a DB transaction for atomicity
    const offload = await db.transaction(async (tx) => {
    // Apply inventory cost corrections BEFORE adding new container stock
    const validCorrectionItemIds = new Set(itemsMap.keys());
    if (inventoryCostCorrections.length > 0) {
      for (const correction of inventoryCostCorrections) {
        if (correction.correctRate <= 0) continue;
        if (!validCorrectionItemIds.has(correction.stockItemId)) {
          console.warn(`[Offload] Skipping cost correction for stockItem=${correction.stockItemId}: not in container's line items`);
          continue;
        }
        const correctionRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${correction.stockItemId} FOR UPDATE`
        );
        const corrRow = correctionRows.rows?.[0] || correctionRows[0];
        if (corrRow) {
          const existingQty = parseFloat(corrRow.quantity);
          if (existingQty > 0) {
            const newTotalValue = existingQty * correction.correctRate;
            await tx
              .update(schema.inventory)
              .set({
                averageRate: correction.correctRate.toFixed(2),
                totalValue: newTotalValue.toFixed(2),
                lastUpdated: new Date(),
              })
              .where(eq(schema.inventory.id, corrRow.id));
            console.log(`[Offload] Cost correction: stockItem=${correction.stockItemId}, qty=${existingQty}, oldRate=${corrRow.average_rate}, newRate=${correction.correctRate}, newTotal=${newTotalValue.toFixed(2)}`);
          }
        }
      }
    }

    for (let i = 0; i < itemsArray.length; i++) {
      const [stockItemId, data] = itemsArray[i];
      const isLastItem = i === lastItemIndex;
      
      // Safety check for division by zero
      if (data.totalQuantity === 0) {
        console.error("Skipping item with zero quantity:", stockItemId);
        continue;
      }
      
      const averageOriginalRate = data.weightedRateSum / data.totalQuantity;
      
      // Calculate base new rate with standard additional cost
      const newRate = averageOriginalRate + additionalCostPerBale;
      
      // Calculate offload value in cents for precise rounding
      // This ensures inventory totals exactly match voucher entries (no cents imbalance)
      let offloadValueCents = Math.round(data.totalQuantity * newRate * 100);
      if (isLastItem && roundingDifference !== 0) {
        // Add rounding difference in cents to last item
        offloadValueCents += Math.round(roundingDifference * 100);
      }
      
      // Convert back to dollars, now precisely rounded
      const offloadValue = offloadValueCents / 100;
      
      // Calculate adjusted rate from the corrected total value (for reversals)
      const adjustedRate = offloadValue / data.totalQuantity;
      
      // Store the EXACT values added for this item (for lossless reversal)
      // Use the already-rounded offloadValue to ensure reversals match exactly
      offloadItemsToStore.push({
        stockItemId,
        quantity: data.totalQuantity,
        rate: adjustedRate,
        totalValue: offloadValue,
      });
      
      // Safety check for infinity
      if (!isFinite(newRate)) {
        throw new Error(`Calculated rate is infinite for stock item ${stockItemId}. averageRate=${averageOriginalRate}, additionalCost=${additionalCostPerBale}`);
      }
      
      // Check if inventory exists (with row lock)
      const existingRows = await (tx as any).execute(
        sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItemId} FOR UPDATE`
      );
      const existing = existingRows.rows?.[0] || existingRows[0];

      if (existing) {
        // Add to existing inventory with weighted average rate
        const existingQty = parseFloat(existing.quantity);
        const existingRate = parseFloat(existing.average_rate);
        const existingValue = parseFloat(existing.total_value || "0");
        
        // Negative inventory is VALID when sales happen before container offload
        // We must ADD to it (not replace) so: -2 + 15 = 13 (correct)
        // Previously this was replaced: -2 -> 15 (incorrect, lost the pre-sale)
        if (existingQty < 0) {
          console.log(`Pre-sale inventory detected for stock item ${stockItemId}: existing qty = ${existingQty}, adding ${data.totalQuantity}`);
        }
        
        const newQty = existingQty + data.totalQuantity;
        
        // Calculate weighted average rate
        // Handle special cases where standard weighted average doesn't apply
        let weightedAvgRate: number;
        let newTotalValue: number;
        
        if (newQty === 0) {
          // Sold exactly what arrived - no inventory left, use adjusted rate for tracking
          weightedAvgRate = adjustedRate;
          newTotalValue = 0;
          console.log(`Zero inventory after offload for stock item ${stockItemId}: sold ${Math.abs(existingQty)}, received ${data.totalQuantity}`);
        } else if (newQty < 0) {
          // Oversold more than arrived - still negative inventory
          // Use the adjusted rate for tracking (this is an unusual situation)
          weightedAvgRate = adjustedRate;
          newTotalValue = newQty * adjustedRate; // Will be negative (represents owed value)
          console.warn(`Still negative inventory after offload for stock item ${stockItemId}: existing ${existingQty} + received ${data.totalQuantity} = ${newQty}`);
        } else {
          if (existingQty < 0) {
            console.warn(`[Offload] Crossing negative→positive: stockItem=${stockItemId} existingQty=${existingQty} existingValue=${existingValue} offloadQty=${data.totalQuantity} offloadValue=${offloadValue} newQty=${newQty}. Using newQty*adjustedRate to avoid inflation.`);
            newTotalValue = newQty * Math.max(adjustedRate, 0);
          } else {
            newTotalValue = existingValue + offloadValue;
            if (newQty > 0 && newTotalValue < 0) {
              console.warn(`[Offload] Clamping: existingValue=${existingValue}, offloadValue=${offloadValue}, newQty=${newQty}`);
              newTotalValue = newQty * Math.max(adjustedRate, 0);
            }
          }
          weightedAvgRate = newQty > 0 ? newTotalValue / newQty : 0;
        }
        
        // Safety check for infinity
        if (!isFinite(weightedAvgRate)) {
          throw new Error(`Calculated weighted average rate is infinite for stock item ${stockItemId}. existingQty=${existingQty}, existingRate=${existingRate}, newQty=${newQty}, newRate=${newRate}`);
        }

        await tx
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
        const [location] = await tx
          .select()
          .from(schema.locations)
          .where(eq(schema.locations.id, locationId));

        if (!location) {
          throw new Error(`Location ${locationId} not found when creating inventory record`);
        }

        // Use offloadValue which includes rounding adjustment for last item
        await tx.insert(schema.inventory).values({
          companyId: location.companyId,
          locationId,
          stockItemId,
          quantity: data.totalQuantity.toString(),
          averageRate: adjustedRate.toFixed(2),
          totalValue: offloadValue.toFixed(2),
          lastUpdated: new Date(),
        });
      }
    }

    // Update container status to OFFLOADED and persist the offload date on the containers row.
    // offloadDate must be stored here so the Container Report date filter can use it directly.
    // When status changes from OTW to OFFLOADED, the container is no longer counted in Stock OTW.
    // The import cycle balance uses container.status to filter which containers to include.
    // Also sync the actual duties entered at offload back to containers.dutyFee so the
    // Agent/Duty FIFO tab can use it — critical for destinations like Kinshasa where duty
    // is only known after offloading when the agent sends the invoice.
    const resolvedOffloadDate = offloadDate || new Date().toISOString().split("T")[0];
    const containerUpdateSet: Record<string, unknown> = {
      status: "OFFLOADED",
      offloadDate: resolvedOffloadDate,
    };
    const actualDuties = parseFloat(duties);
    if (actualDuties > 0) {
      containerUpdateSet.dutyFee = duties;
    }
    await tx.update(schema.containers)
      .set(containerUpdateSet)
      .where(eq(schema.containers.id, containerId));

    // Get location details for voucher entries (container already fetched at top)
    const location = await this.getLocationById(locationId);
    
    if (!location) {
      throw new Error("Location not found");
    }

    // Create voucher entries for charges with associated supplier accounts
    const voucherDate = offloadDate || new Date().toISOString().split('T')[0];
    
    // Helper function to find or create parent IMPORT_CHARGES account
    // This is a DEDICATED parent for import cycle tracking - separate from general EXPENSES
    const findOrCreateImportChargesParent = async () => {
      let [parentAccount] = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "IMPORT_CHARGES")
          )
        )
        .limit(1);

      if (!parentAccount) {
        [parentAccount] = await tx.insert(schema.ledgerAccounts).values({
          companyId: location.companyId,
          code: "IMPORT_CHARGES",
          name: "Import Charges",
          accountType: "Direct Expense",
          subType: "Direct Expense",
          openingBalance: "0",
          openingBalanceSide: "Dr",
        }).returning();
      }

      return parentAccount.id;
    };
    
    // Helper function to find or create expense accounts
    const findOrCreateExpenseAccount = async (code: string, name: string, parentId: number) => {
      let account = await tx
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
        // Use accountType: "Direct Expense" so it's included in import cycle's directExpenseBalance
        const [newAccount] = await tx.insert(schema.ledgerAccounts).values({
          companyId: location.companyId,
          code,
          name,
          accountType: "Direct Expense",
          subType: "Direct Expense",
          parentId,
          openingBalance: "0",
          openingBalanceSide: "Dr",
        }).returning();
        account = [newAccount];
      }

      return account[0].id;
    };
    
    // Get or create parent IMPORT_CHARGES account
    const importChargesParentId = await findOrCreateImportChargesParent();
    
    // ============================================================
    // PURCHASE VOUCHERS - Already created at PO import time
    // Just update the voucher description to mark it as offloaded
    // ============================================================
    for (const po of pos) {
      if (po.voucherId) {
        await tx.update(schema.vouchers)
          .set({ 
            description: `Purchase Order ${po.poNumber} - Container ${container.containerNumber} (Offloaded)` 
          })
          .where(eq(schema.vouchers.id, po.voucherId));
      }
    }
    
    // Duties voucher entry
    if (dutiesAccountId && parseFloat(duties) > 0) {
      const dutiesExpenseAccountId = await findOrCreateExpenseAccount("DUTIES", "Duties", importChargesParentId);
      const voucherNumber = `DUTY-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await tx.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Duties for container ${container.containerNumber}`,
        totalAmount: duties,
      }).returning();

      // Debit: Duties Expense (Expense increases)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: dutiesExpenseAccountId,
        debitAmount: duties,
        creditAmount: "0",
        narration: `Duties for container ${container.containerNumber}`,
      });

      // Credit: Duty Agent account (Liability increases)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: dutiesAccountId,
        debitAmount: "0",
        creditAmount: duties,
        narration: `Duties for container ${container.containerNumber}`,
      });
    }

    // Office charges voucher entry
    // NOTE: Uses the user-selected office charges account directly (should be an Asset-type account)
    // This keeps the import cycle balanced: DR Asset (office charges account) = CR Asset (cash)
    if (officeChargesAccountId && officeChargesCashAccountId && parseFloat(officeCharges) > 0) {
      // T001: Validate that the office charges debit account is an Asset type.
      // If an Expense or Liability type is used here, the import cycle becomes permanently imbalanced
      // because the expense/liability movement is excluded from the formula while the cash deduction is not.
      const [officeChargesAccount] = await tx
        .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
        .from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.id, officeChargesAccountId), isNull(schema.ledgerAccounts.deletedAt)))
        .limit(1);
      const officeInvalidTypes = ["Expense", "Direct Expense", "Indirect Expense", "Income", "Liability", "Current Liability", "Profit", "Government Taxes", "COGS"];
      if (!officeChargesAccount || officeInvalidTypes.includes(officeChargesAccount.accountType)) {
        throw new Error(
          `Office charges account "${officeChargesAccount?.name || `ID ${officeChargesAccountId}`}" has type "${officeChargesAccount?.accountType ?? "deleted/not found"}" which is invalid. ` +
          `It must be an Asset-type account (e.g., a Receivable or Prepaid Expenses account) to keep the import cycle balanced.`
        );
      }
      const voucherNumber = `OFFICE-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await tx.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Office charges for container ${container.containerNumber}`,
        totalAmount: officeCharges,
      }).returning();

      // Debit: User-selected Office Charges Account (should be Asset type to keep import cycle balanced)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: officeChargesAccountId,
        debitAmount: officeCharges,
        creditAmount: "0",
        narration: `Office charges for container ${container.containerNumber}`,
      });

      // Credit: Cash Account (Cash decreases)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: officeChargesCashAccountId,
        debitAmount: "0",
        creditAmount: officeCharges,
        narration: `Office charges for container ${container.containerNumber}`,
      });
    }

    // Transport fees voucher entry
    if (parseFloat(transportFees) > 0) {
      const transportExpenseAccountId = await findOrCreateExpenseAccount("TRANSPORT", "Transport Charges", importChargesParentId);
      
      // Determine the credit account
      // Valid types: Transporter Agent, Liability, Current Liability (any liability-like account)
      // Invalid: Expense types (Direct Expense, Indirect Expense, Expense) - these would break import cycle
      let creditAccountId = transportAccountId;
      const expenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];
      
      // Helper to find or create Transport Fees Payable liability
      const getTransportPayableAccount = async () => {
        let transportPayableAccount = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, "TRANSPORT_PAYABLE"),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);

        if (!transportPayableAccount.length) {
          const [newAccount] = await tx.insert(schema.ledgerAccounts).values({
            companyId: location.companyId,
            code: "TRANSPORT_PAYABLE",
            name: "Transport Fees Payable",
            accountType: "Liability",
            subType: "Current Liability",
            openingBalance: "0",
            openingBalanceSide: "Cr",
          }).returning();
          transportPayableAccount = [newAccount];
        }
        return transportPayableAccount[0].id;
      };
      
      if (transportAccountId) {
        // Check if the selected account exists and is a valid type
        const [selectedAccount] = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.id, transportAccountId),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        if (!selectedAccount || expenseTypes.includes(selectedAccount.accountType)) {
          // Account not found, deleted, or is an expense type - use Transport Fees Payable liability
          creditAccountId = await getTransportPayableAccount();
        }
        // Otherwise, use the user-selected account (Transporter Agent, Liability, etc.)
      } else {
        // No transporter selected, use Transport Fees Payable liability
        creditAccountId = await getTransportPayableAccount();
      }
      
      // Final safety check - ensure we always have a valid creditAccountId
      if (!creditAccountId) {
        creditAccountId = await getTransportPayableAccount();
      }
      
      const voucherNumber = `TRANS-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await tx.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Transport fees for container ${container.containerNumber}`,
        totalAmount: transportFees,
      }).returning();

      // Debit: Transport Expense (Direct Expense - included in import cycle)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: transportExpenseAccountId,
        debitAmount: transportFees,
        creditAmount: "0",
        narration: `Transport fees for container ${container.containerNumber}`,
      });

      // Credit: Transporter Agent or Transport Fees Payable (Liability increases)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: creditAccountId,
        debitAmount: "0",
        creditAmount: transportFees,
        narration: `Transport fees for container ${container.containerNumber}`,
      });
    }

    // Transfer charges (if any) - creates a liability account for tracking
    // NOTE: Transfer charges are capitalized into inventory value (stockOnFloorValue increases)
    // We need to create a corresponding liability entry to balance the import cycle
    if (parseFloat(transferCharges) > 0) {
      // Create Direct Expense account for transfer charges (same pattern as duties/transport)
      const transferExpenseAccountId = await findOrCreateExpenseAccount("TRANSFER_CHARGES", "Transfer Charges", importChargesParentId);
      
      // Find or create a "Transfer Charges Payable" liability account (exclude soft-deleted)
      let transferPayableAccount = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "TRANSFER_PAYABLE"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);

      if (!transferPayableAccount.length) {
        const [newAccount] = await tx.insert(schema.ledgerAccounts).values({
          companyId: location.companyId,
          code: "TRANSFER_PAYABLE",
          name: "Transfer Charges Payable",
          accountType: "Liability",
          subType: "Current Liability",
          openingBalance: "0",
          openingBalanceSide: "Cr",
        }).returning();
        transferPayableAccount = [newAccount];
      }

      const voucherNumber = `XFER-${container.containerNumber}-${Date.now()}`;
      const [voucher] = await tx.insert(schema.vouchers).values({
        companyId: location.companyId,
        voucherNumber,
        voucherType: "Payment",
        voucherDate,
        description: `Transfer charges for container ${container.containerNumber}`,
        totalAmount: transferCharges,
      }).returning();

      // Debit: Transfer Charges Expense (Direct Expense - included in import cycle)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: transferExpenseAccountId,
        debitAmount: transferCharges,
        creditAmount: "0",
        narration: `Transfer charges for container ${container.containerNumber}`,
      });

      // Credit: Transfer Charges Payable (Liability increases)
      await tx.insert(schema.voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: transferPayableAccount[0].id,
        debitAmount: "0",
        creditAmount: transferCharges,
        narration: `Transfer charges for container ${container.containerNumber}`,
      });
    }

    // Additional charges voucher entries
    for (const charge of additionalCharges) {
      if (charge.amount > 0) {
        // T002: Validate the credit account is not a Direct Expense (import charges family).
        // Crediting a Direct Expense account cancels part of the capitalized charge in the
        // excluded IMPORT_CHARGES bucket without reducing any included account, creating a +X imbalance.
        const [additionalCreditAccount] = await tx
          .select({ accountType: schema.ledgerAccounts.accountType, name: schema.ledgerAccounts.name })
          .from(schema.ledgerAccounts)
          .where(and(eq(schema.ledgerAccounts.id, charge.ledgerAccountId), isNull(schema.ledgerAccounts.deletedAt)))
          .limit(1);
        if (!additionalCreditAccount) {
          throw new Error(
            `Additional charge "${charge.description}" references a deleted or non-existent ledger account (ID: ${charge.ledgerAccountId}). Please select a valid account.`
          );
        }
        if (additionalCreditAccount.accountType === "Direct Expense" || additionalCreditAccount.accountType === "Indirect Expense") {
          throw new Error(
            `Additional charge "${charge.description}" cannot credit the "${additionalCreditAccount.name}" account (type: ${additionalCreditAccount.accountType}). ` +
            `Use a Liability, Accounts Payable, Cash, or Bank account instead.`
          );
        }
        const voucherNumber = `CHG-${container.containerNumber}-${Date.now()}`;
        const [voucher] = await tx.insert(schema.vouchers).values({
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
          "Additional Container Charges",
          importChargesParentId
        );
        await tx.insert(schema.voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: additionalExpenseAccountId,
          debitAmount: charge.amount.toFixed(2),
          creditAmount: "0",
          narration: `${charge.description} for container ${container.containerNumber}`,
        });

        // Credit: Specified ledger account (Liability increases)
        await tx.insert(schema.voucherEntries).values({
          voucherId: voucher.id,
          ledgerAccountId: charge.ledgerAccountId,
          debitAmount: "0",
          creditAmount: charge.amount.toFixed(2),
          narration: `${charge.description} for container ${container.containerNumber}`,
        });
      }
    }

    // Create offload record with all calculated values
    const [offloadRecord] = await tx.insert(schema.containerOffloads).values({
      containerId,
      locationId,
      duties,
      officeCharges,
      transferCharges,
      transportFees,
      totalCharges: totalCharges.toFixed(2),
      totalBales: totalBales.toFixed(3),
      additionalCostPerBale: additionalCostPerBale.toFixed(2),
      offloadedAt: offloadDate ? new Date(offloadDate) : new Date(),
    }).returning();

    // Store offload items for exact reversal (prevents discrepancies from weighted average changes)
    for (const item of offloadItemsToStore) {
      await tx.insert(schema.containerOffloadItems).values({
        offloadId: offloadRecord.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
        totalValue: item.totalValue.toFixed(2),
      });
    }

    return offloadRecord;
    });

    return offload;
  }

  // Vouchers and Journal Entries
  async getAllVouchers(companyId: number): Promise<Voucher[]> {
    // Filter out soft-deleted vouchers and SP internal accounting journals
    // (OTW Reversal + Stock cost recognition — background double-entry, not user-facing)
    return await db.select().from(schema.vouchers).where(
      and(
        eq(schema.vouchers.companyId, companyId),
        isNull(schema.vouchers.deletedAt),
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OTW-REV-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-STOCK-%'`,
        sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OPNSTK-%'`,
      )
    ).orderBy(asc(schema.vouchers.voucherNumber));
  }

  async getVoucherById(id: number): Promise<Voucher | undefined> {
    const [voucher] = await db.select().from(schema.vouchers).where(eq(schema.vouchers.id, id));
    return voucher;
  }

  async getVouchersByDateRange(companyId: number, startDate: string, endDate: string): Promise<any[]> {
    // Filter by company and date range, excluding soft-deleted vouchers
    // and SP internal accounting journals (background double-entry, not user-facing)
    const vouchers = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          eq(schema.vouchers.companyId, companyId),
          sql`${schema.vouchers.voucherDate} >= ${startDate}`,
          sql`${schema.vouchers.voucherDate} <= ${endDate}`,
          isNull(schema.vouchers.deletedAt),
          sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OTW-REV-%'`,
          sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-STOCK-%'`,
          sql`${schema.vouchers.voucherNumber} NOT LIKE 'SP-OPNSTK-%'`,
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
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
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
        currency: schema.vouchers.currency,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions));

    return await query;
  }

  async getVoucherEntriesByCustomer(
    customerId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.customerId, customerId),
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
    ];

    if (startDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${schema.vouchers.voucherDate} <= ${endDate}`);
    }

    return await db
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
        currency: schema.vouchers.currency,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions));
  }

  async getVoucherEntriesByBankAccount(
    bankAccountId: number,
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [
      eq(schema.voucherEntries.bankAccountId, bankAccountId),
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
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
        currency: schema.vouchers.currency,
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
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
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
        currency: schema.vouchers.currency,
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
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
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
        currency: schema.vouchers.currency,
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
      eq(schema.vouchers.optional, false),
      isNull(schema.vouchers.deletedAt)
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
        currency: schema.vouchers.currency,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.vouchers, eq(schema.voucherEntries.voucherId, schema.vouchers.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`);

    return await query;
  }

  async getContainerCountBySupplier(supplierId: number, companyId?: number): Promise<number> {
    const conditions = [
      eq(schema.containers.supplierId, supplierId),
      // Only count containers that are not yet offloaded or sold
      sql`${schema.containers.status} NOT IN ('OFFLOADED', 'SOLD')`
    ];
    
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
        factorySupplierId: schema.voucherEntries.factorySupplierId,
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
        factorySupplierName: schema.factorySuppliers.name,
        customerName: schema.customers.legalName,
        customerId: schema.voucherEntries.customerId,
      })
      .from(schema.voucherEntries)
      .leftJoin(schema.ledgerAccounts, eq(schema.voucherEntries.ledgerAccountId, schema.ledgerAccounts.id))
      .leftJoin(schema.bankAccounts, eq(schema.voucherEntries.bankAccountId, schema.bankAccounts.id))
      .leftJoin(schema.fixedAssets, eq(schema.voucherEntries.fixedAssetId, schema.fixedAssets.id))
      .leftJoin(schema.suppliers, eq(schema.voucherEntries.supplierId, schema.suppliers.id))
      .leftJoin(schema.employees, eq(schema.voucherEntries.employeeId, schema.employees.id))
      .leftJoin(schema.factorySuppliers, eq(schema.voucherEntries.factorySupplierId, schema.factorySuppliers.id))
      .leftJoin(schema.customers, eq(schema.voucherEntries.customerId, schema.customers.id))
      .where(eq(schema.voucherEntries.voucherId, voucherId));

    return entries.map(entry => {
      const employeeName = entry.employeeFirstName && entry.employeeLastName 
        ? `${entry.employeeFirstName} ${entry.employeeLastName}` 
        : null;
      
      return {
        ...entry,
        accountName: entry.accountName || entry.bankAccountName || entry.fixedAssetName || entry.supplierName || entry.factorySupplierName || employeeName || entry.customerName || 'Unknown Account',
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
    if (isNaN(qty) || isNaN(rate)) throw new Error("Invalid quantity or rate value");
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
    if (isNaN(qty) || isNaN(rate)) throw new Error("Invalid quantity or rate value");
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
    await db.transaction(async (tx) => {
      // First, get the voucher to check its type and location
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.id, id));

      if (!voucher) {
        throw new Error("Voucher not found");
      }

      // STEP 1: Reverse inventory movements based on voucher type
      if (voucher.voucherType === "Sales" && voucher.locationId) {
        // Restore items back to location inventory using the centralized adjustInventory
        // helper. The previous inline math here did not settle negative layers and
        // computed averageRate differently from adjustInventory's costing rules,
        // which caused inventory desync when a Sales voucher was deleted on stock
        // that had gone negative.
        const salesItemsList = await tx
          .select()
          .from(schema.salesItems)
          .where(eq(schema.salesItems.voucherId, id));

        for (const saleItem of salesItemsList) {
          const quantity = parseFloat(saleItem.quantity);
          const costPrice = parseFloat(saleItem.costPrice);

          await adjustInventory(
            tx,
            voucher.locationId,
            saleItem.stockItemId,
            quantity,           // positive delta = restore
            voucher.companyId,
            costPrice,          // incoming rate = original cost of the sale line
            "Sales-Reversal",
            id,
          );
        }

        // Delete sales items
        await tx.delete(schema.salesItems).where(eq(schema.salesItems.voucherId, id));
      }

      if (voucher.voucherType === "Stock Transfer") {
        // Reverse the stock transfer using the centralized adjustInventory helper.
        // Previous inline math (Batch E follow-up): added back at source / subtracted
        // at destination using a hand-rolled weighted-average that did not settle
        // negative layers and silently no-op'd when destination inventory was missing.
        // Now: per-item adjustInventory(+qty, source) and adjustInventory(-qty, dest)
        // — same SELECT FOR UPDATE + negative-layer settlement path as every other
        // inventory mutation. Source-missing-location guard preserved.
        const [transferVoucher] = await tx
          .select()
          .from(schema.stockTransferVouchers)
          .where(eq(schema.stockTransferVouchers.voucherId, id));

        if (transferVoucher) {
          const transferItems = await tx
            .select()
            .from(schema.stockTransferItems)
            .where(eq(schema.stockTransferItems.transferId, transferVoucher.id));

          const sourceLocationId = transferVoucher.sourceLocationId;
          const destinationLocationId = transferVoucher.destinationLocationId;

          for (const item of transferItems) {
            const quantity = parseFloat(item.quantity);
            const rate = parseFloat(item.rate);

            if (!sourceLocationId) {
              throw new Error(`Cannot reverse stock transfer: source location ID is missing for transfer voucher ${id}`);
            }
            if (!destinationLocationId) {
              throw new Error(`Cannot reverse stock transfer: destination location ID is missing for transfer voucher ${id}`);
            }

            // Restore to source (positive delta — settles any negative layers there first)
            await adjustInventory(
              tx,
              sourceLocationId,
              item.stockItemId,
              quantity,
              voucher.companyId,
              rate,
              "StockTransfer-Reversal",
              id,
            );

            // Remove from destination (negative delta — creates negative layer if needed
            // so a subsequent re-receipt settles correctly; previous code silently
            // skipped this when destination row was missing, which left phantom inventory)
            await adjustInventory(
              tx,
              destinationLocationId,
              item.stockItemId,
              -quantity,
              voucher.companyId,
              rate,
              "StockTransfer-Reversal",
              id,
            );
          }

          // Delete transfer items and transfer voucher
          await tx.delete(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transferVoucher.id));
          await tx.delete(schema.stockTransferVouchers).where(eq(schema.stockTransferVouchers.id, transferVoucher.id));
        }
      }

      if (voucher.voucherType === "Production" || voucher.voucherType === "Consumption" || voucher.voucherType === "Mixed" || voucher.voucherType === "Stock Adjustment") {
        // Reverse stock adjustments using adjustInventory (Batch E follow-up).
        // Previous inline math used a hand-rolled weighted-average that
        // (a) skipped negative-layer settlement, and (b) silently no-op'd a
        // production-removal when no inventory row existed. Now: a single
        // adjustInventory call per item using the same reversed-direction
        // logic as before — Consumption-reversal restores (+qty), Production-
        // reversal removes (-qty), Mixed flips per-item by sign.
        const [adjustmentVoucher] = await tx
          .select()
          .from(schema.stockAdjustmentVouchers)
          .where(eq(schema.stockAdjustmentVouchers.voucherId, id));

        if (adjustmentVoucher) {
          const adjustmentItems = await tx
            .select()
            .from(schema.stockAdjustmentItems)
            .where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));

          const adjustmentType = adjustmentVoucher.adjustmentType;

          for (const item of adjustmentItems) {
            const rawQuantity = parseFloat(item.quantity);
            const quantity = Math.abs(rawQuantity);
            const rate = parseFloat(item.rate);

            // Direction logic preserved from previous implementation:
            //   Consumption: we subtracted → ADD back (+qty)
            //   Production:  we added     → SUBTRACT back (-qty)
            //   Mixed: per-item sign — positive was production (subtract back),
            //          negative was consumption (add back)
            //   Stock Adjustment: signed quantity, reverse the sign
            const isConsumption = adjustmentType === "Consumption" ||
              (adjustmentType === "Mixed" && rawQuantity < 0);
            const reversedQuantity = isConsumption ? quantity : -quantity;

            await adjustInventory(
              tx,
              adjustmentVoucher.locationId,
              item.stockItemId,
              reversedQuantity,
              voucher.companyId,
              rate,
              `${adjustmentType}-Reversal`,
              id,
            );
          }

          // Delete adjustment items and adjustment voucher
          await tx.delete(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, adjustmentVoucher.id));
          await tx.delete(schema.stockAdjustmentVouchers).where(eq(schema.stockAdjustmentVouchers.id, adjustmentVoucher.id));
        }
      }

      // STEP 2: Handle Purchase Orders (existing logic)
      const linkedPOs = await tx
        .select()
        .from(schema.purchaseOrders)
        .where(eq(schema.purchaseOrders.voucherId, id));

      if (linkedPOs.length > 0) {
        const containerUpdates = new Map<number, { itemsTotal: number; containerNumber: string }>();
        
        for (const po of linkedPOs) {
          const itemsTotal = parseFloat(po.itemsTotal || "0");
          const container = await tx.select().from(schema.containers).where(eq(schema.containers.id, po.containerId)).limit(1);
          const containerNumber = container.length > 0 ? container[0].containerNumber : "";
          const existing = containerUpdates.get(po.containerId) || { itemsTotal: 0, containerNumber };
          containerUpdates.set(po.containerId, {
            itemsTotal: existing.itemsTotal + itemsTotal,
            containerNumber,
          });

          await tx.delete(schema.poLineItems).where(eq(schema.poLineItems.poId, po.id));
        }

        await tx.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.voucherId, id));

        for (const [containerId, totals] of Array.from(containerUpdates.entries())) {
          const [container] = await tx
            .select()
            .from(schema.containers)
            .where(eq(schema.containers.id, containerId))
            .limit(1);

          if (container) {
            // Delete all charge vouchers associated with this container whenever ANY PO is deleted
            const chargeVouchers = await tx
              .select({ id: schema.vouchers.id })
              .from(schema.vouchers)
              .where(sql`${schema.vouchers.voucherNumber} LIKE ${'CHARGE-' + container.containerNumber + '-%'}`);
            
            for (const chargeVoucher of chargeVouchers) {
              await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, chargeVoucher.id));
              await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, chargeVoucher.id));
            }

            const newItemsTotal = Math.max(0, parseFloat(container.itemsTotal || "0") - totals.itemsTotal);
            const newChargesTotal = 0; // Reset to 0 since we deleted charge vouchers
            const newGrandTotal = newItemsTotal + newChargesTotal;

            const remainingPOs = await tx
              .select()
              .from(schema.purchaseOrders)
              .where(eq(schema.purchaseOrders.containerId, containerId))
              .limit(1);

            if (remainingPOs.length === 0) {
              await tx.delete(schema.containerCharges).where(eq(schema.containerCharges.containerId, containerId));
              await tx.delete(schema.containers).where(eq(schema.containers.id, containerId));
            } else {
              await tx
                .update(schema.containers)
                .set({
                  itemsTotal: newItemsTotal.toString(),
                  chargesTotal: newChargesTotal.toString(),
                  grandTotal: newGrandTotal.toString(),
                })
                .where(eq(schema.containers.id, containerId));
            }
          }
        }
      }

      // STEP 3: Delete voucher entries (this automatically restores account balances)
      await tx.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, id));

      // STEP 3.5: Cascade — remove factory daybook entries linked to this voucher
      await tx.execute(sql`DELETE FROM factory_daybook_entries WHERE reference_table = 'vouchers' AND reference_id = ${id}`);

      // STEP 4: Delete the voucher itself
      await tx.delete(schema.vouchers).where(eq(schema.vouchers.id, id));
    });
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

  // Exchange Rates
  async getExchangeRates(companyId: number): Promise<schema.ExchangeRate[]> {
    return await db
      .select()
      .from(schema.exchangeRates)
      .where(eq(schema.exchangeRates.companyId, companyId))
      .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`);
  }

  async getLatestExchangeRate(companyId: number, fromCurrency: string, toCurrency: string): Promise<schema.ExchangeRate | undefined> {
    const results = await db
      .select()
      .from(schema.exchangeRates)
      .where(and(
        eq(schema.exchangeRates.companyId, companyId),
        eq(schema.exchangeRates.fromCurrency, fromCurrency),
        eq(schema.exchangeRates.toCurrency, toCurrency)
      ))
      .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`)
      .limit(1);
    return results[0];
  }

  async getExchangeRateForDate(companyId: number, fromCurrency: string, toCurrency: string, date: string): Promise<schema.ExchangeRate | undefined> {
    const results = await db
      .select()
      .from(schema.exchangeRates)
      .where(and(
        eq(schema.exchangeRates.companyId, companyId),
        eq(schema.exchangeRates.fromCurrency, fromCurrency),
        eq(schema.exchangeRates.toCurrency, toCurrency),
        sql`${schema.exchangeRates.effectiveDate} <= ${date}`
      ))
      .orderBy(sql`${schema.exchangeRates.effectiveDate} DESC`)
      .limit(1);
    return results[0];
  }

  async createExchangeRate(rate: schema.InsertExchangeRate): Promise<schema.ExchangeRate> {
    const [result] = await db
      .insert(schema.exchangeRates)
      .values(rate)
      .returning();
    return result;
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

      if (!items || items.length === 0) {
        throw new Error("No items provided for stock transfer");
      }

      // Create the stock transfer voucher record (note: no global sourceLocationId)
      const [transfer] = await tx.insert(schema.stockTransferVouchers).values({
        voucherId,
        sourceLocationId: items[0].sourceLocationId, // Store first item's source for legacy compatibility
        destinationLocationId,
        notes,
        inventoryApplied: !isOptional,
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
          // Get current inventory at THIS ITEM's source location (with row lock)
          const sourceInventoryRows = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${item.sourceLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
          );
          const sourceInventory = sourceInventoryRows.rows?.[0] || sourceInventoryRows[0];

          if (sourceInventory) {
            // Decrease quantity at this item's source location
            const currentQty = parseFloat(sourceInventory.quantity);
            const currentValue = parseFloat(sourceInventory.total_value);
            const currentRate = parseFloat(sourceInventory.average_rate);
            
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

          // Get current inventory at destination location (with row lock)
          const destInventoryRows = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
          );
          const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];

          if (destInventory) {
            // Increase quantity at destination location using weighted average
            // Use existingQty * existingRate (not totalValue) to avoid data corruption issues
            const currentQty = parseFloat(destInventory.quantity);
            const currentRate = parseFloat(destInventory.average_rate || "0");
            
            const newQty = currentQty + quantity;
            // Weighted average: (existing value + new value) / total quantity
            const newRate = newQty > 0 
              ? ((currentQty * currentRate) + (quantity * rate)) / newQty 
              : 0;
            const newValue = newQty * newRate;
            
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
    adjustmentType: "Production" | "Consumption" | "Mixed",
    notes: string,
    items: Array<{stockItemId: number, quantity: string, rate: string}>,
    consumptionAccountOverride?: { code: string; name: string }
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

      // Helper to find or create stock adjustment ledger accounts
      const findOrCreateAdjustmentAccount = async (
        code: string, 
        name: string, 
        accountType: string, 
        openingBalanceSide: "Dr" | "Cr"
      ): Promise<number> => {
        let [account] = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, code),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);

        if (!account) {
          [account] = await tx.insert(schema.ledgerAccounts).values({
            companyId: location.companyId,
            code,
            name,
            accountType,
            subType: accountType,
            openingBalance: "0",
            openingBalanceSide,
          }).returning();
        }
        return account.id;
      };

      // Get or create a SINGLE unified adjustment account (only if not optional).
      // Production entries credit it; Consumption entries debit it.
      // Net balance = net consumption expense. One account per company.
      let productionAccountId: number | null = null;
      let consumptionAccountId: number | null = null;

      if (!isOptional) {
        const adjustmentAccountId = await findOrCreateAdjustmentAccount(
          "STOCK_ADJUSTMENT",
          "Stock Adjustment (Production/Consumption)",
          "Indirect Expense",
          "Dr"
        );
        productionAccountId = adjustmentAccountId;
        consumptionAccountId = adjustmentAccountId;
      }

      // Track totals for voucher entries - use ACTUAL inventory value changes
      let totalProductionValue = 0;
      let totalConsumptionValue = 0;

      // Process each item
      const adjustmentItems: StockAdjustmentItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);

        // Determine if this is a production or consumption item
        const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && quantity > 0);

        // For consumption items, we need to get the current inventory rate FIRST
        // to store the actual value that will be removed from inventory
        let actualRate = rate;
        let actualTotalAmount = Math.abs(quantity) * rate;

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at location (with row lock)
          const currentInventoryRows = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
          );
          const currentInventory = currentInventoryRows.rows?.[0] || currentInventoryRows[0];

          if (currentInventory) {
            // Adjust quantity at location
            const currentQty = parseFloat(currentInventory.quantity);
            const currentValue = parseFloat(currentInventory.total_value);
            const currentRate = parseFloat(currentInventory.average_rate);
            
            let newQty: number;
            let newValue: number;
            let newRate: number;
            let actualValueChange: number;

            if (isProduction) {
              // Positive adjustment - add to inventory
              // Use weighted average: (existing qty * existing rate + new qty * new rate) / total qty
              newQty = currentQty + Math.abs(quantity);
              newRate = newQty > 0 
                ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty 
                : 0;
              newValue = newQty * newRate;
              // Track actual value added (using input rate for production)
              actualValueChange = Math.abs(quantity) * rate;
              totalProductionValue += actualValueChange;
            } else {
              // Consumption - subtract from inventory (use absolute value to ensure reduction)
              newQty = currentQty - Math.abs(quantity);
              newValue = newQty > 0 ? newQty * currentRate : 0;
              newRate = currentRate;
              // Track actual value removed (using current average rate, not input rate)
              // CRITICAL: Update actualRate and actualTotalAmount to match what's actually being consumed
              actualRate = currentRate;
              actualTotalAmount = Math.abs(quantity) * currentRate;
              actualValueChange = actualTotalAmount;
              totalConsumptionValue += actualValueChange;
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
          } else if (isProduction) {
            // Create new inventory record for production (positive quantities)
            await tx.insert(schema.inventory).values({
              companyId: location.companyId,
              locationId,
              stockItemId: item.stockItemId,
              quantity: Math.abs(quantity).toFixed(3),
              averageRate: item.rate,
              totalValue: actualTotalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
            // Track value for new inventory
            totalProductionValue += actualTotalAmount;
          } else {
            // Consumption without existing inventory - use stock item's costPrice as fallback
            // This allows consumption even when no inventory exists at this location
            const [stockItem] = await tx
              .select()
              .from(schema.stockItems)
              .where(eq(schema.stockItems.id, item.stockItemId));
            
            if (!stockItem) {
              throw new Error(`Stock item ${item.stockItemId} not found.`);
            }
            
            // Use openingRate as the rate for consumption when no inventory exists
            const fallbackRate = parseFloat(stockItem.openingRate || "0");
            if (fallbackRate <= 0) {
              throw new Error(`Stock item "${stockItem.name}" has no opening rate set. Please set an opening rate before consuming items without existing inventory.`);
            }
            
            actualRate = fallbackRate;
            actualTotalAmount = Math.abs(quantity) * fallbackRate;
            totalConsumptionValue += actualTotalAmount;
            
            // Create negative inventory record to track the consumption
            await tx.insert(schema.inventory).values({
              companyId: location.companyId,
              locationId,
              stockItemId: item.stockItemId,
              quantity: (-Math.abs(quantity)).toFixed(3),
              averageRate: fallbackRate.toFixed(2),
              totalValue: (-actualTotalAmount).toFixed(2),
              lastUpdated: new Date(),
            });
          }
        }

        // Insert adjustment item with the ACTUAL rate and total used
        // For consumption: uses current inventory average rate
        // For production: uses user-input rate
        const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
          adjustmentId: adjustment.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: actualRate.toFixed(2),
          totalAmount: actualTotalAmount.toFixed(2),
        }).returning();

        adjustmentItems.push(adjustmentItem);
      }

      // Create balancing voucher entries (only if not optional and there are amounts to record)
      if (!isOptional) {
        // Production: Credit the PRODUCTION_ADJUSTMENT account to offset inventory increase
        // This keeps import cycle balanced: DR Inventory (implicit) = CR Production Adjustment
        if (totalProductionValue > 0 && productionAccountId) {
          await tx.insert(schema.voucherEntries).values({
            voucherId,
            ledgerAccountId: productionAccountId,
            debitAmount: "0",
            creditAmount: totalProductionValue.toFixed(2),
            narration: `Production adjustment - ${adjustmentType} voucher`,
          });
        }
        
        // Consumption: Debit the CONSUMPTION_EXPENSE account to record expense
        // This keeps import cycle balanced: DR Consumption Expense = CR Inventory (implicit)
        if (totalConsumptionValue > 0 && consumptionAccountId) {
          await tx.insert(schema.voucherEntries).values({
            voucherId,
            ledgerAccountId: consumptionAccountId,
            debitAmount: totalConsumptionValue.toFixed(2),
            creditAmount: "0",
            narration: `Consumption expense - ${adjustmentType} voucher`,
          });
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

      // Step 2: REVERSE inventory changes for each OLD item (only if inventory was actually applied).
      // Use same guard as the delete route: reverse if explicitly applied OR if voucher is non-optional
      // (legacy transfers have inventoryApplied=false by default even though they were applied).
      if (existingTransfer.inventoryApplied || !isOptional) {
        for (const oldItem of existingItems) {
        const quantity = parseFloat(oldItem.quantity);
        const rate = parseFloat(oldItem.rate);
        const totalAmount = quantity * rate;

        console.log('[storage.updateStockTransfer] Reversing item:', oldItem.stockItemId, 'qty:', quantity);

        // REVERSE: Add back to source location (we previously subtracted)
        // Use the item's sourceLocationId if available, otherwise fall back to transfer's sourceLocationId
        const sourceLocationId = oldItem.sourceLocationId || existingTransfer.sourceLocationId;

        const sourceInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${sourceLocationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const sourceInventory = sourceInventoryRows.rows?.[0] || sourceInventoryRows[0];

        if (sourceInventory) {
          // Add back to source (reverse the subtraction)
          // Use weighted average: (existing qty * existing rate + returning qty * returning rate) / total qty
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentRate = parseFloat(sourceInventory.average_rate || "0");
          
          const newQty = currentQty + quantity;
          const newRate = newQty > 0 
            ? ((currentQty * currentRate) + (quantity * rate)) / newQty 
            : 0;
          const newValue = newQty * newRate;

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
          const srcLocId = sourceLocationId || 0;
          const [sourceLocation] = await tx
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, srcLocId));
          
          if (sourceLocation) {
            await tx.insert(schema.inventory).values({
              companyId: sourceLocation.companyId,
              locationId: srcLocId,
              stockItemId: oldItem.stockItemId,
              quantity: quantity.toFixed(3),
              averageRate: rate.toFixed(2),
              totalValue: totalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
          }
        }

        // REVERSE: Subtract from destination location (we previously added)
        const destInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${existingTransfer.destinationLocationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];

        if (destInventory) {
          // Subtract from destination (reverse the addition)
          const currentQty = parseFloat(destInventory.quantity);
          const currentValue = parseFloat(destInventory.total_value);
          const currentRate = parseFloat(destInventory.average_rate);
          
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

      if (!items || items.length === 0) {
        throw new Error("No items provided for stock transfer update");
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
          inventoryApplied: !isOptional,
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
          // Get current inventory at THIS ITEM's source location (with row lock)
          const sourceInventoryRows2 = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${item.sourceLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
          );
          const sourceInventory = sourceInventoryRows2.rows?.[0] || sourceInventoryRows2[0];

        if (sourceInventory) {
          // Decrease quantity at this item's source location
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentValue = parseFloat(sourceInventory.total_value);
          const currentRate = parseFloat(sourceInventory.average_rate);
          
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

        // Get current inventory at destination location (with row lock)
        const destInventoryRows2 = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows2.rows?.[0] || destInventoryRows2[0];

        if (destInventory) {
          // Increase quantity at destination location using weighted average
          // Use existingQty * existingRate (not totalValue) to avoid data corruption issues
          const currentQty = parseFloat(destInventory.quantity);
          const currentRate = parseFloat(destInventory.average_rate || "0");
          
          const newQty = currentQty + quantity;
          // Weighted average: (existing value + new value) / total quantity
          const newRate = newQty > 0 
            ? ((currentQty * currentRate) + (quantity * rate)) / newQty 
            : 0;
          const newValue = newQty * newRate;
          
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

        // Get current inventory at location (with row lock)
        const currentInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${existingAdjustment.locationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const currentInventory = currentInventoryRows.rows?.[0] || currentInventoryRows[0];

        if (currentInventory) {
          const currentQty = parseFloat(currentInventory.quantity);
          const currentRate = parseFloat(currentInventory.average_rate || "0");
          
          let newQty: number;
          let newValue: number;
          let newRate: number;

          // For Mixed adjustments, check individual item quantity sign
          const wasProduction = oldAdjustmentType === "Production" || (oldAdjustmentType === "Mixed" && quantity > 0);

          if (wasProduction) {
            // REVERSE Production: Subtract the quantity that was added
            newQty = currentQty - Math.abs(quantity);
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
          } else {
            // REVERSE Consumption: Add back the quantity that was subtracted
            // Use weighted average: (existing qty * existing rate + returning qty * returning rate) / total qty
            newQty = currentQty + Math.abs(quantity);
            newRate = newQty > 0 
              ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty 
              : 0;
            newValue = newQty * newRate;
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
        } else if (oldAdjustmentType === "Consumption" || (oldAdjustmentType === "Mixed" && quantity < 0)) {
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

      // Step 3b: Delete old voucher entries for production/consumption accounts (only if not optional)
      if (!isOptional) {
        // Find the production and consumption account IDs
        const productionAccount = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, "PRODUCTION_ADJUSTMENT"),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        const consumptionAccount = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, location.companyId),
              eq(schema.ledgerAccounts.code, "CONSUMPTION_EXPENSE"),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        // Delete old entries for these accounts on this voucher
        const accountIdsToDelete: number[] = [];
        if (productionAccount.length > 0) accountIdsToDelete.push(productionAccount[0].id);
        if (consumptionAccount.length > 0) accountIdsToDelete.push(consumptionAccount[0].id);
        
        if (accountIdsToDelete.length > 0) {
          await tx
            .delete(schema.voucherEntries)
            .where(
              and(
                eq(schema.voucherEntries.voucherId, existingAdjustment.voucherId),
                inArray(schema.voucherEntries.ledgerAccountId, accountIdsToDelete)
              )
            );
          console.log('[storage.updateStockAdjustment] Deleted old voucher entries for production/consumption accounts');
        }
      }

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

      // Helper to find or create stock adjustment ledger accounts
      const findOrCreateAdjustmentAccount = async (
        code: string, 
        name: string, 
        accountType: string, 
        openingBalanceSide: "Dr" | "Cr"
      ): Promise<number> => {
        let [account] = await tx
          .select()
          .from(schema.ledgerAccounts)
          .where(
            and(
              eq(schema.ledgerAccounts.companyId, newLocation.companyId),
              eq(schema.ledgerAccounts.code, code),
              isNull(schema.ledgerAccounts.deletedAt)
            )
          )
          .limit(1);

        if (!account) {
          [account] = await tx.insert(schema.ledgerAccounts).values({
            companyId: newLocation.companyId,
            code,
            name,
            accountType,
            subType: accountType,
            openingBalance: "0",
            openingBalanceSide,
          }).returning();
        }
        return account.id;
      };

      // Get or create a SINGLE unified adjustment account (only if not optional).
      // Production entries credit it; Consumption entries debit it.
      let productionAccountId: number | null = null;
      let consumptionAccountId: number | null = null;

      if (!isOptional) {
        const adjustmentAccountId = await findOrCreateAdjustmentAccount(
          "STOCK_ADJUSTMENT",
          "Stock Adjustment (Production/Consumption)",
          "Indirect Expense",
          "Dr"
        );
        productionAccountId = adjustmentAccountId;
        consumptionAccountId = adjustmentAccountId;
      }

      // Track totals for voucher entries - use ACTUAL inventory value changes
      let totalProductionValue = 0;
      let totalConsumptionValue = 0;

      // Step 5: Create NEW items and apply inventory changes (same logic as createStockAdjustment)
      const adjustmentItems: StockAdjustmentItem[] = [];
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);

        console.log('[storage.updateStockAdjustment] Creating new item:', item.stockItemId, 'qty:', quantity);

        // Determine if this is a production or consumption item
        const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && quantity > 0);

        // For consumption items, we need to get the current inventory rate FIRST
        // to store the actual value that will be removed from inventory
        let actualRate = rate;
        let actualTotalAmount = Math.abs(quantity) * rate;

        // Only update inventory if voucher is NOT optional
        if (!isOptional) {
          // Get current inventory at location (with row lock)
          const currentInventoryRows2 = await (tx as any).execute(
            sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
          );
          const currentInventory = currentInventoryRows2.rows?.[0] || currentInventoryRows2[0];

          if (currentInventory) {
            // Adjust quantity at location
            const currentQty = parseFloat(currentInventory.quantity);
            const currentRate = parseFloat(currentInventory.average_rate || "0");
            
            let newQty: number;
            let newValue: number;
            let newRate: number;
            let actualValueChange: number;

            if (isProduction) {
              // Positive adjustment - add to inventory
              // Use weighted average: (existing qty * existing rate + new qty * new rate) / total qty
              newQty = currentQty + Math.abs(quantity);
              newRate = newQty > 0 
                ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty 
                : 0;
              newValue = newQty * newRate;
              // Track actual value added (using input rate for production)
              actualValueChange = Math.abs(quantity) * rate;
              totalProductionValue += actualValueChange;
            } else {
              // Consumption - subtract from inventory (use absolute value to ensure reduction)
              newQty = currentQty - Math.abs(quantity);
              newValue = newQty > 0 ? newQty * currentRate : 0;
              newRate = currentRate;
              // Track actual value removed (using current average rate, not input rate)
              // CRITICAL: Update actualRate and actualTotalAmount to match what's actually being consumed
              actualRate = currentRate;
              actualTotalAmount = Math.abs(quantity) * currentRate;
              actualValueChange = actualTotalAmount;
              totalConsumptionValue += actualValueChange;
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
          } else if (isProduction) {
            // Create new inventory record for production (positive quantities)
            await tx.insert(schema.inventory).values({
              companyId: newLocation.companyId,
              locationId,
              stockItemId: item.stockItemId,
              quantity: Math.abs(quantity).toFixed(3),
              averageRate: item.rate,
              totalValue: actualTotalAmount.toFixed(2),
              lastUpdated: new Date(),
            });
            // Track value for new inventory
            totalProductionValue += actualTotalAmount;
          } else {
            // Consumption requires existing inventory - cannot consume what doesn't exist
            // This guard ensures we never store user-input rates for consumption items
            throw new Error(`Insufficient inventory at location ${locationId} for stock item ${item.stockItemId}. Cannot consume items that don't exist in inventory.`);
          }
        }

        // Insert adjustment item with the ACTUAL rate and total used
        // For consumption: uses current inventory average rate
        // For production: uses user-input rate
        const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
          adjustmentId: updatedAdjustment.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: actualRate.toFixed(2),
          totalAmount: actualTotalAmount.toFixed(2),
        }).returning();

        adjustmentItems.push(adjustmentItem);
      }

      // Create balancing voucher entries (only if not optional and there are amounts to record)
      if (!isOptional) {
        if (totalProductionValue > 0 && productionAccountId) {
          await tx.insert(schema.voucherEntries).values({
            voucherId: existingAdjustment.voucherId,
            ledgerAccountId: productionAccountId,
            debitAmount: "0",
            creditAmount: totalProductionValue.toFixed(2),
            narration: `Production adjustment - ${adjustmentType} voucher`,
          });
        }
        
        if (totalConsumptionValue > 0 && consumptionAccountId) {
          await tx.insert(schema.voucherEntries).values({
            voucherId: existingAdjustment.voucherId,
            ledgerAccountId: consumptionAccountId,
            debitAmount: totalConsumptionValue.toFixed(2),
            creditAmount: "0",
            narration: `Consumption expense - ${adjustmentType} voucher`,
          });
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

  async getLastSoldPrices(companyId: number): Promise<Record<number, string>> {
    // Get the latest selling price for each stock item from sales_items
    // Uses a subquery to get the most recent sale for each stock item
    const result = await db.execute(sql`
      WITH latest_sales AS (
        SELECT DISTINCT ON (si.stock_item_id)
          si.stock_item_id,
          si.selling_price
        FROM sales_items si
        INNER JOIN vouchers v ON si.voucher_id = v.id
        WHERE v.company_id = ${companyId}
        ORDER BY si.stock_item_id, v.voucher_date DESC, si.created_at DESC
      )
      SELECT stock_item_id, selling_price FROM latest_sales
    `);

    const priceMap: Record<number, string> = {};
    for (const row of result.rows as any[]) {
      priceMap[row.stock_item_id] = row.selling_price;
    }
    return priceMap;
  }

  async getAllPurchasesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]> {
    const conditions = [
      eq(schema.poLineItems.stockItemId, stockItemId),
      eq(schema.purchaseOrders.companyId, companyId),
      or(
        isNull(schema.purchaseOrders.containerId),
        sql`${schema.containers.status} NOT IN ('OFFLOADED', 'SOLD')`
      ),
    ];
    if (fromDate) conditions.push(sql`${schema.purchaseOrders.createdAt}::date >= ${fromDate}::date`);
    if (toDate) conditions.push(sql`${schema.purchaseOrders.createdAt}::date <= ${toDate}::date`);

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
      .where(and(...conditions))
      .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`);

    return results;
  }

  async getAllSalesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]> {
    const conditions = [
      eq(schema.salesItems.stockItemId, stockItemId),
      eq(schema.vouchers.companyId, companyId),
      eq(schema.vouchers.optional, false),
    ];
    if (fromDate) conditions.push(sql`${schema.vouchers.voucherDate}::date >= ${fromDate}::date`);
    if (toDate) conditions.push(sql`${schema.vouchers.voucherDate}::date <= ${toDate}::date`);

    const results = await db
      .select({
        voucherId: schema.vouchers.id,
        voucherNumber: schema.vouchers.voucherNumber,
        saleDate: schema.vouchers.voucherDate,
        locationName: schema.locations.name,
        quantity: schema.salesItems.quantity,
        sellingPrice: schema.salesItems.sellingPrice,
        totalSales: schema.salesItems.totalSales,
        posStation: schema.vouchers.shiftId,
      })
      .from(schema.salesItems)
      .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
      .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
      .where(and(...conditions))
      .orderBy(sql`${schema.vouchers.voucherDate} DESC`);

    return results;
  }

  async getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]> {
    // Use raw SQL with DISTINCT ON to get the most recent inventory record per location
    // This ensures we get the freshest data if duplicates exist
    const results = await db.execute(sql`
      SELECT DISTINCT ON (i.location_id)
        i.location_id as "locationId",
        l.name as "locationName",
        l.code as "locationCode",
        i.quantity,
        i.average_rate as "averageRate",
        i.total_value as "totalValue"
      FROM inventory i
      INNER JOIN locations l ON i.location_id = l.id
      WHERE i.stock_item_id = ${stockItemId}
        AND l.company_id = ${companyId}
        AND i.quantity::numeric > 0
      ORDER BY i.location_id, i.last_updated DESC
    `);

    // Sort by location name for display
    const sorted = (results.rows as any[]).sort((a, b) => 
      (a.locationName || '').localeCompare(b.locationName || '')
    );

    return sorted;
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
      .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
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
      .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
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
      .innerJoin(schema.stockAdjustmentVouchers, eq(schema.stockAdjustmentItems.adjustmentId, schema.stockAdjustmentVouchers.id))
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
  async getAllCustomers(companyId: number, search?: string, limit?: number): Promise<schema.Customer[]> {
    const conditions: any[] = [
      eq(schema.customers.companyId, companyId),
      isNull(schema.customers.deletedAt),
    ];
    if (search) {
      conditions.push(ilike(schema.customers.legalName, `%${search}%`));
    }
    let query = db.select().from(schema.customers)
      .where(and(...conditions))
      .orderBy(schema.customers.legalName) as any;
    if (limit) {
      query = query.limit(limit);
    }
    return await query;
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

  async deleteCustomer(id: number): Promise<void> {
    await db.update(schema.customers)
      .set({ deletedAt: new Date(), active: false })
      .where(eq(schema.customers.id, id));
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

  async getEmployeeBaleRates(employeeId: number, companyId: number): Promise<schema.EmployeeBaleRate[]> {
    return await db.select().from(schema.employeeBaleRates)
      .where(and(
        eq(schema.employeeBaleRates.employeeId, employeeId),
        eq(schema.employeeBaleRates.companyId, companyId)
      ));
  }

  async setEmployeeBaleRates(employeeId: number, companyId: number, rates: { locationId: number; rate: string; sourceCompanyId?: number | null }[]): Promise<void> {
    await db.delete(schema.employeeBaleRates).where(and(
      eq(schema.employeeBaleRates.employeeId, employeeId),
      eq(schema.employeeBaleRates.companyId, companyId)
    ));
    if (rates.length > 0) {
      await db.insert(schema.employeeBaleRates).values(
        rates.map(r => ({ companyId, employeeId, locationId: r.locationId, rate: r.rate, sourceCompanyId: r.sourceCompanyId ?? null }))
      );
    }
  }

  async getEmployeeBalePctRates(employeeId: number, companyId: number): Promise<schema.EmployeeBalePctRate[]> {
    return await db.select().from(schema.employeeBalePctRates)
      .where(and(
        eq(schema.employeeBalePctRates.employeeId, employeeId),
        eq(schema.employeeBalePctRates.companyId, companyId)
      ));
  }

  async setEmployeeBalePctRates(employeeId: number, companyId: number, rates: { locationId: number; pct: string; sourceCompanyId?: number | null }[]): Promise<void> {
    await db.delete(schema.employeeBalePctRates).where(and(
      eq(schema.employeeBalePctRates.employeeId, employeeId),
      eq(schema.employeeBalePctRates.companyId, companyId)
    ));
    if (rates.length > 0) {
      await db.insert(schema.employeeBalePctRates).values(
        rates.map(r => ({ companyId, employeeId, locationId: r.locationId, pct: r.pct, sourceCompanyId: r.sourceCompanyId ?? null }))
      );
    }
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

  async deleteSalaryAdvance(id: number): Promise<void> {
    await db.delete(schema.salaryAdvanceDeductions).where(eq(schema.salaryAdvanceDeductions.salaryAdvanceId, id));
    await db.delete(schema.salaryAdvances).where(eq(schema.salaryAdvances.id, id));
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
      .where(
        eq(schema.bales.companyId, companyId)
      )
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
      .set({ ...updates })
      .where(eq(schema.bales.id, id))
      .returning();
    return updated;
  }

  async deleteBale(id: number): Promise<void> {
    await db
      .delete(schema.bales)
      .where(eq(schema.bales.id, id));
  }

  async bulkCreateBales(bales: schema.InsertBale[]): Promise<schema.Bale[]> {
    if (bales.length === 0) return [];
    return await db
      .insert(schema.bales)
      .values(bales)
      .returning();
  }

  // Bale Products

  async getAllPendingBarcodes(companyId: number): Promise<schema.PendingBarcode[]> {
    return await db
      .select()
      .from(schema.pendingBarcodes)
      .where(eq(schema.pendingBarcodes.companyId, companyId))
      .orderBy(desc(schema.pendingBarcodes.createdAt));
  }

  async getPendingBarcodeByCode(barcode: string, companyId: number): Promise<schema.PendingBarcode | undefined> {
    const results = await db
      .select()
      .from(schema.pendingBarcodes)
      .where(
        and(
          eq(schema.pendingBarcodes.barcode, barcode),
          eq(schema.pendingBarcodes.companyId, companyId)
        )
      );
    return results[0];
  }

  async createPendingBarcode(data: schema.InsertPendingBarcode): Promise<schema.PendingBarcode> {
    const [result] = await db.insert(schema.pendingBarcodes).values(data).returning();
    return result;
  }

  async updatePendingBarcode(id: number, updates: Partial<schema.InsertPendingBarcode>): Promise<schema.PendingBarcode> {
    const [result] = await db
      .update(schema.pendingBarcodes)
      .set(updates)
      .where(eq(schema.pendingBarcodes.id, id))
      .returning();
    return result;
  }

  async deletePendingBarcode(id: number): Promise<void> {
    await db.delete(schema.pendingBarcodes).where(eq(schema.pendingBarcodes.id, id));
  }

  async bulkCreatePendingBarcodes(barcodes: schema.InsertPendingBarcode[]): Promise<schema.PendingBarcode[]> {
    if (barcodes.length === 0) return [];
    return await db.insert(schema.pendingBarcodes).values(barcodes).returning();
  }

  async markBarcodesAsPrinted(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(schema.pendingBarcodes)
      .set({ printed: true })
      .where(inArray(schema.pendingBarcodes.id, ids));
  }
  async getAllBaleProductCategories(companyId: number): Promise<schema.BaleProductCategory[]> {
    return await db
      .select()
      .from(schema.baleProductCategories)
      .where(eq(schema.baleProductCategories.companyId, companyId))
      .orderBy(schema.baleProductCategories.name);
  }

  async getBaleProductCategoryById(id: number): Promise<schema.BaleProductCategory | undefined> {
    const [cat] = await db
      .select()
      .from(schema.baleProductCategories)
      .where(eq(schema.baleProductCategories.id, id));
    return cat;
  }

  async getBaleProductCategoryByName(name: string, companyId: number): Promise<schema.BaleProductCategory | undefined> {
    const [cat] = await db
      .select()
      .from(schema.baleProductCategories)
      .where(
        and(
          eq(schema.baleProductCategories.name, name),
          eq(schema.baleProductCategories.companyId, companyId)
        )
      );
    return cat;
  }

  async createBaleProductCategory(category: schema.InsertBaleProductCategory): Promise<schema.BaleProductCategory> {
    const [created] = await db
      .insert(schema.baleProductCategories)
      .values(category)
      .returning();
    return created;
  }

  async updateBaleProductCategory(id: number, updates: Partial<schema.InsertBaleProductCategory>): Promise<schema.BaleProductCategory> {
    const [updated] = await db
      .update(schema.baleProductCategories)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(schema.baleProductCategories.id, id))
      .returning();
    return updated;
  }

  async deleteBaleProductCategory(id: number): Promise<void> {
    await db
      .delete(schema.baleProductCategories)
      .where(eq(schema.baleProductCategories.id, id));
  }

  async getAllBaleProducts(companyId: number): Promise<schema.BaleProduct[]> {
    return await db
      .select()
      .from(schema.baleProducts)
      .where(eq(schema.baleProducts.companyId, companyId))
      .orderBy(schema.baleProducts.code);
  }

  async getBaleProductById(id: number): Promise<schema.BaleProduct | undefined> {
    const [product] = await db
      .select()
      .from(schema.baleProducts)
      .where(eq(schema.baleProducts.id, id));
    return product;
  }

  async getBaleProductByCode(code: string, companyId: number): Promise<schema.BaleProduct | undefined> {
    const [product] = await db
      .select()
      .from(schema.baleProducts)
      .where(
        and(
          eq(schema.baleProducts.code, code),
          eq(schema.baleProducts.companyId, companyId)
        )
      );
    return product;
  }

  async createBaleProduct(product: schema.InsertBaleProduct): Promise<schema.BaleProduct> {
    const valuesWithCode = {
      ...product,
      code: product.code || product.articleCode || `AUTO-${Date.now()}`,
    };
    const [created] = await db
      .insert(schema.baleProducts)
      .values(valuesWithCode)
      .returning();
    return created;
  }

  async updateBaleProduct(id: number, updates: Partial<schema.InsertBaleProduct>): Promise<schema.BaleProduct> {
    const [updated] = await db
      .update(schema.baleProducts)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(schema.baleProducts.id, id))
      .returning();
    return updated;
  }

  async deleteBaleProduct(id: number): Promise<void> {
    await db
      .delete(schema.baleProducts)
      .where(eq(schema.baleProducts.id, id));
  }

  async bulkCreateBaleProducts(products: schema.InsertBaleProduct[]): Promise<schema.BaleProduct[]> {
    if (products.length === 0) return [];
    
    const companyIds = new Set(products.map(p => p.companyId));
    if (companyIds.size > 1) {
      throw new Error("All products must belong to the same company");
    }
    
    const withCodes = products.map(p => ({
      ...p,
      code: p.code || p.articleCode || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }));
    
    const codes = withCodes.map(p => p.code);
    const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate product codes in import: ${duplicates.join(", ")}`);
    }
    
    return await db
      .insert(schema.baleProducts)
      .values(withCodes)
      .returning();
  }

  // Bale Label Prints
  async createBaleLabelPrint(data: schema.InsertBaleLabelPrint): Promise<schema.BaleLabelPrint> {
    const [created] = await db
      .insert(schema.baleLabelPrints)
      .values(data)
      .returning();
    return created;
  }

  async getBaleLabelPrintByReference(referenceNumber: string, companyId: number): Promise<schema.BaleLabelPrint | undefined> {
    const [record] = await db
      .select()
      .from(schema.baleLabelPrints)
      .where(
        and(
          eq(schema.baleLabelPrints.referenceNumber, referenceNumber),
          eq(schema.baleLabelPrints.companyId, companyId)
        )
      );
    return record;
  }

  async getBaleLabelPrintsByArticle(articleCode: string, companyId: number): Promise<schema.BaleLabelPrint[]> {
    return await db
      .select()
      .from(schema.baleLabelPrints)
      .where(
        and(
          eq(schema.baleLabelPrints.articleCode, articleCode),
          eq(schema.baleLabelPrints.companyId, companyId)
        )
      )
      .orderBy(desc(schema.baleLabelPrints.printedAt));
  }

  async getBaleProductByArticleCode(articleCode: string, companyId: number): Promise<schema.BaleProduct | undefined> {
    const [product] = await db
      .select()
      .from(schema.baleProducts)
      .where(
        and(
          eq(schema.baleProducts.articleCode, articleCode),
          eq(schema.baleProducts.companyId, companyId)
        )
      );
    return product;
  }

  // Bale Transfers
  async getAllBaleTransfers(companyId: number): Promise<schema.BaleTransfer[]> {
    return await db
      .select()
      .from(schema.baleTransfers)
      .where(eq(schema.baleTransfers.companyId, companyId))
      .orderBy(desc(schema.baleTransfers.createdAt));
  }

  async getBaleTransferById(id: number): Promise<schema.BaleTransfer | undefined> {
    const [transfer] = await db
      .select()
      .from(schema.baleTransfers)
      .where(eq(schema.baleTransfers.id, id));
    return transfer;
  }

  async createBaleTransfer(transfer: schema.InsertBaleTransfer): Promise<schema.BaleTransfer> {
    const [created] = await db
      .insert(schema.baleTransfers)
      .values(transfer)
      .returning();
    return created;
  }

  async updateBaleTransfer(id: number, updates: Partial<schema.InsertBaleTransfer>): Promise<schema.BaleTransfer> {
    const [updated] = await db
      .update(schema.baleTransfers)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(schema.baleTransfers.id, id))
      .returning();
    return updated;
  }

  async deleteBaleTransfer(id: number): Promise<void> {
    await db.delete(schema.baleTransfers).where(eq(schema.baleTransfers.id, id));
  }

  async getBaleTransferItems(transferId: number): Promise<schema.BaleTransferItem[]> {
    return await db
      .select()
      .from(schema.baleTransferItems)
      .where(eq(schema.baleTransferItems.transferId, transferId));
  }

  async createBaleTransferItem(item: schema.InsertBaleTransferItem): Promise<schema.BaleTransferItem> {
    const [created] = await db
      .insert(schema.baleTransferItems)
      .values(item)
      .returning();
    return created;
  }

  async updateBaleTransferItem(id: number, updates: Partial<schema.InsertBaleTransferItem>): Promise<schema.BaleTransferItem> {
    const [updated] = await db
      .update(schema.baleTransferItems)
      .set(updates)
      .where(eq(schema.baleTransferItems.id, id))
      .returning();
    return updated;
  }

  async deleteBaleTransferItem(id: number): Promise<void> {
    await db.delete(schema.baleTransferItems).where(eq(schema.baleTransferItems.id, id));
  }

  async getProductionBalesByLocation(companyId: number, locationId: number): Promise<schema.ProductionBale[]> {
    return await db
      .select()
      .from(schema.productionBales)
      .where(and(
        eq(schema.productionBales.companyId, companyId),
        eq(schema.productionBales.locationId, locationId),
        eq(schema.productionBales.status, "IN_STOCK")
      ));
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
      .values({
        ...batch,
        batchCode: batch.batchCode || `MB-${Date.now()}`,
      })
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
  }): Promise<any[]> {
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
      .select({
        bale: schema.productionBales,
        product: schema.baleProducts,
        location: schema.locations,
        mixBatch: schema.mixBatches,
      })
      .from(schema.productionBales)
      .leftJoin(schema.baleProducts, eq(schema.productionBales.productId, schema.baleProducts.id))
      .leftJoin(schema.locations, eq(schema.productionBales.locationId, schema.locations.id))
      .leftJoin(schema.mixBatches, eq(schema.productionBales.mixBatchId, schema.mixBatches.id))
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

  async deleteProductionBale(id: number, companyId: number): Promise<void> {
    await db
      .delete(schema.productionBales)
      .where(and(
        eq(schema.productionBales.id, id),
        eq(schema.productionBales.companyId, companyId)
      ));
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

  // Barcode generation for production bales
  async getNextBaleBarcode(companyId: number): Promise<string> {
    // Get or create sequence
    const [sequence] = await db
      .select()
      .from(schema.baleSequences)
      .where(eq(schema.baleSequences.companyId, companyId));

    if (!sequence) {
      // Create new sequence starting at 1
      const [newSeq] = await db
        .insert(schema.baleSequences)
        .values({ companyId, nextNumber: 2 })
        .returning();
      return `HD${String(newSeq.nextNumber - 1).padStart(5, '0')}`;
    }

    // Increment and get next number
    const nextNum = sequence.nextNumber;
    await db
      .update(schema.baleSequences)
      .set({ nextNumber: nextNum + 1 })
      .where(eq(schema.baleSequences.id, sequence.id));

    return `HD${String(nextNum).padStart(5, '0')}`;
  }

  // Container Sales API
  async createContainerSale(sale: schema.InsertContainerSale): Promise<schema.ContainerSale> {
    const [created] = await db
      .insert(schema.containerSales)
      .values(sale)
      .returning();
    
    // Create customer balance entry
    await this.addCustomerBalanceEntry({
      companyId: sale.companyId,
      customerId: sale.customerId,
      transactionDate: sale.saleDate,
      transactionType: "SALE",
      referenceId: created.id,
      referenceType: "CONTAINER_SALE",
      debitAmount: sale.totalAmount,
      creditAmount: "0",
      balance: sale.totalAmount,
      currency: sale.currency || "USD",
      description: `Container sale - Invoice ${sale.invoiceNumber || created.id}`,
    });
    
    return created;
  }

  async getContainerSales(companyId: number): Promise<schema.ContainerSale[]> {
    return await db
      .select()
      .from(schema.containerSales)
      .where(eq(schema.containerSales.companyId, companyId))
      .orderBy(desc(schema.containerSales.saleDate));
  }

  async getContainerSaleById(id: number, companyId: number): Promise<schema.ContainerSale | undefined> {
    const [sale] = await db
      .select()
      .from(schema.containerSales)
      .where(and(
        eq(schema.containerSales.id, id),
        eq(schema.containerSales.companyId, companyId)
      ));
    return sale;
  }

  async updateContainerSalePayment(
    id: number,
    companyId: number,
    paidAmount: string,
    paymentStatus: "PENDING" | "PARTIAL" | "PAID"
  ): Promise<schema.ContainerSale> {
    const [updated] = await db
      .update(schema.containerSales)
      .set({
        paidAmount,
        paymentStatus,
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(schema.containerSales.id, id),
        eq(schema.containerSales.companyId, companyId)
      ))
      .returning();

    return updated;
  }

  async getContainerSaleByContainerId(containerId: number, companyId: number): Promise<schema.ContainerSale | undefined> {
    const [sale] = await db
      .select()
      .from(schema.containerSales)
      .where(and(
        eq(schema.containerSales.containerId, containerId),
        eq(schema.containerSales.companyId, companyId)
      ));
    return sale;
  }

  async getContainerSalesByCustomer(customerId: number, companyId: number): Promise<schema.ContainerSale[]> {
    return await db
      .select()
      .from(schema.containerSales)
      .where(and(
        eq(schema.containerSales.customerId, customerId),
        eq(schema.containerSales.companyId, companyId)
      ))
      .orderBy(desc(schema.containerSales.saleDate));
  }

  // Customer Balance API
  async addCustomerBalanceEntry(entry: schema.InsertCustomerBalance): Promise<schema.CustomerBalance> {
    // Validate amounts are valid decimals
    const debitAmount = entry.debitAmount || "0";
    const creditAmount = entry.creditAmount || "0";
    
    // Basic validation - ensure they're numeric strings
    if (isNaN(Number(debitAmount)) || isNaN(Number(creditAmount))) {
      throw new Error("Invalid debit or credit amount");
    }

    // Use SQL to calculate running balance with native decimal precision
    // This avoids float precision errors by using PostgreSQL's decimal arithmetic
    const [latestBalance] = await db
      .select({ balance: schema.customerBalances.balance })
      .from(schema.customerBalances)
      .where(and(
        eq(schema.customerBalances.customerId, entry.customerId),
        eq(schema.customerBalances.companyId, entry.companyId)
      ))
      .orderBy(desc(schema.customerBalances.id))
      .limit(1);

    const currentBalance = latestBalance?.balance || "0";

    // Insert with SQL-calculated balance using PostgreSQL's decimal type
    const [created] = await db
      .insert(schema.customerBalances)
      .values({
        ...entry,
        debitAmount: debitAmount,
        creditAmount: creditAmount,
        balance: sql`(${currentBalance}::decimal + ${debitAmount}::decimal - ${creditAmount}::decimal)`,
      })
      .returning();

    return created;
  }

  async getCustomerBalance(customerId: number, companyId: number): Promise<number> {
    const [result] = await db
      .select({
        net: sql<string>`COALESCE(SUM(CAST(${schema.customerBalances.debitAmount} AS numeric) - CAST(${schema.customerBalances.creditAmount} AS numeric)), 0)`,
      })
      .from(schema.customerBalances)
      .where(and(
        eq(schema.customerBalances.customerId, customerId),
        eq(schema.customerBalances.companyId, companyId)
      ));

    return result ? parseFloat(result.net) : 0;
  }

  async getCustomerStatement(
    customerId: number,
    companyId: number,
    startDate?: string,
    endDate?: string
  ): Promise<schema.CustomerBalance[]> {
    const conditions = [
      eq(schema.customerBalances.customerId, customerId),
      eq(schema.customerBalances.companyId, companyId),
    ];

    if (startDate) {
      conditions.push(sql`${schema.customerBalances.transactionDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${schema.customerBalances.transactionDate} <= ${endDate}`);
    }

    return await db
      .select()
      .from(schema.customerBalances)
      .where(and(...conditions))
      .orderBy(schema.customerBalances.transactionDate);
  }

  // Role Feature Permissions
  async getRoleFeaturePermissions(companyId: number): Promise<schema.RoleFeaturePermission[]> {
    return await db
      .select()
      .from(schema.roleFeaturePermissions)
      .where(eq(schema.roleFeaturePermissions.companyId, companyId));
  }

  async getRoleFeaturePermission(companyId: number, role: string, featureKey: string): Promise<schema.RoleFeaturePermission | undefined> {
    const [permission] = await db
      .select()
      .from(schema.roleFeaturePermissions)
      .where(and(
        eq(schema.roleFeaturePermissions.companyId, companyId),
        eq(schema.roleFeaturePermissions.role, role),
        eq(schema.roleFeaturePermissions.featureKey, featureKey)
      ));
    return permission;
  }

  async upsertRoleFeaturePermission(permission: schema.InsertRoleFeaturePermission): Promise<schema.RoleFeaturePermission> {
    const [result] = await db
      .insert(schema.roleFeaturePermissions)
      .values(permission)
      .onConflictDoUpdate({
        target: [
          schema.roleFeaturePermissions.companyId,
          schema.roleFeaturePermissions.role,
          schema.roleFeaturePermissions.featureKey
        ],
        set: {
          enabled: permission.enabled,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async bulkUpsertRoleFeaturePermissions(permissions: schema.InsertRoleFeaturePermission[]): Promise<schema.RoleFeaturePermission[]> {
    if (permissions.length === 0) return [];
    
    const results: schema.RoleFeaturePermission[] = [];
    for (const permission of permissions) {
      const result = await this.upsertRoleFeaturePermission(permission);
      results.push(result);
    }
    return results;
  }

  // ERP User Page Access
  async getErpUserPageAccess(companyId: number, userId: string): Promise<string[]> {
    const rows = await db
      .select({ pageKey: schema.erpUserPageAccess.pageKey })
      .from(schema.erpUserPageAccess)
      .where(and(
        eq(schema.erpUserPageAccess.companyId, companyId),
        eq(schema.erpUserPageAccess.userId, userId)
      ));
    return rows.map(r => r.pageKey);
  }

  async setErpUserPageAccess(companyId: number, userId: string, pageKeys: string[]): Promise<void> {
    await db
      .delete(schema.erpUserPageAccess)
      .where(and(
        eq(schema.erpUserPageAccess.companyId, companyId),
        eq(schema.erpUserPageAccess.userId, userId)
      ));
    if (pageKeys.length > 0) {
      await db.insert(schema.erpUserPageAccess).values(
        pageKeys.map(pageKey => ({ companyId, userId, pageKey }))
      );
    }
  }

  async getErpUserHiddenCostFields(userId: string): Promise<string[]> {
    const [user] = await db
      .select({ hiddenErpCostFields: schema.users.hiddenErpCostFields })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user?.hiddenErpCostFields ?? [];
  }

  async setErpUserHiddenCostFields(userId: string, fields: string[]): Promise<void> {
    await db
      .update(schema.users)
      .set({ hiddenErpCostFields: fields })
      .where(eq(schema.users.id, userId));
  }

  // Stock Group Location Archives
  async archiveStockGroupAtLocation(
    companyId: number,
    locationId: number,
    stockGroupId: number | null,
    archivedBy: string,
    notes?: string
  ): Promise<schema.StockGroupLocationArchive> {
    // Get location and stock group names for the archive record
    const location = await this.getLocationById(locationId);
    
    let stockGroupName = "Uncategorized";
    let uncategorizedGroupId: number | null = null;
    
    if (stockGroupId !== null) {
      const stockGroup = await db
        .select()
        .from(schema.stockGroups)
        .where(eq(schema.stockGroups.id, stockGroupId))
        .limit(1);
      
      if (!stockGroup.length) {
        throw new Error("Stock group not found");
      }
      stockGroupName = stockGroup[0].name;
    } else {
      // When stockGroupId is null, find the "Uncategorized" stock group for this company
      // Items may be assigned to this group OR have null stockGroupId
      const uncategorizedGroup = await db
        .select()
        .from(schema.stockGroups)
        .where(and(
          eq(schema.stockGroups.companyId, companyId),
          sql`UPPER(${schema.stockGroups.code}) = 'UNCATEGORIZED'`
        ))
        .limit(1);
      
      if (uncategorizedGroup.length > 0) {
        uncategorizedGroupId = uncategorizedGroup[0].id;
      }
    }
    
    if (!location) {
      throw new Error("Location not found");
    }

    // Get all stock items in this stock group
    // For uncategorized: get items with null stockGroupId OR items in the "Uncategorized" group
    let stockItems;
    if (stockGroupId !== null) {
      stockItems = await db
        .select()
        .from(schema.stockItems)
        .where(and(
          eq(schema.stockItems.companyId, companyId),
          eq(schema.stockItems.stockGroupId, stockGroupId),
          isNull(schema.stockItems.deletedAt)
        ));
    } else {
      // For uncategorized items: find items with null stockGroupId OR in the Uncategorized group
      if (uncategorizedGroupId !== null) {
        stockItems = await db
          .select()
          .from(schema.stockItems)
          .where(and(
            eq(schema.stockItems.companyId, companyId),
            or(
              isNull(schema.stockItems.stockGroupId),
              eq(schema.stockItems.stockGroupId, uncategorizedGroupId)
            ),
            isNull(schema.stockItems.deletedAt)
          ));
      } else {
        // No Uncategorized group exists, just look for null stockGroupId
        stockItems = await db
          .select()
          .from(schema.stockItems)
          .where(and(
            eq(schema.stockItems.companyId, companyId),
            isNull(schema.stockItems.stockGroupId),
            isNull(schema.stockItems.deletedAt)
          ));
      }
    }

    if (stockItems.length === 0) {
      throw new Error("No stock items found in this stock group");
    }

    const stockItemIds = stockItems.map(item => item.id);

    // Get all inventory records for these items at this location
    const inventoryRecords = await db
      .select({
        stockItemId: schema.inventory.stockItemId,
        quantity: schema.inventory.quantity,
        averageRate: schema.inventory.averageRate,
        totalValue: schema.inventory.totalValue,
      })
      .from(schema.inventory)
      .where(and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.companyId, companyId),
        inArray(schema.inventory.stockItemId, stockItemIds),
        sql`${schema.inventory.quantity}::numeric > 0`
      ));

    if (inventoryRecords.length === 0) {
      throw new Error("No inventory found for this stock group at this location");
    }

    // Calculate totals
    let totalQuantity = 0;
    let totalValue = 0;
    for (const inv of inventoryRecords) {
      totalQuantity += parseFloat(inv.quantity);
      totalValue += parseFloat(inv.totalValue);
    }

    // Create the archive record
    const [archive] = await db
      .insert(schema.stockGroupLocationArchives)
      .values({
        companyId,
        locationId,
        stockGroupId,
        locationName: location.name,
        stockGroupName,
        totalQuantity: totalQuantity.toString(),
        totalValue: totalValue.toString(),
        itemCount: inventoryRecords.length,
        archivedBy,
        notes,
      })
      .returning();

    // Create archive item records
    const archiveItems = inventoryRecords.map(inv => {
      const item = stockItems.find(s => s.id === inv.stockItemId);
      return {
        archiveId: archive.id,
        stockItemId: inv.stockItemId,
        stockItemCode: item?.code || '',
        stockItemName: item?.name || '',
        quantity: inv.quantity,
        averageRate: inv.averageRate,
        totalValue: inv.totalValue,
      };
    });

    await db
      .insert(schema.stockGroupLocationArchiveItems)
      .values(archiveItems);

    // Zero out the inventory records
    await db
      .update(schema.inventory)
      .set({
        quantity: "0",
        totalValue: "0",
        lastUpdated: sql`now()`,
      })
      .where(and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.companyId, companyId),
        inArray(schema.inventory.stockItemId, stockItemIds)
      ));

    return archive;
  }

  async getStockGroupLocationArchives(companyId: number): Promise<schema.StockGroupLocationArchive[]> {
    return await db
      .select()
      .from(schema.stockGroupLocationArchives)
      .where(and(
        eq(schema.stockGroupLocationArchives.companyId, companyId),
        isNull(schema.stockGroupLocationArchives.deletedAt),
        isNull(schema.stockGroupLocationArchives.restoredAt)
      ))
      .orderBy(desc(schema.stockGroupLocationArchives.archivedAt));
  }

  async getStockGroupLocationArchiveById(id: number, companyId: number): Promise<schema.StockGroupLocationArchive | undefined> {
    const [archive] = await db
      .select()
      .from(schema.stockGroupLocationArchives)
      .where(and(
        eq(schema.stockGroupLocationArchives.id, id),
        eq(schema.stockGroupLocationArchives.companyId, companyId)
      ));
    return archive;
  }

  async getStockGroupLocationArchiveItems(archiveId: number): Promise<schema.StockGroupLocationArchiveItem[]> {
    return await db
      .select()
      .from(schema.stockGroupLocationArchiveItems)
      .where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));
  }

  async restoreStockGroupLocationArchive(archiveId: number, companyId: number): Promise<schema.StockGroupLocationArchive> {
    const archive = await this.getStockGroupLocationArchiveById(archiveId, companyId);
    if (!archive) {
      throw new Error("Archive not found");
    }
    if (archive.restoredAt) {
      throw new Error("Archive has already been restored");
    }
    if (archive.deletedAt) {
      throw new Error("Archive has been deleted");
    }

    const archiveItems = await this.getStockGroupLocationArchiveItems(archiveId);

    // Restore each item's inventory
    for (const item of archiveItems) {
      // Check if inventory record exists
      const [existing] = await db
        .select()
        .from(schema.inventory)
        .where(and(
          eq(schema.inventory.stockItemId, item.stockItemId),
          eq(schema.inventory.locationId, archive.locationId),
          eq(schema.inventory.companyId, companyId)
        ));

      if (existing) {
        // Add back the archived quantity using weighted average
        const existingQty = parseFloat(existing.quantity);
        const existingValue = parseFloat(existing.totalValue);
        const archivedQty = parseFloat(item.quantity);
        const archivedValue = parseFloat(item.totalValue);
        
        const newQty = existingQty + archivedQty;
        const newValue = existingValue + archivedValue;
        const newRate = newQty > 0 ? newValue / newQty : 0;

        await db
          .update(schema.inventory)
          .set({
            quantity: newQty.toString(),
            averageRate: newRate.toFixed(2),
            totalValue: newValue.toFixed(2),
            lastUpdated: sql`now()`,
          })
          .where(eq(schema.inventory.id, existing.id));
      } else {
        // Create new inventory record
        await db
          .insert(schema.inventory)
          .values({
            companyId,
            locationId: archive.locationId,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            averageRate: item.averageRate,
            totalValue: item.totalValue,
          });
      }
    }

    // Mark archive as restored
    const [updated] = await db
      .update(schema.stockGroupLocationArchives)
      .set({ restoredAt: sql`now()` })
      .where(eq(schema.stockGroupLocationArchives.id, archiveId))
      .returning();

    return updated;
  }

  async deleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
    const archive = await this.getStockGroupLocationArchiveById(archiveId, companyId);
    if (!archive) {
      throw new Error("Archive not found");
    }

    // Soft delete - mark as deleted
    await db
      .update(schema.stockGroupLocationArchives)
      .set({ deletedAt: sql`now()` })
      .where(eq(schema.stockGroupLocationArchives.id, archiveId));
  }

  async permanentlyDeleteStockGroupLocationArchive(archiveId: number, companyId: number): Promise<void> {
    const archive = await this.getStockGroupLocationArchiveById(archiveId, companyId);
    if (!archive) {
      throw new Error("Archive not found");
    }

    // Delete archive items first
    await db
      .delete(schema.stockGroupLocationArchiveItems)
      .where(eq(schema.stockGroupLocationArchiveItems.archiveId, archiveId));

    // Delete archive record
    await db
      .delete(schema.stockGroupLocationArchives)
      .where(eq(schema.stockGroupLocationArchives.id, archiveId));
  }

  // System Settings implementation
  async getSystemSetting(key: string): Promise<schema.SystemSetting | undefined> {
    const [setting] = await db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key));
    return setting;
  }

  async setSystemSetting(key: string, value: string | null): Promise<schema.SystemSetting> {
    const existing = await this.getSystemSetting(key);
    if (existing) {
      const [updated] = await db
        .update(schema.systemSettings)
        .set({ value, updatedAt: sql`now()` })
        .where(eq(schema.systemSettings.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(schema.systemSettings)
        .values({ key, value })
        .returning();
      return created;
    }
  }

  async getParentCompanyId(): Promise<number | null> {
    const setting = await this.getSystemSetting("parentCompanyId");
    if (setting?.value) {
      const id = parseInt(setting.value, 10);
      return isNaN(id) ? null : id;
    }
    return null;
  }

  async setParentCompanyId(companyId: number | null): Promise<void> {
    await this.setSystemSetting("parentCompanyId", companyId?.toString() ?? null);
  }

  // POS Shifts implementation
  async getCurrentShift(userId: string, locationId: number): Promise<schema.PosShift | undefined> {
    const [shift] = await db
      .select()
      .from(schema.posShifts)
      .where(
        and(
          eq(schema.posShifts.userId, userId),
          eq(schema.posShifts.locationId, locationId),
          eq(schema.posShifts.status, "open")
        )
      )
      .orderBy(desc(schema.posShifts.openedAt))
      .limit(1);
    return shift;
  }

  async getShiftById(id: number): Promise<schema.PosShift | undefined> {
    const [shift] = await db
      .select()
      .from(schema.posShifts)
      .where(eq(schema.posShifts.id, id));
    return shift;
  }

  async getShiftsByLocation(locationId: number, limit: number = 50): Promise<schema.PosShift[]> {
    return await db
      .select()
      .from(schema.posShifts)
      .where(eq(schema.posShifts.locationId, locationId))
      .orderBy(desc(schema.posShifts.openedAt))
      .limit(limit);
  }

  async openShift(shift: schema.InsertPosShift): Promise<schema.PosShift> {
    const [created] = await db
      .insert(schema.posShifts)
      .values(shift)
      .returning();
    return created;
  }

  async closeShift(id: number, closingCash: string, notes?: string): Promise<schema.PosShift> {
    // Calculate sales during this shift
    const shift = await this.getShiftById(id);
    if (!shift) {
      throw new Error("Shift not found");
    }

    // Get sales vouchers created during this shift
    const salesVouchers = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          eq(schema.vouchers.shiftId, id),
          eq(schema.vouchers.voucherType, "Sales"),
          isNull(schema.vouchers.deletedAt)
        )
      );

    const salesCount = salesVouchers.length;
    const salesTotal = salesVouchers.reduce((sum, v) => sum + parseFloat(v.totalAmount || "0"), 0);
    
    // Calculate expected cash (opening + sales)
    const openingCash = parseFloat(shift.openingCash || "0");
    const expectedCash = openingCash + salesTotal;
    const actualClosing = parseFloat(closingCash);
    const variance = actualClosing - expectedCash;

    const [updated] = await db
      .update(schema.posShifts)
      .set({
        status: "closed",
        closedAt: sql`now()`,
        closingCash: closingCash,
        expectedCash: expectedCash.toFixed(2),
        variance: variance.toFixed(2),
        salesCount: salesCount,
        salesTotal: salesTotal.toFixed(2),
        notes: notes || null,
      })
      .where(eq(schema.posShifts.id, id))
      .returning();
    return updated;
  }

  async updateShiftStats(id: number, salesCount: number, salesTotal: string): Promise<void> {
    await db
      .update(schema.posShifts)
      .set({
        salesCount: salesCount,
        salesTotal: salesTotal,
      })
      .where(eq(schema.posShifts.id, id));
  }

  // Spreadsheets
  async listSpreadsheets(companyId: number): Promise<Pick<schema.Spreadsheet, "id" | "name" | "createdBy" | "updatedAt">[]> {
    return db
      .select({ id: schema.spreadsheets.id, name: schema.spreadsheets.name, createdBy: schema.spreadsheets.createdBy, updatedAt: schema.spreadsheets.updatedAt })
      .from(schema.spreadsheets)
      .where(eq(schema.spreadsheets.companyId, companyId))
      .orderBy(desc(schema.spreadsheets.updatedAt));
  }

  async getSpreadsheet(id: number, companyId: number): Promise<schema.Spreadsheet | undefined> {
    const [row] = await db
      .select()
      .from(schema.spreadsheets)
      .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)));
    return row;
  }

  async createSpreadsheet(companyId: number, name: string, data: any, createdBy?: string): Promise<schema.Spreadsheet> {
    const [row] = await db
      .insert(schema.spreadsheets)
      .values({ companyId, name, data, createdBy: createdBy ?? null })
      .returning();
    return row;
  }

  async updateSpreadsheet(id: number, companyId: number, fields: { name?: string; data?: any }): Promise<schema.Spreadsheet | undefined> {
    const [row] = await db
      .update(schema.spreadsheets)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)))
      .returning();
    return row;
  }

  async deleteSpreadsheet(id: number, companyId: number): Promise<void> {
    await db
      .delete(schema.spreadsheets)
      .where(and(eq(schema.spreadsheets.id, id), eq(schema.spreadsheets.companyId, companyId)));
  }

  // Live Spreadsheets
  async getLiveSpreadsheets(companyId: number, activeOnly = true): Promise<schema.LiveSpreadsheet[]> {
    const conditions = [eq(schema.liveSpreadsheets.companyId, companyId)];
    if (activeOnly) conditions.push(eq(schema.liveSpreadsheets.isActive, true));
    return db.select().from(schema.liveSpreadsheets).where(and(...conditions)).orderBy(schema.liveSpreadsheets.name);
  }

  async getLiveSpreadsheetById(id: number, companyId: number): Promise<schema.LiveSpreadsheet | undefined> {
    const [row] = await db.select().from(schema.liveSpreadsheets).where(
      and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId))
    );
    return row;
  }

  async createLiveSpreadsheet(data: schema.InsertLiveSpreadsheet): Promise<schema.LiveSpreadsheet> {
    const [row] = await db.insert(schema.liveSpreadsheets).values(data).returning();
    return row;
  }

  async updateLiveSpreadsheet(id: number, companyId: number, fields: Partial<schema.InsertLiveSpreadsheet>): Promise<schema.LiveSpreadsheet | undefined> {
    const [row] = await db.update(schema.liveSpreadsheets)
      .set({ ...fields, updatedAt: sql`now()` })
      .where(and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId)))
      .returning();
    return row;
  }

  async deleteLiveSpreadsheet(id: number, companyId: number): Promise<void> {
    await db.delete(schema.liveSpreadsheets)
      .where(and(eq(schema.liveSpreadsheets.id, id), eq(schema.liveSpreadsheets.companyId, companyId)));
  }
}

export const storage = new DbStorage();
