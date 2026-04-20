import { db } from "../../db";
import {
  factoryFxRates,
  factoryDaybookEntries,
  ledgerAccounts,
  companies,
  customerOrderBales,
  customerOrderLines,
  customerOrderCharges,
  customerOrders,
  factoryUserProfiles,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";

export async function writeDaybookEntry(dbOrTx: any, opts: {
  companyId: number;
  txDate: string;
  txType: string;
  referenceId?: number;
  referenceTable?: string;
  description: string;
  metaJson?: string;
  currencyCode?: string;
  amountCurrency?: number;
  fxRateToUsd?: number;
  amountUsd?: number;
  createdBy?: string | null;
}) {
  const currency = opts.currencyCode || "USD";
  const fxRate = opts.fxRateToUsd || 1;
  const amtCurrency = opts.amountCurrency || 0;
  const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
  await dbOrTx.insert(factoryDaybookEntries).values({
    companyId: opts.companyId,
    txDate: opts.txDate,
    txType: opts.txType,
    referenceId: opts.referenceId || null,
    referenceTable: opts.referenceTable || null,
    description: opts.description,
    metaJson: opts.metaJson || null,
    currencyCode: currency,
    amountCurrency: String(amtCurrency),
    fxRateToUsd: String(fxRate),
    amountUsd: String(amtUsd),
    createdBy: opts.createdBy || null,
  });
}

export async function getOrFetchFxRateToUsd(companyId: number, currencyCode: string, dateISO: string): Promise<string> {
  if (currencyCode === "USD") return "1";

  const [existing] = await db
    .select()
    .from(factoryFxRates)
    .where(and(
      eq(factoryFxRates.companyId, companyId),
      eq(factoryFxRates.currencyCode, currencyCode.toUpperCase()),
      eq(factoryFxRates.effectiveDate, dateISO)
    ))
    .limit(1);

  if (existing) return existing.rateToUsd;

  try {
    const response = await fetch(`https://api.frankfurter.app/${dateISO}?from=${currencyCode.toUpperCase()}&to=USD`);
    if (!response.ok) throw new Error(`FX API returned ${response.status}`);
    const data = await response.json();
    const rate = data?.rates?.USD;
    if (!rate || isNaN(rate)) throw new Error("Invalid rate from FX API");

    const rateStr = String(rate);
    await db.insert(factoryFxRates).values({
      companyId,
      currencyCode: currencyCode.toUpperCase(),
      rateToUsd: rateStr,
      effectiveDate: dateISO,
    });

    return rateStr;
  } catch (err: any) {
    const [fallback] = await db
      .select()
      .from(factoryFxRates)
      .where(and(
        eq(factoryFxRates.companyId, companyId),
        eq(factoryFxRates.currencyCode, currencyCode.toUpperCase())
      ))
      .orderBy(desc(factoryFxRates.effectiveDate))
      .limit(1);

    if (fallback) return fallback.rateToUsd;
    throw new Error(`No FX rate available for ${dateISO}/${currencyCode}. External API error: ${err.message}`);
  }
}

export async function getOrCreateLedgerAccount(
  companyId: number,
  code: string,
  name: string,
  accountType: string = "EXPENSE"
): Promise<number> {
  const safeCode = code.slice(0, 50);
  const [existing] = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, safeCode)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(ledgerAccounts).values({
    companyId,
    code: safeCode,
    name,
    accountType,
    active: true,
    isHidden: false,
  }).returning({ id: ledgerAccounts.id });
  return created.id;
}

export function isLegacySHA256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

export async function verifySupervisorPassword(password: string, hash: string): Promise<boolean> {
  if (isLegacySHA256Hash(hash)) {
    return CryptoJS.SHA256(password).toString().toLowerCase() === hash.toLowerCase();
  }
  return bcrypt.compare(password, hash);
}

export async function recalculateOrderTotals(dbConn: any, orderId: number) {
  const bales = await dbConn.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

  await dbConn.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

  const grouped: Record<string, { articleCode: string; baleName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
  for (const b of bales) {
    const key = b.articleCode || 'UNKNOWN';
    if (!grouped[key]) {
      grouped[key] = { articleCode: key, baleName: b.baleName || key, qty: 0, totalWeight: 0, totalPrice: 0 };
    }
    grouped[key].qty += 1;
    grouped[key].totalWeight += parseFloat(b.weight);
    grouped[key].totalPrice += parseFloat(b.priceUsed);
  }

  for (const line of Object.values(grouped)) {
    await dbConn.insert(customerOrderLines).values({
      orderId,
      articleCode: line.articleCode,
      baleName: line.baleName,
      qty: line.qty,
      weightPerBale: String(line.qty > 0 ? line.totalWeight / line.qty : 0),
      totalWeight: String(line.totalWeight),
      pricePerBale: String(line.qty > 0 ? line.totalPrice / line.qty : 0),
      totalPrice: String(line.totalPrice),
    });
  }

  const charges = await dbConn.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
  const freightAmount = charges.filter((c: any) => c.chargeType === 'FREIGHT').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
  const otherChargesTotal = charges.filter((c: any) => c.chargeType === 'OTHER').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
  const subtotalBales = bales.reduce((sum: number, b: any) => sum + parseFloat(b.priceUsed), 0);
  const grandTotal = subtotalBales + freightAmount + otherChargesTotal;

  await dbConn.update(customerOrders).set({
    subtotalBales: String(subtotalBales),
    freightAmount: String(freightAmount),
    otherChargesTotal: String(otherChargesTotal),
    grandTotal: String(grandTotal),
    totalQtyBales: bales.length,
    updatedAt: new Date(),
  }).where(eq(customerOrders.id, orderId));
}

/**
 * Returns true if the logged-in user has "hideAllCosts" enabled.
 * Admins and owners always return false (they always see costs).
 */
export async function getUserHideAllCosts(req: any): Promise<boolean> {
  try {
    const userId = req.session?.userId;
    if (!userId) return false;
    const role = req.session?.currentRole?.toLowerCase?.();
    if (role === "admin" || role === "owner") return false;
    const [profile] = await db
      .select({ hideAllCosts: factoryUserProfiles.hideAllCosts })
      .from(factoryUserProfiles)
      .where(eq(factoryUserProfiles.userId, userId))
      .limit(1);
    return profile?.hideAllCosts ?? false;
  } catch {
    return false;
  }
}
