import type { Express } from "express";
import { db } from "../db";
import { requireAuth } from "../auth";
import { upload, logAudit } from "./_helpers";
import { readExcel, sheetToJson } from "../excelHelper";
import {
  aiImportJobs,
  aiImportRows,
  aiCorrectionMemory,
  stockItems,
  stockGroups,
  customers,
  suppliers,
  ledgerAccounts,
} from "@shared/schema";
import { eq, and, inArray, isNull, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertJobOwnership(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(aiImportJobs)
    .where(and(eq(aiImportJobs.id, jobId), eq(aiImportJobs.companyId, companyId)));
  if (!job) throw Object.assign(new Error("Import job not found"), { status: 404 });
  return job;
}

/**
 * Upsert a correction entry into aiCorrectionMemory.
 * If an entry for (companyId, memoryType, rawValue) already exists it is updated;
 * otherwise a new row is inserted. Case-insensitive match on rawValue.
 * Only confidence=100 corrections are auto-applied during future validation runs.
 */
async function upsertCorrection(params: {
  companyId: number;
  userId: string;
  memoryType: string;
  rawValue: string;
  resolvedId: number | null;
  resolvedValue: string | null;
  resolvedType: string | null;
  confidence?: number;
}): Promise<void> {
  const {
    companyId, userId, memoryType, rawValue,
    resolvedId, resolvedValue, resolvedType,
    confidence = 100,
  } = params;

  const [existing] = await db
    .select({ id: aiCorrectionMemory.id })
    .from(aiCorrectionMemory)
    .where(and(
      eq(aiCorrectionMemory.companyId, companyId),
      eq(aiCorrectionMemory.memoryType, memoryType),
      sql`LOWER(${aiCorrectionMemory.rawValue}) = LOWER(${rawValue})`,
    ))
    .limit(1);

  if (existing) {
    await db.update(aiCorrectionMemory)
      .set({ resolvedId, resolvedValue, resolvedType, confidence, updatedAt: new Date() })
      .where(eq(aiCorrectionMemory.id, existing.id));
  } else {
    await db.insert(aiCorrectionMemory).values({
      companyId, memoryType, rawValue,
      resolvedId, resolvedValue, resolvedType,
      confidence, createdBy: userId,
    });
  }
}

// ─── Per-type validators ──────────────────────────────────────────────────────

async function validateRows(
  companyId: number,
  importType: string,
  rows: { id: number; rowNumber: number; rawData: any }[],
): Promise<{
  id: number;
  status: "valid" | "warning" | "error";
  mappedData: any;
  errors: string[];
  warnings: string[];
}[]> {
  switch (importType) {
    case "stock_items":
      return validateStockItemRows(companyId, rows);
    case "customers":
      return validateCustomerRows(companyId, rows);
    case "suppliers":
      return validateSupplierRows(companyId, rows);
    case "vouchers":
      return validateVoucherRows(companyId, rows);
    default:
      return validateGenericRows(rows);
  }
}

async function validateStockItemRows(
  companyId: number,
  rows: { id: number; rowNumber: number; rawData: any }[],
) {
  // Pre-fetch lookup data (including correction memory for stock-group aliases)
  const [existingCodes, groups, itemCorrections] = await Promise.all([
    db.select({ code: stockItems.code })
      .from(stockItems)
      .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true), isNull(stockItems.deletedAt))),
    db.select({ id: stockGroups.id, name: stockGroups.name, code: stockGroups.code })
      .from(stockGroups)
      .where(eq(stockGroups.companyId, companyId)),
    db.select()
      .from(aiCorrectionMemory)
      .where(and(
        eq(aiCorrectionMemory.companyId, companyId),
        eq(aiCorrectionMemory.memoryType, "item_alias"),
        sql`${aiCorrectionMemory.confidence} >= 100`,
      )),
  ]);

  const existingCodeSet = new Set(existingCodes.map(r => (r.code || "").toLowerCase()));
  const groupByCode = new Map(groups.map(g => [g.code?.toLowerCase() ?? "", g]));
  const groupByName = new Map(groups.map(g => [g.name?.toLowerCase() ?? "", g]));
  // rawValue.toLowerCase() → correction (exact remembered matches only)
  const itemCorrMap = new Map(itemCorrections.map(c => [c.rawValue.toLowerCase(), c]));

  // Track codes introduced within this batch (to catch intra-batch duplicates)
  const batchCodes = new Set<string>();

  return rows.map(row => {
    const raw = row.rawData as Record<string, any>;
    const errors: string[] = [];
    const warnings: string[] = [];
    const mapped: Record<string, any> = {};

    // name
    const name = String(raw.name ?? raw.Name ?? raw["Item Name"] ?? "").trim();
    if (!name) errors.push("name is required");
    mapped.name = name;

    // code
    const code = String(raw.code ?? raw.Code ?? raw["Item Code"] ?? "").trim();
    if (!code) {
      warnings.push("code is missing — will be auto-generated on post");
    } else {
      const lower = code.toLowerCase();
      if (existingCodeSet.has(lower)) errors.push(`code "${code}" already exists`);
      else if (batchCodes.has(lower)) errors.push(`code "${code}" is duplicated within this import`);
      else batchCodes.add(lower);
    }
    mapped.code = code || null;

    // sellingPrice
    const sellingPrice = parseFloat(raw.sellingPrice ?? raw["Selling Price"] ?? raw.price ?? 0);
    if (isNaN(sellingPrice) || sellingPrice < 0) errors.push("sellingPrice must be a non-negative number");
    mapped.sellingPrice = isNaN(sellingPrice) ? "0" : sellingPrice.toFixed(2);

    // reorderLevel
    const reorderLevel = parseFloat(raw.reorderLevel ?? raw["Reorder Level"] ?? raw.reorder ?? 0);
    mapped.reorderLevel = isNaN(reorderLevel) ? "0" : reorderLevel.toFixed(2);

    // stockGroup — check correction memory first, then fall back to name/code match
    const groupRef = String(raw.stockGroupCode ?? raw.stockGroup ?? raw["Stock Group"] ?? "").trim();
    let stockGroupId: number | null = null;
    if (groupRef) {
      const corr = itemCorrMap.get(groupRef.toLowerCase());
      if (corr?.resolvedId != null) {
        // Exact remembered correction — apply silently (no warning)
        stockGroupId = corr.resolvedId;
      } else {
        const found = groupByCode.get(groupRef.toLowerCase()) ?? groupByName.get(groupRef.toLowerCase());
        if (!found) warnings.push(`stock group "${groupRef}" not found — item will be ungrouped`);
        else stockGroupId = found.id;
      }
    }
    mapped.stockGroupId = stockGroupId;

    const status: "valid" | "warning" | "error" =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";

    return { id: row.id, status, mappedData: mapped, errors, warnings };
  });
}

async function validateCustomerRows(
  companyId: number,
  rows: { id: number; rowNumber: number; rawData: any }[],
) {
  const existingCodes = await db
    .select({ code: customers.code })
    .from(customers)
    .where(and(eq(customers.companyId, companyId), isNull(customers.deletedAt)));
  const existingCodeSet = new Set(existingCodes.map(r => (r.code || "").toLowerCase()));
  const batchCodes = new Set<string>();

  return rows.map(row => {
    const raw = row.rawData as Record<string, any>;
    const errors: string[] = [];
    const warnings: string[] = [];
    const mapped: Record<string, any> = {};

    const name = String(raw.name ?? raw.Name ?? raw["Customer Name"] ?? "").trim();
    if (!name) errors.push("name is required");
    mapped.name = name;
    mapped.legalName = String(raw.legalName ?? raw["Legal Name"] ?? name).trim();

    const code = String(raw.code ?? raw.Code ?? "").trim();
    if (code) {
      const lower = code.toLowerCase();
      if (existingCodeSet.has(lower)) errors.push(`code "${code}" already exists`);
      else if (batchCodes.has(lower)) errors.push(`code "${code}" duplicated within this import`);
      else batchCodes.add(lower);
    }
    mapped.code = code || null;
    mapped.phone = String(raw.phone ?? raw.Phone ?? "").trim() || null;
    mapped.email = String(raw.email ?? raw.Email ?? "").trim() || null;

    const status: "valid" | "warning" | "error" =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    return { id: row.id, status, mappedData: mapped, errors, warnings };
  });
}

async function validateSupplierRows(
  companyId: number,
  rows: { id: number; rowNumber: number; rawData: any }[],
) {
  const existingCodes = await db
    .select({ code: suppliers.code })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt)));
  const existingCodeSet = new Set(existingCodes.map(r => (r.code || "").toLowerCase()));
  const batchCodes = new Set<string>();

  return rows.map(row => {
    const raw = row.rawData as Record<string, any>;
    const errors: string[] = [];
    const warnings: string[] = [];
    const mapped: Record<string, any> = {};

    const legalName = String(raw.legalName ?? raw["Legal Name"] ?? raw.name ?? raw.Name ?? "").trim();
    if (!legalName) errors.push("legalName is required");
    mapped.legalName = legalName;

    const code = String(raw.code ?? raw.Code ?? "").trim();
    if (code) {
      const lower = code.toLowerCase();
      if (existingCodeSet.has(lower)) errors.push(`code "${code}" already exists`);
      else if (batchCodes.has(lower)) errors.push(`code "${code}" duplicated within this import`);
      else batchCodes.add(lower);
    }
    mapped.code = code || null;
    mapped.phone = String(raw.phone ?? raw.Phone ?? "").trim() || null;
    mapped.email = String(raw.email ?? raw.Email ?? "").trim() || null;
    mapped.openingBalance = String(parseFloat(raw.openingBalance ?? raw["Opening Balance"] ?? "0") || 0);

    const status: "valid" | "warning" | "error" =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    return { id: row.id, status, mappedData: mapped, errors, warnings };
  });
}

async function validateVoucherRows(
  companyId: number,
  rows: { id: number; rowNumber: number; rawData: any }[],
) {
  const [accounts, ledgerCorrections] = await Promise.all([
    db.select({ id: ledgerAccounts.id, name: ledgerAccounts.name, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.active, true), isNull(ledgerAccounts.deletedAt))),
    db.select()
      .from(aiCorrectionMemory)
      .where(and(
        eq(aiCorrectionMemory.companyId, companyId),
        eq(aiCorrectionMemory.memoryType, "ledger_alias"),
        sql`${aiCorrectionMemory.confidence} >= 100`,
      )),
  ]);
  const acctByCode = new Map(accounts.map(a => [a.code?.toLowerCase() ?? "", a]));
  const acctByName = new Map(accounts.map(a => [a.name?.toLowerCase() ?? "", a]));
  const acctById   = new Map(accounts.map(a => [a.id, a]));
  // rawValue.toLowerCase() → correction (exact remembered ledger-account aliases)
  const ledgerCorrMap = new Map(ledgerCorrections.map(c => [c.rawValue.toLowerCase(), c]));

  return rows.map(row => {
    const raw = row.rawData as Record<string, any>;
    const errors: string[] = [];
    const warnings: string[] = [];
    const mapped: Record<string, any> = {};

    // date
    const rawDate = String(raw.date ?? raw.Date ?? raw["Voucher Date"] ?? "").trim();
    if (!rawDate) errors.push("date is required");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) errors.push(`date "${rawDate}" must be YYYY-MM-DD`);
    mapped.voucherDate = rawDate;

    // type
    const voucherType = String(raw.type ?? raw.Type ?? raw["Voucher Type"] ?? "").trim();
    if (!["Payment", "Receipt", "Journal"].includes(voucherType))
      errors.push(`type must be Payment, Receipt, or Journal — got "${voucherType}"`);
    mapped.voucherType = voucherType;

    mapped.description = String(raw.description ?? raw.Description ?? raw.narration ?? "").trim();

    // debit/credit accounts
    const debitRef  = String(raw.debitAccount  ?? raw["Debit Account"]  ?? "").trim();
    const creditRef = String(raw.creditAccount ?? raw["Credit Account"] ?? "").trim();

    if (!debitRef)  errors.push("debitAccount is required");
    if (!creditRef) errors.push("creditAccount is required");

    // Resolve debit account — correction memory wins over name/code lookup
    function resolveAccount(ref: string): { id: number; name: string } | null {
      if (!ref) return null;
      const lo = ref.toLowerCase();
      const corr = ledgerCorrMap.get(lo);
      if (corr?.resolvedId != null) {
        return acctById.get(corr.resolvedId) ?? { id: corr.resolvedId, name: corr.resolvedValue ?? ref };
      }
      return acctByCode.get(lo) ?? acctByName.get(lo) ?? null;
    }

    const debitAcct  = debitRef  ? resolveAccount(debitRef)  : null;
    const creditAcct = creditRef ? resolveAccount(creditRef) : null;

    if (debitRef  && !debitAcct)  errors.push(`debit account "${debitRef}" not found`);
    if (creditRef && !creditAcct) errors.push(`credit account "${creditRef}" not found`);

    mapped.debitAccountId  = debitAcct?.id  ?? null;
    mapped.creditAccountId = creditAcct?.id ?? null;

    const amount = parseFloat(raw.amount ?? raw.Amount ?? 0);
    if (isNaN(amount) || amount <= 0) errors.push("amount must be a positive number");
    mapped.amount = isNaN(amount) ? "0" : amount.toFixed(2);

    const status: "valid" | "warning" | "error" =
      errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    return { id: row.id, status, mappedData: mapped, errors, warnings };
  });
}

function validateGenericRows(rows: { id: number; rowNumber: number; rawData: any }[]) {
  return rows.map(row => ({
    id: row.id,
    status: "valid" as const,
    mappedData: row.rawData,
    errors: [] as string[],
    warnings: ["importType not recognized — no validation applied"] as string[],
  }));
}

// ─── Per-type posters ─────────────────────────────────────────────────────────

async function postRows(
  companyId: number,
  userId: string,
  username: string,
  importType: string,
  rows: { id: number; mappedData: any }[],
  tx: typeof db,
): Promise<{ rowId: number; recordType: string; recordId: number }[]> {
  switch (importType) {
    case "stock_items":   return postStockItemRows(companyId, userId, username, rows, tx);
    case "customers":     return postCustomerRows(companyId, userId, username, rows, tx);
    case "suppliers":     return postSupplierRows(companyId, userId, username, rows, tx);
    default:
      return [];
  }
}

async function postStockItemRows(
  companyId: number,
  userId: string,
  username: string,
  rows: { id: number; mappedData: any }[],
  tx: typeof db,
) {
  const results: { rowId: number; recordType: string; recordId: number }[] = [];
  for (const row of rows) {
    const d = row.mappedData as Record<string, any>;
    const [created] = await tx
      .insert(stockItems)
      .values({
        companyId,
        name: d.name,
        code: d.code ?? null,
        sellingPrice: d.sellingPrice ?? "0",
        reorderLevel: d.reorderLevel ?? "0",
        stockGroupId: d.stockGroupId ?? null,
        active: true,
      } as any)
      .returning({ id: stockItems.id });

    await logAudit({
      userId,
      username,
      companyId,
      action: "create",
      tableName: "stock_items",
      recordId: created.id,
      recordIdentifier: d.code || d.name,
      changes: null,
    });

    results.push({ rowId: row.id, recordType: "stock_item", recordId: created.id });
  }
  return results;
}

async function postCustomerRows(
  companyId: number,
  userId: string,
  username: string,
  rows: { id: number; mappedData: any }[],
  tx: typeof db,
) {
  const results: { rowId: number; recordType: string; recordId: number }[] = [];
  for (const row of rows) {
    const d = row.mappedData as Record<string, any>;
    const [created] = await tx
      .insert(customers)
      .values({
        companyId,
        name: d.name,
        legalName: d.legalName,
        code: d.code ?? null,
        phone: d.phone ?? null,
        email: d.email ?? null,
        active: true,
      } as any)
      .returning({ id: customers.id });

    await logAudit({
      userId,
      username,
      companyId,
      action: "create",
      tableName: "customers",
      recordId: created.id,
      recordIdentifier: d.code || d.name,
      changes: null,
    });

    results.push({ rowId: row.id, recordType: "customer", recordId: created.id });
  }
  return results;
}

async function postSupplierRows(
  companyId: number,
  userId: string,
  username: string,
  rows: { id: number; mappedData: any }[],
  tx: typeof db,
) {
  const results: { rowId: number; recordType: string; recordId: number }[] = [];
  for (const row of rows) {
    const d = row.mappedData as Record<string, any>;
    const [created] = await tx
      .insert(suppliers)
      .values({
        companyId,
        legalName: d.legalName,
        code: d.code ?? null,
        phone: d.phone ?? null,
        email: d.email ?? null,
        openingBalance: d.openingBalance ?? "0",
        active: true,
      } as any)
      .returning({ id: suppliers.id });

    await logAudit({
      userId,
      username,
      companyId,
      action: "create",
      tableName: "suppliers",
      recordId: created.id,
      recordIdentifier: d.code || d.legalName,
      changes: null,
    });

    results.push({ rowId: row.id, recordType: "supplier", recordId: created.id });
  }
  return results;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerAiImportRoutes(app: Express) {
  // POST /api/ai-import/upload
  // Parse Excel, stage rows — does NOT insert business records
  app.post("/api/ai-import/upload", requireAuth, upload.single("file"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId    = req.session.userId;
      const username  = req.session.username || "Unknown";

      if (!companyId || !userId) return res.status(400).json({ message: "No company selected" });
      if (!req.file)             return res.status(400).json({ message: "No file uploaded" });

      const importType = String(req.body.importType ?? "").trim();
      if (!importType) return res.status(400).json({ message: "importType is required" });

      const SUPPORTED = ["stock_items", "customers", "suppliers", "vouchers"];
      if (!SUPPORTED.includes(importType))
        return res.status(400).json({ message: `importType must be one of: ${SUPPORTED.join(", ")}` });

      // Parse the Excel file
      const workbook  = readExcel(req.file.buffer);
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) return res.status(400).json({ message: "Excel file has no sheets" });

      const rawRows: Record<string, any>[] = sheetToJson(workbook.Sheets[sheetName]);
      if (!rawRows.length) return res.status(400).json({ message: "Excel file has no data rows" });

      // Create the job
      const [job] = await db
        .insert(aiImportJobs)
        .values({
          companyId,
          userId,
          importType,
          originalFileName: req.file.originalname,
          status: "uploaded",
          totalRows: rawRows.length,
          validRows: 0,
          warningRows: 0,
          errorRows: 0,
        })
        .returning();

      // Stage all rows as 'pending' — no validation yet
      const rowValues = rawRows.map((raw, i) => ({
        jobId: job.id,
        rowNumber: i + 1,
        rawData: raw,
        status: "pending",
        errors: [],
        warnings: [],
      }));

      await db.insert(aiImportRows).values(rowValues as any);

      res.json({
        jobId: job.id,
        importType,
        originalFileName: job.originalFileName,
        totalRows: rawRows.length,
        status: "uploaded",
        message: `${rawRows.length} rows staged. Call /validate to check them.`,
      });
    } catch (error: any) {
      console.error("[AI Import] upload error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/ai-import/jobs/:id
  app.get("/api/ai-import/jobs/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job id" });

      const job = await assertJobOwnership(jobId, companyId);
      res.json(job);
    } catch (error: any) {
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });

  // GET /api/ai-import/jobs/:id/rows
  app.get("/api/ai-import/jobs/:id/rows", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job id" });

      await assertJobOwnership(jobId, companyId);

      const statusFilter = req.query.status as string | undefined;
      const rows = await db
        .select()
        .from(aiImportRows)
        .where(
          statusFilter
            ? and(eq(aiImportRows.jobId, jobId), eq(aiImportRows.status, statusFilter))
            : eq(aiImportRows.jobId, jobId)
        )
        .orderBy(aiImportRows.rowNumber);

      res.json(rows);
    } catch (error: any) {
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });

  // POST /api/ai-import/jobs/:id/validate
  // Checks rows against ERP tables; updates status/errors/warnings; recalculates counts
  app.post("/api/ai-import/jobs/:id/validate", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job id" });

      const job = await assertJobOwnership(jobId, companyId);

      if (job.status === "posted")
        return res.status(409).json({ message: "Job is already posted" });

      // Load all rows
      const rows = await db
        .select({ id: aiImportRows.id, rowNumber: aiImportRows.rowNumber, rawData: aiImportRows.rawData })
        .from(aiImportRows)
        .where(eq(aiImportRows.jobId, jobId))
        .orderBy(aiImportRows.rowNumber);

      if (!rows.length) return res.status(400).json({ message: "Job has no rows" });

      // Validate (type-specific)
      const results = await validateRows(companyId, job.importType, rows);

      // Persist results
      for (const r of results) {
        await db
          .update(aiImportRows)
          .set({
            status:     r.status,
            mappedData: r.mappedData,
            errors:     r.errors,
            warnings:   r.warnings,
          })
          .where(eq(aiImportRows.id, r.id));
      }

      const validRows   = results.filter(r => r.status === "valid").length;
      const warningRows = results.filter(r => r.status === "warning").length;
      const errorRows   = results.filter(r => r.status === "error").length;

      await db
        .update(aiImportJobs)
        .set({
          status:      errorRows > 0 ? "has_errors" : "validated",
          validRows,
          warningRows,
          errorRows,
          updatedAt:   new Date(),
        })
        .where(eq(aiImportJobs.id, jobId));

      res.json({
        jobId,
        totalRows:   rows.length,
        validRows,
        warningRows,
        errorRows,
        status:      errorRows > 0 ? "has_errors" : "validated",
        canConfirm:  errorRows === 0,
        message:     errorRows > 0
          ? `${errorRows} row(s) have errors that must be fixed before confirming.`
          : `All rows valid. Call /confirm to proceed.`,
      });
    } catch (error: any) {
      console.error("[AI Import] validate error:", error.message);
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });

  // POST /api/ai-import/jobs/:id/confirm
  // Locks the job for posting; only works when errorRows = 0
  app.post("/api/ai-import/jobs/:id/confirm", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job id" });

      const job = await assertJobOwnership(jobId, companyId);

      if (job.status === "posted")
        return res.status(409).json({ message: "Job is already posted" });
      if (job.status === "staged")
        return res.status(409).json({ message: "Job is already confirmed" });
      if (!["validated"].includes(job.status))
        return res.status(409).json({ message: "Job must be validated before confirming" });
      if ((job.errorRows ?? 0) > 0)
        return res.status(409).json({ message: `Cannot confirm: ${job.errorRows} row(s) still have errors` });

      await db
        .update(aiImportJobs)
        .set({ status: "staged", confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiImportJobs.id, jobId));

      res.json({
        jobId,
        status:     "staged",
        validRows:  job.validRows,
        warningRows: job.warningRows,
        message:    "Job confirmed. Call /post to create the records.",
      });
    } catch (error: any) {
      console.error("[AI Import] confirm error:", error.message);
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });

  // PATCH /api/ai-import/rows/:rowId
  // Save user corrections for one import row and re-validate it using correction memory.
  // Body: {
  //   mappedData?:  any                 — optional full override merged on top of re-validated data
  //   corrections:  Array<{             — list of entity resolutions to remember
  //     memoryType:    string,          — 'item_alias' | 'ledger_alias' | 'supplier_alias' | ...
  //     rawValue:      string,          — original cell value from the Excel file
  //     resolvedId:    number | null,   — ERP record id
  //     resolvedValue: string,          — canonical display name / code
  //     resolvedType:  string,          — e.g. 'stock_group', 'ledger_account'
  //     confidence?:   number           — default 100; only >=100 are auto-applied
  //   }>
  // }
  app.patch("/api/ai-import/rows/:rowId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId    = req.session.userId;
      if (!companyId || !userId) return res.status(400).json({ message: "No company selected" });

      const rowId = parseInt(req.params.rowId);
      if (isNaN(rowId)) return res.status(400).json({ message: "Invalid row id" });

      // Load row + verify job ownership
      const [row] = await db
        .select({
          id:        aiImportRows.id,
          jobId:     aiImportRows.jobId,
          rowNumber: aiImportRows.rowNumber,
          rawData:   aiImportRows.rawData,
        })
        .from(aiImportRows)
        .where(eq(aiImportRows.id, rowId));

      if (!row) return res.status(404).json({ message: "Row not found" });

      const job = await assertJobOwnership(row.jobId, companyId);
      if (job.status === "posted")
        return res.status(409).json({ message: "Job is already posted" });

      const { corrections = [], mappedData: overrideMappedData } = req.body;

      // Persist all corrections (upsert — case-insensitive match on rawValue)
      for (const c of corrections) {
        if (!c.memoryType || c.rawValue == null) continue;
        await upsertCorrection({
          companyId,
          userId,
          memoryType:    String(c.memoryType),
          rawValue:      String(c.rawValue),
          resolvedId:    c.resolvedId   ?? null,
          resolvedValue: c.resolvedValue ?? null,
          resolvedType:  c.resolvedType  ?? null,
          confidence:    typeof c.confidence === "number" ? c.confidence : 100,
        });
      }

      // Re-validate this row from rawData — correction memory now has the fix applied,
      // so entity references will resolve automatically.
      const [result] = await validateRows(companyId, job.importType, [{
        id:        row.id,
        rowNumber: row.rowNumber,
        rawData:   row.rawData,
      }]);

      // If caller also sent an explicit mappedData override, merge it on top.
      // This lets the frontend override freeform text fields (name, code, etc.)
      // that rawData-based re-validation cannot infer.
      const finalMappedData = overrideMappedData != null
        ? { ...(result.mappedData ?? {}), ...overrideMappedData }
        : result.mappedData;

      await db
        .update(aiImportRows)
        .set({
          status:     result.status,
          mappedData: finalMappedData,
          errors:     result.errors,
          warnings:   result.warnings,
        })
        .where(eq(aiImportRows.id, rowId));

      res.json({
        id:                  rowId,
        status:              result.status,
        mappedData:          finalMappedData,
        errors:              result.errors,
        warnings:            result.warnings,
        correctionsApplied:  corrections.length,
      });
    } catch (error: any) {
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });

  // GET /api/ai-import/corrections
  // List all correction memory entries for the current company.
  // Optional query param: ?memoryType=item_alias
  app.get("/api/ai-import/corrections", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const memoryTypeFilter = req.query.memoryType as string | undefined;

      const rows = await db
        .select()
        .from(aiCorrectionMemory)
        .where(
          memoryTypeFilter
            ? and(
                eq(aiCorrectionMemory.companyId, companyId),
                eq(aiCorrectionMemory.memoryType, memoryTypeFilter),
              )
            : eq(aiCorrectionMemory.companyId, companyId),
        )
        .orderBy(aiCorrectionMemory.memoryType, aiCorrectionMemory.rawValue);

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/ai-import/corrections/:id
  // Remove a specific correction so the validator falls back to fuzzy matching.
  app.delete("/api/ai-import/corrections/:id", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const corrId = parseInt(req.params.id);
      if (isNaN(corrId)) return res.status(400).json({ message: "Invalid id" });

      const [existing] = await db
        .select({ id: aiCorrectionMemory.id, companyId: aiCorrectionMemory.companyId })
        .from(aiCorrectionMemory)
        .where(eq(aiCorrectionMemory.id, corrId));

      if (!existing) return res.status(404).json({ message: "Correction not found" });
      if (existing.companyId !== companyId)
        return res.status(403).json({ message: "Forbidden" });

      await db.delete(aiCorrectionMemory).where(eq(aiCorrectionMemory.id, corrId));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/ai-import/jobs/:id/post
  // Creates business records in a transaction; writes audit log; marks job posted
  app.post("/api/ai-import/jobs/:id/post", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      const userId    = req.session.userId;
      const username  = req.session.username || "Unknown";

      if (!companyId || !userId) return res.status(400).json({ message: "No company selected" });

      const jobId = parseInt(req.params.id);
      if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job id" });

      const job = await assertJobOwnership(jobId, companyId);

      if (job.status === "posted")
        return res.status(409).json({ message: "Job is already posted" });
      if (job.status !== "staged")
        return res.status(409).json({ message: "Job must be confirmed before posting" });

      // Load valid/warning rows only
      const rows = await db
        .select({ id: aiImportRows.id, mappedData: aiImportRows.mappedData, status: aiImportRows.status })
        .from(aiImportRows)
        .where(and(
          eq(aiImportRows.jobId, jobId),
          sql`${aiImportRows.status} IN ('valid', 'warning')`,
        ))
        .orderBy(aiImportRows.rowNumber);

      if (!rows.length)
        return res.status(400).json({ message: "No valid rows to post" });

      const rowsToPost = rows.map(r => ({ id: r.id, mappedData: r.mappedData as any }));

      // Run everything in a single transaction
      const created = await db.transaction(async (tx) => {
        const results = await postRows(companyId, userId, username, job.importType, rowsToPost, tx as any);

        // Update each row with the created record info
        for (const r of results) {
          await tx
            .update(aiImportRows)
            .set({
              status:            "posted",
              createdRecordType: r.recordType,
              createdRecordId:   r.recordId,
            })
            .where(eq(aiImportRows.id, r.rowId));
        }

        return results;
      });

      // Mark job as posted outside the transaction (no rollback needed)
      await db
        .update(aiImportJobs)
        .set({ status: "posted", postedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiImportJobs.id, jobId));

      res.json({
        jobId,
        status:       "posted",
        recordsCreated: created.length,
        records:      created,
        message:      `${created.length} record(s) created successfully.`,
      });
    } catch (error: any) {
      console.error("[AI Import] post error:", error.message);
      res.status((error as any).status ?? 500).json({ message: error.message });
    }
  });
}
