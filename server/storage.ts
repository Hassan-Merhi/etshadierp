import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";
import type {
  User,
  InsertUser,
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
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Locations
  getAllLocations(): Promise<Location[]>;
  getLocationByCode(code: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;

  // Ledger Accounts
  getAllLedgerAccounts(): Promise<LedgerAccount[]>;
  getLedgerAccountByCode(code: string): Promise<LedgerAccount | undefined>;
  createLedgerAccount(account: InsertLedgerAccount): Promise<LedgerAccount>;

  // Employees
  getAllEmployees(): Promise<Employee[]>;
  getEmployeeByCode(code: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;

  // Suppliers
  getAllSuppliers(): Promise<Supplier[]>;
  getSupplierByCode(code: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;

  // Stock Groups
  getAllStockGroups(): Promise<StockGroup[]>;
  getStockGroupByCode(code: string): Promise<StockGroup | undefined>;
  createStockGroup(group: InsertStockGroup): Promise<StockGroup>;

  // Stock Items
  getAllStockItems(): Promise<StockItem[]>;
  getStockItemByCode(code: string): Promise<StockItem | undefined>;
  createStockItem(item: InsertStockItem): Promise<StockItem>;

  // Bank Accounts
  getAllBankAccounts(): Promise<BankAccount[]>;
  getBankAccountByCode(code: string): Promise<BankAccount | undefined>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;

  // Fixed Assets
  getAllFixedAssets(): Promise<FixedAsset[]>;
  getFixedAssetByCode(code: string): Promise<FixedAsset | undefined>;
  createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset>;
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

  // Locations
  async getAllLocations(): Promise<Location[]> {
    return await db.select().from(schema.locations);
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
  async getAllLedgerAccounts(): Promise<LedgerAccount[]> {
    return await db.select().from(schema.ledgerAccounts);
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
  async getAllEmployees(): Promise<Employee[]> {
    return await db.select().from(schema.employees);
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
  async getAllStockGroups(): Promise<StockGroup[]> {
    return await db.select().from(schema.stockGroups);
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
  async getAllStockItems(): Promise<StockItem[]> {
    return await db.select().from(schema.stockItems);
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
  async getAllBankAccounts(): Promise<BankAccount[]> {
    return await db.select().from(schema.bankAccounts);
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
  async getAllFixedAssets(): Promise<FixedAsset[]> {
    return await db.select().from(schema.fixedAssets);
  }

  async getFixedAssetByCode(code: string): Promise<FixedAsset | undefined> {
    const [asset] = await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.code, code));
    return asset;
  }

  async createFixedAsset(asset: InsertFixedAsset): Promise<FixedAsset> {
    const [created] = await db.insert(schema.fixedAssets).values(asset).returning();
    return created;
  }
}

export const storage = new DbStorage();
