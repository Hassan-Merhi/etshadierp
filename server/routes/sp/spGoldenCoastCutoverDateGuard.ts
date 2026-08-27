import type { Express, NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { spContainers, spOffloads, spPrepaidCharges, spSales } from "@shared/schema";
import { db } from "../../db";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import { getErrorMessage } from "../../lib/httpHandlers";
import { GOLDEN_COAST_PHASE3_CUTOVER_DATE } from "../../services/accounting/goldenCoastPhase3Cutover";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BUSINESS_DATE_FIELDS = [
  "saleDate",
  "offloadDate",
  "invoiceDate",
  "prepaidDate",
  "voucherDate",
  "paymentDate",
  "effectiveDate",
  "transactionDate",
] as const;

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function rejectPreCutover(res: Response, recordDate: string, source: string): void {
  res.status(409).json({
    code: "GC_PRE_CUTOVER_READ_ONLY",
    message: releaseDebtEnglish(
      `${source} dated ${recordDate} is before the Golden Coast cutover ${GOLDEN_COAST_PHASE3_CUTOVER_DATE} and is read-only.`
    ),
  });
}

async function existingRecordDate(req: Request, companyId: number): Promise<{ date: string; source: string } | null> {
  const path = req.path;
  let match = path.match(/^\/sales\/(\d+)/);
  if (match) {
    const [row] = await db
      .select({ date: spSales.saleDate })
      .from(spSales)
      .where(and(eq(spSales.id, Number(match[1])), eq(spSales.companyId, companyId)))
      .limit(1);
    return row?.date ? { date: String(row.date), source: "Supplier Partner sale" } : null;
  }

  match = path.match(/^\/offloads?\/(\d+)/);
  if (match) {
    const [row] = await db
      .select({ date: spOffloads.offloadDate })
      .from(spOffloads)
      .where(and(eq(spOffloads.id, Number(match[1])), eq(spOffloads.companyId, companyId)))
      .limit(1);
    return row?.date ? { date: String(row.date), source: "Supplier Partner offload" } : null;
  }

  match = path.match(/^\/containers\/(\d+)/);
  if (match) {
    const [row] = await db
      .select({ date: spContainers.invoiceDate })
      .from(spContainers)
      .where(and(eq(spContainers.id, Number(match[1])), eq(spContainers.companyId, companyId)))
      .limit(1);
    return row?.date ? { date: String(row.date), source: "Supplier Partner container" } : null;
  }

  match = path.match(/^\/prepaid(?:-charges)?\/(\d+)/);
  if (match) {
    const [row] = await db
      .select({ date: spPrepaidCharges.prepaidDate })
      .from(spPrepaidCharges)
      .where(and(eq(spPrepaidCharges.id, Number(match[1])), eq(spPrepaidCharges.companyId, companyId)))
      .limit(1);
    return row?.date ? { date: String(row.date), source: "Supplier Partner prepaid charge" } : null;
  }

  return null;
}

async function enforceCutoverDate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    for (const field of BUSINESS_DATE_FIELDS) {
      const value = dateOnly(req.body?.[field]);
      if (value && value < GOLDEN_COAST_PHASE3_CUTOVER_DATE) {
        rejectPreCutover(res, value, field);
        return;
      }
    }

    const companyId = Number(req.session.currentCompanyId);
    if (Number.isInteger(companyId) && companyId > 0) {
      const existing = await existingRecordDate(req, companyId);
      if (existing && existing.date < GOLDEN_COAST_PHASE3_CUTOVER_DATE) {
        rejectPreCutover(res, existing.date, existing.source);
        return;
      }
    }

    next();
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

export function registerSpGoldenCoastCutoverDateGuard(app: Express): void {
  app.use("/api/sp", (req, res, next) => {
    void enforceCutoverDate(req, res, next);
  });
}
