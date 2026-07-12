import express from "express";
import session from "express-session";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { pool } from "../server/db";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../shared/schema";

let testApp: express.Express;
let testServer: any;

export interface TestContext {
  app: express.Express;
  agent: any;
  companyId: number;
  locationId: number;
  location2Id: number;
  stockGroupId: number;
  stockItemIds: number[];
  userId: string;
  sessionCookie: string;
  salesAccountId: number;
  cashAccountId: number;
}

export async function setupTestApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      secret: "test-secret-key-for-integration-tests",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, maxAge: 60000 },
    }),
  );

  const server = await registerRoutes(app);
  testServer = server;
  testApp = app;
  return app;
}

export async function cleanupTestData(prefix: string): Promise<void> {
  const companies = await db
    .select()
    .from(schema.companies)
    .where(sql`${schema.companies.name} LIKE ${"%" + prefix + "%"}`);

  for (const company of companies) {
    await pool.query("DELETE FROM audit_log WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM login_history WHERE company_id = $1", [company.id]);
    await db
      .delete(schema.inventory)
      .where(eq(schema.inventory.companyId, company.id));
    await db
      .delete(schema.salesItems)
      .where(
        sql`${schema.salesItems.voucherId} IN (SELECT id FROM vouchers WHERE company_id = ${company.id})`,
      );
    await db
      .delete(schema.voucherEntries)
      .where(
        sql`${schema.voucherEntries.voucherId} IN (SELECT id FROM vouchers WHERE company_id = ${company.id})`,
      );
    await db
      .delete(schema.stockTransferItems)
      .where(
        sql`${schema.stockTransferItems.transferId} IN (SELECT stv.id FROM stock_transfer_vouchers stv JOIN vouchers v ON stv.voucher_id = v.id WHERE v.company_id = ${company.id})`,
      );
    await db
      .delete(schema.stockTransferVouchers)
      .where(
        sql`${schema.stockTransferVouchers.voucherId} IN (SELECT id FROM vouchers WHERE company_id = ${company.id})`,
      );
    await db
      .delete(schema.vouchers)
      .where(eq(schema.vouchers.companyId, company.id));
    await db
      .delete(schema.stockItems)
      .where(eq(schema.stockItems.companyId, company.id));
    await db
      .delete(schema.stockGroups)
      .where(eq(schema.stockGroups.companyId, company.id));
    await db
      .delete(schema.locations)
      .where(eq(schema.locations.companyId, company.id));
    await db
      .delete(schema.ledgerAccounts)
      .where(eq(schema.ledgerAccounts.companyId, company.id));
    await db
      .delete(schema.userCompanyRoles)
      .where(eq(schema.userCompanyRoles.companyId, company.id));
    await db
      .delete(schema.userLocations)
      .where(eq(schema.userLocations.companyId, company.id));

    // Authentication and audit middleware can finish asynchronously while a test
    // is tearing down. Clear any rows written after the initial cleanup before
    // deleting the company so the test-only fixture teardown remains deterministic.
    await pool.query("DELETE FROM audit_log WHERE company_id = $1", [company.id]);
    await pool.query("DELETE FROM login_history WHERE company_id = $1", [company.id]);
    await db.delete(schema.companies).where(eq(schema.companies.id, company.id));
  }

  const usersToDelete = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`${schema.users.username} LIKE ${"%" + prefix + "%"}`);

  for (const u of usersToDelete) {
    await pool.query("DELETE FROM login_history WHERE user_id = $1", [u.id]);
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
  }
}

export async function seedTestData(prefix: string): Promise<TestContext> {
  const app = await setupTestApp();

  await cleanupTestData(prefix);

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.hash("testpassword123", 10);

  const [user] = await db
    .insert(schema.users)
    .values({
      username: `${prefix}_testuser`,
      password: hashedPassword,
    })
    .returning();

  const companyCode = prefix.toUpperCase().slice(0, 8);
  const [company] = await db
    .insert(schema.companies)
    .values({
      code: companyCode,
      name: `${prefix}_TestCompany`,
      baseCurrency: "USD",
    })
    .returning();

  await db.insert(schema.userCompanyRoles).values({
    userId: user.id,
    companyId: company.id,
    role: "Admin",
  });

  const [location1] = await db
    .insert(schema.locations)
    .values({
      companyId: company.id,
      code: `${companyCode}-WH1`,
      name: `${prefix}_Warehouse1`,
    })
    .returning();

  const [location2] = await db
    .insert(schema.locations)
    .values({
      companyId: company.id,
      code: `${companyCode}-WH2`,
      name: `${prefix}_Warehouse2`,
    })
    .returning();

  const [stockGroup] = await db
    .insert(schema.stockGroups)
    .values({
      companyId: company.id,
      name: `${prefix}_TestGroup`,
      code: `T${prefix.slice(-2).toUpperCase()}`,
    })
    .returning();

  const stockItemIds: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const [item] = await db
      .insert(schema.stockItems)
      .values({
        companyId: company.id,
        code: `${prefix}-ITEM${i}`,
        name: `Test Item ${i}`,
        uom: "PCS",
        stockGroupId: stockGroup.id,
        active: true,
      })
      .returning();
    stockItemIds.push(item.id);
  }

  for (const stockItemId of stockItemIds) {
    await db.insert(schema.inventory).values({
      companyId: company.id,
      locationId: location1.id,
      stockItemId,
      quantity: "100.000",
      averageRate: "10.00",
      totalValue: "1000.00",
    });
  }

  const [salesAccount] = await db
    .insert(schema.ledgerAccounts)
    .values({
      companyId: company.id,
      code: `${prefix}_SALES`,
      name: "Sales Revenue",
      accountType: "Income",
      subType: "Sales",
      openingBalance: "0",
      openingBalanceSide: "Cr",
    })
    .returning();

  const [cashAccount] = await db
    .insert(schema.ledgerAccounts)
    .values({
      companyId: company.id,
      code: `${prefix}_CASH`,
      name: "Cash Account",
      accountType: "Cash",
      subType: "Cash",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    })
    .returning();

  return {
    app,
    agent: null,
    companyId: company.id,
    locationId: location1.id,
    location2Id: location2.id,
    stockGroupId: stockGroup.id,
    stockItemIds,
    userId: user.id,
    sessionCookie: "",
    salesAccountId: salesAccount.id,
    cashAccountId: cashAccount.id,
  };
}

export async function getInventoryQty(
  locationId: number,
  stockItemId: number,
): Promise<number> {
  const [inv] = await db
    .select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.stockItemId, stockItemId),
      ),
    )
    .limit(1);
  return inv ? parseFloat(inv.quantity) : 0;
}

export async function getInventoryRecord(
  locationId: number,
  stockItemId: number,
) {
  const [inv] = await db
    .select()
    .from(schema.inventory)
    .where(
      and(
        eq(schema.inventory.locationId, locationId),
        eq(schema.inventory.stockItemId, stockItemId),
      ),
    )
    .limit(1);
  return inv;
}

export function closeTestServer(): void {
  if (testServer) {
    testServer.close();
  }
}
