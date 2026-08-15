import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { requireAuth } from "../auth";
import { db, pool } from "../db";
import { getErrorMessage } from "../lib/httpHandlers";
import { getClientDate } from "../lib/dateUtils";
import { authorizeCompanyIdParam } from "./helpers/supplierBalanceHelpers";
import { getCustomerByLedgerId } from "../lib/factoryCustomerLedger";
import { bankAccounts, companies, customers, employees, fixedAssets, ledgerAccounts } from "@shared/schema";
import { companyScopedSuppliers } from "@shared/schema/supplierCompanyScope";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 250;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type AccountKind = "ledger" | "bank" | "fixed-asset" | "supplier" | "employee";

type DateContext = {
  rawStart?: string;
  effectiveEndDate: string;
  asOfDate: string;
};

interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

interface StatementPage {
  transactions: any[];
  preNetBalance: number;
  periodPreNetBalance: number;
  periodDebitTotal: number;
  periodCreditTotal: number;
  closingNetBalance: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  asOfDate: string;
  startDate: string | null;
  endDate: string;
}

function wantsPagination(req: Request): boolean {
  return (
    req.query.pagination === "1" ||
    req.query.page !== undefined ||
    req.query.limit !== undefined ||
    req.query.pageSize !== undefined ||
    req.query.offset !== undefined
  );
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePagination(req: Request): Pagination {
  const limit = Math.min(MAX_PAGE_SIZE, parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_PAGE_SIZE));
  if (req.query.offset !== undefined) {
    const offset = Math.max(0, Number.parseInt(String(req.query.offset), 10) || 0);
    return { page: Math.floor(offset / limit) + 1, limit, offset };
  }
  const page = parsePositiveInt(req.query.page, 1);
  return { page, limit, offset: (page - 1) * limit };
}

function dateContext(req: Request): DateContext {
  const asOfDate = getClientDate(req);
  const rawStart =
    typeof req.query.startDate === "string" && ISO_DATE.test(req.query.startDate) ? req.query.startDate : undefined;
  const rawEnd =
    typeof req.query.endDate === "string" && ISO_DATE.test(req.query.endDate) ? req.query.endDate : undefined;
  const effectiveEndDate = rawEnd && rawEnd < asOfDate ? rawEnd : asOfDate;
  return { rawStart, effectiveEndDate, asOfDate };
}

function exposePaginationHeaders(res: Response, page: StatementPage): void {
  res.setHeader("X-Total-Count", String(page.total));
  res.setHeader("X-Page", String(page.page));
  res.setHeader("X-Page-Size", String(page.limit));
  res.setHeader("X-Total-Pages", String(page.totalPages));
  res.setHeader("Access-Control-Expose-Headers", "X-Total-Count, X-Page, X-Page-Size, X-Total-Pages");
}

function buildPageResponse(
  rows: any[],
  summary: any,
  precedingPageNet: number,
  prePeriodNet: number,
  pagination: Pagination,
  dates: DateContext
): StatementPage {
  const total = Number(summary?.total || 0);
  const periodDebitTotal = Number.parseFloat(summary?.debitTotal || "0") || 0;
  const periodCreditTotal = Number.parseFloat(summary?.creditTotal || "0") || 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pagination.limit);
  return {
    transactions: rows,
    // This is the opening balance for the selected page. The frontend adds the
    // account master opening balance separately, exactly as it did before paging.
    preNetBalance: prePeriodNet + precedingPageNet,
    periodPreNetBalance: prePeriodNet,
    periodDebitTotal,
    periodCreditTotal,
    closingNetBalance: prePeriodNet + periodDebitTotal - periodCreditTotal,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1 && totalPages > 0,
    asOfDate: dates.asOfDate,
    startDate: dates.rawStart ?? null,
    endDate: dates.effectiveEndDate,
  };
}

function genericFilteredCte(
  kind: AccountKind,
  accountId: number,
  companyId: number | undefined,
  dates: DateContext
): { cte: string; values: unknown[]; order: string; column: string } {
  const columnByKind: Record<AccountKind, string> = {
    ledger: "ledger_account_id",
    bank: "bank_account_id",
    "fixed-asset": "fixed_asset_id",
    supplier: "supplier_id",
    employee: "employee_id",
  };
  const column = columnByKind[kind];
  const values: unknown[] = [accountId];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = [`ve.${column} = $1`, "v.optional = false", "v.deleted_at IS NULL"];
  if (companyId) conditions.push(`v.company_id = ${bind(companyId)}`);
  if (dates.rawStart) {
    conditions.push(`COALESCE(v.effective_date::date, v.voucher_date::date) >= ${bind(dates.rawStart)}::date`);
  }
  conditions.push(`COALESCE(v.effective_date::date, v.voucher_date::date) <= ${bind(dates.effectiveEndDate)}::date`);
  const baseFrom = `FROM voucher_entries ve JOIN vouchers v ON ve.voucher_id = v.id WHERE ${conditions.join(" AND ")}`;

  if (kind === "ledger") {
    return {
      column,
      values,
      order: "sort_date ASC, sort_id ASC",
      cte: `filtered AS (
        SELECT
          v.id AS "voucherId",
          MIN(ve.id) AS "entryId",
          COALESCE(SUM(ve.debit_amount::numeric), 0)::text AS "debitAmount",
          COALESCE(SUM(ve.credit_amount::numeric), 0)::text AS "creditAmount",
          STRING_AGG(DISTINCT NULLIF(TRIM(ve.narration), ''), ' | ') AS narration,
          v.voucher_number AS "voucherNumber",
          v.voucher_type AS "voucherType",
          COALESCE(v.effective_date::date, v.voucher_date::date)::text AS "voucherDate",
          v.description AS "voucherDescription",
          v.currency,
          COALESCE(v.effective_date::date, v.voucher_date::date) AS sort_date,
          v.id AS sort_id
        ${baseFrom}
        GROUP BY
          v.id,
          v.voucher_number,
          v.voucher_type,
          v.voucher_date,
          v.effective_date,
          v.description,
          v.currency
      )`,
    };
  }

  const supplierFields =
    kind === "supplier"
      ? `ve.transaction_currency AS "transactionCurrency",
          ve.transaction_debit_amount AS "transactionDebitAmount",
          ve.transaction_credit_amount AS "transactionCreditAmount",
          ve.base_debit_amount AS "baseDebitAmount",
          ve.base_credit_amount AS "baseCreditAmount",`
      : "";

  return {
    column,
    values,
    order: "sort_date ASC, sort_id ASC, sort_entry_id ASC",
    cte: `filtered AS (
      SELECT
        ve.id AS "entryId",
        ve.voucher_id AS "voucherId",
        ve.debit_amount AS "debitAmount",
        ve.credit_amount AS "creditAmount",
        ve.narration,
        ${supplierFields}
        v.voucher_number AS "voucherNumber",
        v.voucher_type AS "voucherType",
        COALESCE(v.effective_date::date, v.voucher_date::date)::text AS "voucherDate",
        v.description AS "voucherDescription",
        v.company_id AS "companyId",
        v.currency,
        COALESCE(v.effective_date::date, v.voucher_date::date) AS sort_date,
        v.id AS sort_id,
        ve.id AS sort_entry_id
      ${baseFrom}
    )`,
  };
}

async function runVoucherEntryStatement(options: {
  kind: AccountKind;
  accountId: number;
  companyId?: number;
  pagination: Pagination;
  dates: DateContext;
}): Promise<StatementPage> {
  const { kind, accountId, companyId, pagination, dates } = options;
  const { cte, values, order, column } = genericFilteredCte(kind, accountId, companyId, dates);
  const baseCount = values.length;
  const pageValues = [...values, pagination.limit, pagination.offset];
  const pageQuery = `WITH ${cte}
    SELECT *
    FROM filtered
    ORDER BY ${order}
    LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`;
  const summaryQuery = `WITH ${cte}
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM("debitAmount"::numeric), 0)::text AS "debitTotal",
      COALESCE(SUM("creditAmount"::numeric), 0)::text AS "creditTotal"
    FROM filtered`;
  const precedingQuery =
    pagination.offset === 0
      ? null
      : `WITH ${cte}
         SELECT COALESCE(
           SUM(previous."debitAmount"::numeric - previous."creditAmount"::numeric),
           0
         )::text AS net
         FROM (
           SELECT * FROM filtered ORDER BY ${order} LIMIT $${baseCount + 1}
         ) previous`;

  let prePeriodNet = 0;
  if (dates.rawStart) {
    const preValues: unknown[] = [accountId];
    let companyCondition = "";
    if (companyId) {
      preValues.push(companyId);
      companyCondition = `AND v.company_id = $${preValues.length}`;
    }
    preValues.push(dates.rawStart);
    const preResult = await pool.query(
      `SELECT COALESCE(
         SUM(ve.debit_amount::numeric - ve.credit_amount::numeric),
         0
       )::text AS net
       FROM voucher_entries ve
       JOIN vouchers v ON v.id = ve.voucher_id
       WHERE ve.${column} = $1
         AND v.optional = false
         AND v.deleted_at IS NULL
         ${companyCondition}
         AND COALESCE(v.effective_date::date, v.voucher_date::date) < $${preValues.length}::date`,
      preValues
    );
    prePeriodNet = Number.parseFloat(preResult.rows[0]?.net || "0") || 0;
  }

  const [pageResult, summaryResult, precedingResult] = await Promise.all([
    pool.query(pageQuery, pageValues),
    pool.query(summaryQuery, values),
    precedingQuery
      ? pool.query(precedingQuery, [...values, pagination.offset])
      : Promise.resolve({ rows: [{ net: "0" }] }),
  ]);
  const rows = pageResult.rows.map(({ sort_date: _date, sort_id: _id, sort_entry_id: _entry, ...row }) => row);
  return buildPageResponse(
    rows,
    summaryResult.rows[0],
    Number.parseFloat(precedingResult.rows[0]?.net || "0") || 0,
    prePeriodNet,
    pagination,
    dates
  );
}

async function runCustomerBalanceStatement(options: {
  customerId: number;
  companyId: number;
  pagination: Pagination;
  dates: DateContext;
}): Promise<StatementPage> {
  const { customerId, companyId, pagination, dates } = options;
  const values: unknown[] = [customerId, companyId];
  const conditions = ["cb.customer_id = $1", "cb.company_id = $2"];
  if (dates.rawStart) {
    values.push(dates.rawStart);
    conditions.push(`cb.transaction_date >= $${values.length}::date`);
  }
  values.push(dates.effectiveEndDate);
  conditions.push(`cb.transaction_date <= $${values.length}::date`);

  const cte = `filtered AS (
    SELECT
      cb.id AS "entryId",
      COALESCE(cb.reference_id, cb.id) AS "voucherId",
      CASE
        WHEN cb.reference_type IS NOT NULL
          THEN cb.reference_type || '-' || COALESCE(cb.reference_id, cb.id)::text
        ELSE 'CB-' || cb.id::text
      END AS "voucherNumber",
      cb.transaction_type AS "voucherType",
      cb.transaction_date::text AS "voucherDate",
      COALESCE(cb.description, '') AS "voucherDescription",
      COALESCE(cb.description, '') AS narration,
      cb.debit_amount AS "debitAmount",
      cb.credit_amount AS "creditAmount",
      cb.transaction_date AS sort_date,
      cb.id AS sort_id
    FROM customer_balances cb
    WHERE ${conditions.join(" AND ")}
  )`;
  const baseCount = values.length;
  const pageQuery = `WITH ${cte}
    SELECT * FROM filtered
    ORDER BY sort_date ASC, sort_id ASC
    LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`;
  const summaryQuery = `WITH ${cte}
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM("debitAmount"::numeric), 0)::text AS "debitTotal",
      COALESCE(SUM("creditAmount"::numeric), 0)::text AS "creditTotal"
    FROM filtered`;
  const precedingQuery =
    pagination.offset === 0
      ? null
      : `WITH ${cte}
         SELECT COALESCE(
           SUM(previous."debitAmount"::numeric - previous."creditAmount"::numeric),
           0
         )::text AS net
         FROM (
           SELECT * FROM filtered
           ORDER BY sort_date ASC, sort_id ASC
           LIMIT $${baseCount + 1}
         ) previous`;

  let prePeriodNet = 0;
  if (dates.rawStart) {
    const preResult = await pool.query(
      `SELECT COALESCE(
         SUM(cb.debit_amount::numeric - cb.credit_amount::numeric),
         0
       )::text AS net
       FROM customer_balances cb
       WHERE cb.customer_id = $1
         AND cb.company_id = $2
         AND cb.transaction_date < $3::date`,
      [customerId, companyId, dates.rawStart]
    );
    prePeriodNet = Number.parseFloat(preResult.rows[0]?.net || "0") || 0;
  }

  const [pageResult, summaryResult, precedingResult] = await Promise.all([
    pool.query(pageQuery, [...values, pagination.limit, pagination.offset]),
    pool.query(summaryQuery, values),
    precedingQuery
      ? pool.query(precedingQuery, [...values, pagination.offset])
      : Promise.resolve({ rows: [{ net: "0" }] }),
  ]);
  const rows = pageResult.rows.map(({ sort_date: _date, sort_id: _id, ...row }) => row);
  return buildPageResponse(
    rows,
    summaryResult.rows[0],
    Number.parseFloat(precedingResult.rows[0]?.net || "0") || 0,
    prePeriodNet,
    pagination,
    dates
  );
}

function factoryCustomerAllRowsCte(): string {
  return `all_rows AS (
    SELECT
      'co-' || co.id::text AS id,
      (-1000000 - co.id) AS "voucherId",
      COALESCE(co.invoice_number, 'INV-' || co.id::text) AS "voucherNumber",
      'Sales'::text AS "voucherType",
      co.order_date::date AS voucher_date,
      COALESCE('Invoice — ' || NULLIF(co.destination, ''), 'Invoice') AS "voucherDescription",
      COALESCE('Invoice — ' || NULLIF(co.destination, ''), 'Invoice') AS narration,
      COALESCE(co.grand_total, 0)::text AS "debitAmount",
      '0'::text AS "creditAmount",
      1 AS source_rank,
      co.id AS source_id
    FROM customer_orders co
    WHERE co.company_id = $1
      AND co.customer_id = $2
      AND co.status = 'FINALIZED'

    UNION ALL

    SELECT
      'cb-' || cb.id::text,
      (-2000000 - cb.id),
      CASE
        WHEN cb.reference_type IS NOT NULL
          THEN cb.reference_type || '-' || COALESCE(cb.reference_id, cb.id)::text
        ELSE 'CB-' || cb.id::text
      END,
      COALESCE(cb.transaction_type, 'Payment'),
      cb.transaction_date::date,
      COALESCE(cb.description, ''),
      COALESCE(cb.description, ''),
      COALESCE(cb.debit_amount, 0)::text,
      COALESCE(cb.credit_amount, 0)::text,
      2,
      cb.id
    FROM customer_balances cb
    WHERE cb.company_id = $1
      AND cb.customer_id = $2
      AND (cb.reference_type <> 'INVOICE' OR cb.reference_type IS NULL)

    UNION ALL

    SELECT
      've-' || ve.id::text,
      ve.voucher_id,
      COALESCE(v.voucher_number, ''),
      COALESCE(v.voucher_type, 'Voucher'),
      v.voucher_date::date,
      COALESCE(v.description, ''),
      COALESCE(NULLIF(ve.narration, ''), v.description, ''),
      COALESCE(ve.debit_amount, 0)::text,
      COALESCE(ve.credit_amount, 0)::text,
      3,
      ve.id
    FROM voucher_entries ve
    JOIN vouchers v ON v.id = ve.voucher_id
    WHERE v.company_id = $1
      AND v.optional = false
      AND v.deleted_at IS NULL
      AND v.voucher_number NOT LIKE 'CHARGE-%'
      AND (
        ve.ledger_account_id = $3
        OR (ve.customer_id = $2 AND ve.ledger_account_id IS NULL)
      )
  )`;
}

async function runFactoryCustomerLedgerStatement(options: {
  customerId: number;
  ledgerAccountId: number;
  companyId: number;
  pagination: Pagination;
  dates: DateContext;
}): Promise<StatementPage> {
  const { customerId, ledgerAccountId, companyId, pagination, dates } = options;
  const values: unknown[] = [companyId, customerId, ledgerAccountId, dates.effectiveEndDate];
  const filteredConditions = ["voucher_date <= $4::date"];
  if (dates.rawStart) {
    values.push(dates.rawStart);
    filteredConditions.push(`voucher_date >= $${values.length}::date`);
  }
  const allRows = factoryCustomerAllRowsCte();
  const cte = `${allRows},
    filtered AS (
      SELECT *, voucher_date::text AS "voucherDate"
      FROM all_rows
      WHERE ${filteredConditions.join(" AND ")}
    )`;
  const baseCount = values.length;
  const order = `voucher_date ASC, "voucherNumber" ASC, source_rank ASC, source_id ASC`;
  const pageQuery = `WITH ${cte}
    SELECT * FROM filtered
    ORDER BY ${order}
    LIMIT $${baseCount + 1} OFFSET $${baseCount + 2}`;
  const summaryQuery = `WITH ${cte}
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM("debitAmount"::numeric), 0)::text AS "debitTotal",
      COALESCE(SUM("creditAmount"::numeric), 0)::text AS "creditTotal"
    FROM filtered`;
  const precedingQuery =
    pagination.offset === 0
      ? null
      : `WITH ${cte}
         SELECT COALESCE(
           SUM(previous."debitAmount"::numeric - previous."creditAmount"::numeric),
           0
         )::text AS net
         FROM (
           SELECT * FROM filtered ORDER BY ${order} LIMIT $${baseCount + 1}
         ) previous`;

  let prePeriodNet = 0;
  if (dates.rawStart) {
    const preResult = await pool.query(
      `WITH ${allRows}
       SELECT COALESCE(
         SUM("debitAmount"::numeric - "creditAmount"::numeric),
         0
       )::text AS net
       FROM all_rows
       WHERE voucher_date < $4::date`,
      [companyId, customerId, ledgerAccountId, dates.rawStart]
    );
    prePeriodNet = Number.parseFloat(preResult.rows[0]?.net || "0") || 0;
  }

  const [pageResult, summaryResult, precedingResult] = await Promise.all([
    pool.query(pageQuery, [...values, pagination.limit, pagination.offset]),
    pool.query(summaryQuery, values),
    precedingQuery
      ? pool.query(precedingQuery, [...values, pagination.offset])
      : Promise.resolve({ rows: [{ net: "0" }] }),
  ]);
  const rows = pageResult.rows.map(({ voucher_date: _date, source_rank: _rank, source_id: _source, ...row }) => row);
  return buildPageResponse(
    rows,
    summaryResult.rows[0],
    Number.parseFloat(precedingResult.rows[0]?.net || "0") || 0,
    prePeriodNet,
    pagination,
    dates
  );
}

export function registerAccountTransactionPaginationRoutes(app: Express): void {
  const guard =
    (handler: (req: Request, res: Response) => Promise<Response | void>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      if (!wantsPagination(req)) return next();
      try {
        await handler(req, res);
      } catch (error: unknown) {
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    };

  const send = (res: Response, page: StatementPage): Response => {
    exposePaginationHeaders(res, page);
    return res.json(page);
  };

  app.get(
    "/api/accounts/ledger/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid ledger account ID" });
      }
      const [account] = await db
        .select({ companyId: ledgerAccounts.companyId })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), isNull(ledgerAccounts.deletedAt)))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Ledger account not found" });
      if ((await authorizeCompanyIdParam(req, account.companyId)) === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }

      const pagination = parsePagination(req);
      const dates = dateContext(req);
      const linkedCustomer = await getCustomerByLedgerId(accountId);
      if (linkedCustomer && linkedCustomer.companyId === account.companyId) {
        const [company] = await db
          .select({ companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, linkedCustomer.companyId))
          .limit(1);
        if (company?.companyType === "factory") {
          return send(
            res,
            await runFactoryCustomerLedgerStatement({
              customerId: linkedCustomer.id,
              ledgerAccountId: accountId,
              companyId: linkedCustomer.companyId,
              pagination,
              dates,
            })
          );
        }
      }
      return send(
        res,
        await runVoucherEntryStatement({
          kind: "ledger",
          accountId,
          companyId: account.companyId,
          pagination,
          dates,
        })
      );
    })
  );

  app.get(
    "/api/accounts/bank/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid bank account ID" });
      }
      const [account] = await db
        .select({ companyId: bankAccounts.companyId })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, accountId))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Bank account not found" });
      if ((await authorizeCompanyIdParam(req, account.companyId)) === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }
      return send(
        res,
        await runVoucherEntryStatement({
          kind: "bank",
          accountId,
          companyId: account.companyId,
          pagination: parsePagination(req),
          dates: dateContext(req),
        })
      );
    })
  );

  app.get(
    "/api/accounts/fixed-asset/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid fixed asset ID" });
      }
      const [account] = await db
        .select({ companyId: fixedAssets.companyId })
        .from(fixedAssets)
        .where(eq(fixedAssets.id, accountId))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Fixed asset not found" });
      if ((await authorizeCompanyIdParam(req, account.companyId)) === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }
      return send(
        res,
        await runVoucherEntryStatement({
          kind: "fixed-asset",
          accountId,
          companyId: account.companyId,
          pagination: parsePagination(req),
          dates: dateContext(req),
        })
      );
    })
  );

  app.get(
    "/api/accounts/supplier/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid supplier ID" });
      }
      const requestedCompanyId =
        typeof req.query.companyId === "string"
          ? Number.parseInt(req.query.companyId, 10)
          : req.session.currentCompanyId;
      const companyId = await authorizeCompanyIdParam(req, requestedCompanyId);
      if (companyId === null) {
        return res.status(403).json({ message: "No access to this company" });
      }
      const [supplier] = await db
        .select({ id: companyScopedSuppliers.id })
        .from(companyScopedSuppliers)
        .where(
          and(
            eq(companyScopedSuppliers.id, accountId),
            eq(companyScopedSuppliers.companyId, companyId),
            isNull(companyScopedSuppliers.deletedAt)
          )
        )
        .limit(1);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      return send(
        res,
        await runVoucherEntryStatement({
          kind: "supplier",
          accountId,
          companyId,
          pagination: parsePagination(req),
          dates: dateContext(req),
        })
      );
    })
  );

  app.get(
    "/api/accounts/employee/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid employee ID" });
      }
      const [account] = await db
        .select({ companyId: employees.companyId })
        .from(employees)
        .where(eq(employees.id, accountId))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Employee not found" });
      if ((await authorizeCompanyIdParam(req, account.companyId)) === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }
      return send(
        res,
        await runVoucherEntryStatement({
          kind: "employee",
          accountId,
          companyId: account.companyId,
          pagination: parsePagination(req),
          dates: dateContext(req),
        })
      );
    })
  );

  app.get(
    "/api/accounts/customer/:id/transactions",
    requireAuth,
    guard(async (req, res) => {
      const accountId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(accountId)) {
        return res.status(400).json({ message: "Invalid customer ID" });
      }
      const [account] = await db
        .select({ companyId: customers.companyId })
        .from(customers)
        .where(eq(customers.id, accountId))
        .limit(1);
      if (!account) return res.status(404).json({ message: "Customer not found" });
      if ((await authorizeCompanyIdParam(req, account.companyId)) === null) {
        return res.status(403).json({ message: "No access to this account's company" });
      }
      return send(
        res,
        await runCustomerBalanceStatement({
          customerId: accountId,
          companyId: account.companyId,
          pagination: parsePagination(req),
          dates: dateContext(req),
        })
      );
    })
  );
}
