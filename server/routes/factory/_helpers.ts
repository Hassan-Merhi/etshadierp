import { db } from "../../db";
import {
  factoryFxRates,
  factoryDaybookEntries,
  ledgerAccounts,
  companies,
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
