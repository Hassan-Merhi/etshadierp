import { eq, and, sql } from "drizzle-orm";
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
  getLocationByCode(code: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;

  // Ledger Accounts
  getAllLedgerAccounts(companyId: number): Promise<LedgerAccount[]>;
  getLedgerAccountByCode(code: string): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;

  // Employees
  getAllEmployees(companyId: number): Promise<Employee[]>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;

  // Suppliers
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplierByCode(code: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;

  // Stock Groups
  getAllStockGroups(companyId: number): Promise<StockGroup[]>;
  getStockGroupByCode(code: string): Promise<StockGroup | undefined>;
  createStockGroup(group: InsertStockGroup): Promise<StockGroup>;

  // Stock Items
  getAllStockItems(companyId: number): Promise<StockItem[]>;
  getStockItemByCode(code: string): Promise<StockItem | undefined>;
  createStockItem(item: InsertStockItem): Promise<StockItem>;

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

  // Purchase Orders
  getAllPurchaseOrders(companyId: number): Promise<PurchaseOrder[]>;
  getPurchaseOrdersByContainer(containerId: number): Promise<PurchaseOrder[]>;
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, updates: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder>;

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
  updateInventory(locationId: number, stockItemId: number, quantity: string, averageRate: string, totalValue: string): Promise<void>;

  // Container Offload
  offloadContainer(containerId: number, locationId: number, duties: string, officeCharges: string, transferCharges: string, transportFees: string): Promise<ContainerOffload>;

  // Vouchers and Journal Entries
  getAllVouchers(companyId: number): Promise<Voucher[]>;
  getVoucherById(id: number): Promise<Voucher | undefined>;
  getVouchersByDateRange(startDate: string, endDate: string): Promise<any[]>;
  getVoucherEntriesByLedger(ledgerAccountId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByBankAccount(bankAccountId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesByFixedAsset(fixedAssetId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getVoucherEntriesBySupplier(supplierId: number, startDate?: string, endDate?: string): Promise<any[]>;
  getContainerCountBySupplier(supplierId: number): Promise<number>;
  createVoucher(voucher: InsertVoucher): Promise<Voucher>;
  createVoucherEntry(entry: InsertVoucherEntry): Promise<VoucherEntry>;
  deleteVoucher(id: number): Promise<void>;

  // Stock Transfers
  createStockTransfer(voucherId: number, destinationLocationId: number, notes: string, items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>): Promise<any>;

  // Stock Adjustments
  createStockAdjustment(voucherId: number, locationId: number, adjustmentType: "Production" | "Consumption" | "Mixed", notes: string, items: Array<{stockItemId: number, quantity: string, rate: string}>): Promise<any>;
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
    return await db.select().from(schema.locations).where(eq(schema.locations.companyId, companyId));
  }

  async getLocationById(id: number): Promise<Location | undefined> {
    const [location] = await db.select().from(schema.locations).where(eq(schema.locations.id, id));
    return location;
  }

  async getLocationByCode(code: string): Promise<Location | undefined> {
    const [location] = await db.select().from(schema.locations).where(eq(schema.locations.code, code));
    return location;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [created] = await db.insert(schema.locations).values(location).returning();
    return created;
  }

  // Ledger Accounts
  async getAllLedgerAccounts(companyId: number): Promise<LedgerAccount[]> {
    return await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.companyId, companyId));
  }

  async getLedgerAccountByCode(code: string): Promise<LedgerAccount | undefined> {
    const [account] = await db.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.code, code));
    return account;
  }

  async createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount> {
    const [created] = await db.insert(schema.ledgerAccounts).values(account).returning();
    return created;
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
    const [created] = await db.insert(schema.employees).values(employee).returning();
    return created;
  }

  // Suppliers
  async getAllSuppliers(): Promise<Supplier[]> {
    return await db.select().from(schema.suppliers);
  }

  async getSupplierByCode(code: string): Promise<Supplier | undefined> {
    const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.code, code));
    return supplier;
  }

  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    const [created] = await db.insert(schema.suppliers).values(supplier).returning();
    return created;
  }

  // Stock Groups
  async getAllStockGroups(companyId: number): Promise<StockGroup[]> {
    return await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.companyId, companyId));
  }

  async getStockGroupByCode(code: string): Promise<StockGroup | undefined> {
    const [group] = await db.select().from(schema.stockGroups).where(eq(schema.stockGroups.code, code));
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

  async getStockItemByCode(code: string): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.code, code));
    return item;
  }

  async createStockItem(item: InsertStockItem): Promise<StockItem> {
    const [created] = await db.insert(schema.stockItems).values(item).returning();
    return created;
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

  async getPurchaseOrdersByContainer(containerId: number): Promise<PurchaseOrder[]> {
    return await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.containerId, containerId));
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

  // PO Line Items
  async getLineItemsByPO(poId: number): Promise<POLineItem[]> {
    return await db.select().from(schema.poLineItems).where(eq(schema.poLineItems.poId, poId));
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

  // Stock Items - Barcode lookup
  async getStockItemByBarcode(barcode: string): Promise<StockItem | undefined> {
    const [item] = await db.select().from(schema.stockItems).where(eq(schema.stockItems.barcode, barcode));
    return item;
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
        stockItemBarcode: schema.stockItems.barcode,
        stockItemUom: schema.stockItems.uom,
        stockGroupId: schema.stockItems.stockGroupId,
        stockGroupName: schema.stockGroups.name,
        stockGroupCode: schema.stockGroups.code,
      })
      .from(schema.inventory)
      .leftJoin(schema.stockItems, eq(schema.inventory.stockItemId, schema.stockItems.id))
      .leftJoin(schema.stockGroups, eq(schema.stockItems.stockGroupId, schema.stockGroups.id))
      .where(eq(schema.inventory.locationId, locationId));
    
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
    officeCharges: string, 
    transferCharges: string, 
    transportFees: string
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

    // Calculate total charges
    const totalCharges = 
      parseFloat(duties) + 
      parseFloat(officeCharges) + 
      parseFloat(transferCharges) + 
      parseFloat(transportFees);

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
    const conditions = [eq(schema.voucherEntries.ledgerAccountId, ledgerAccountId)];
    
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
    const conditions = [eq(schema.voucherEntries.bankAccountId, bankAccountId)];
    
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
    const conditions = [eq(schema.voucherEntries.fixedAssetId, fixedAssetId)];
    
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
    startDate?: string,
    endDate?: string
  ): Promise<any[]> {
    const conditions = [eq(schema.voucherEntries.supplierId, supplierId)];
    
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

  async getContainerCountBySupplier(supplierId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.containers)
      .where(eq(schema.containers.supplierId, supplierId));
    
    return result[0]?.count || 0;
  }

  async createVoucher(voucher: InsertVoucher): Promise<Voucher> {
    const [created] = await db.insert(schema.vouchers).values(voucher).returning();
    return created;
  }

  async createVoucherEntry(entry: InsertVoucherEntry): Promise<VoucherEntry> {
    const [created] = await db.insert(schema.voucherEntries).values(entry).returning();
    return created;
  }

  async deleteVoucher(id: number): Promise<void> {
    // First delete all voucher entries
    await db.delete(schema.voucherEntries).where(eq(schema.voucherEntries.voucherId, id));
    // Then delete the voucher
    await db.delete(schema.vouchers).where(eq(schema.vouchers.id, id));
  }

  // Stock Transfers
  async createStockTransfer(
    voucherId: number,
    destinationLocationId: number,
    notes: string,
    items: Array<{sourceLocationId: number, stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    // Create the stock transfer voucher record (note: no global sourceLocationId)
    const [transfer] = await db.insert(schema.stockTransferVouchers).values({
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
      const [transferItem] = await db.insert(schema.stockTransferItems).values({
        transferId: transfer.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        rate: item.rate,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      transferItems.push(transferItem);

      // Get current inventory at THIS ITEM's source location
      const [sourceInventory] = await db
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
        
        await this.updateInventory(
          item.sourceLocationId,
          item.stockItemId,
          newQty.toFixed(3),
          currentRate.toFixed(2),
          newValue.toFixed(2)
        );
      }

      // Get current inventory at destination location
      const [destInventory] = await db
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
        
        await this.updateInventory(
          destinationLocationId,
          item.stockItemId,
          newQty.toFixed(3),
          newRate.toFixed(2),
          newValue.toFixed(2)
        );
      } else {
        // Create new inventory record at destination
        await this.updateInventory(
          destinationLocationId,
          item.stockItemId,
          item.quantity,
          item.rate,
          totalAmount.toFixed(2)
        );
      }
    }

    return {
      transfer,
      items: transferItems,
    };
  }

  // Stock Adjustments
  async createStockAdjustment(
    voucherId: number,
    locationId: number,
    adjustmentType: "Production" | "Consumption",
    notes: string,
    items: Array<{stockItemId: number, quantity: string, rate: string}>
  ): Promise<any> {
    // Create the stock adjustment voucher record
    const [adjustment] = await db.insert(schema.stockAdjustmentVouchers).values({
      voucherId,
      locationId,
      adjustmentType,
      notes,
    }).returning();

    // Process each item
    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of items) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const totalAmount = Math.abs(quantity) * rate;

      // Insert adjustment item
      const [adjustmentItem] = await db.insert(schema.stockAdjustmentItems).values({
        adjustmentId: adjustment.id,
        stockItemId: item.stockItemId,
        quantity: item.quantity,
        rate: item.rate,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      adjustmentItems.push(adjustmentItem);

      // Get current inventory at location
      const [currentInventory] = await db
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
        
        await this.updateInventory(
          locationId,
          item.stockItemId,
          newQty.toFixed(3),
          newRate.toFixed(2),
          newValue.toFixed(2)
        );
      } else if (adjustmentType === "Production") {
        // Create new inventory record for production
        await this.updateInventory(
          locationId,
          item.stockItemId,
          item.quantity,
          item.rate,
          totalAmount.toFixed(2)
        );
      }
    }

    return {
      adjustment,
      items: adjustmentItems,
    };
  }
}

export const storage = new DbStorage();
