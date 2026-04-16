import type { Express } from "express";
import { db } from "../db";
import {
  vouchers,
  voucherEntries,
  ledgerAccounts,
  companies,
  userCompanyRoles,
} from "../../shared/schema";
import {
  eq,
  and,
  gte,
  lte,
  inArray,
  or,
  ilike,
  desc,
  sql,
  count,
  isNull,
} from "drizzle-orm";

export function registerGlobalTransactionRoutes(
  app: Express,
  requireAuth: any
) {
  // GET /api/global/transactions
  // Returns vouchers across all ERP companies the user has access to.
  app.get("/api/global/transactions", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as string;
      const userRole = (req.session as any).role as string;
      const isAdmin = userRole === "Admin" || userRole === "Developer";

      const {
        startDate,
        endDate,
        companyIds: companyIdsParam,
        voucherType,
        currency,
        search,
        optional: optionalParam,
        includeFactory: includeFactoryParam,
        page: pageParam,
        limit: limitParam,
      } = req.query as Record<string, string>;

      const includeFactoryBool = includeFactoryParam === "true";

      const page  = Math.max(1, parseInt(pageParam  || "1"));
      const limit = Math.min(200, Math.max(1, parseInt(limitParam || "50")));
      const offset = (page - 1) * limit;

      // 1. Resolve which ERP company IDs this user may see
      let allowedCompanyIds: number[];

      const allowedTypeFilter = or(
        eq(companies.companyType, "erp"),
        eq(companies.companyType, "properties"),
        eq(companies.companyType, "factory"),
      );

      if (isAdmin) {
        // Admins see all ERP + factory + properties companies
        const allErpCompanies = await db
          .select({ id: companies.id })
          .from(companies)
          .where(allowedTypeFilter);
        allowedCompanyIds = allErpCompanies.map((c) => c.id);
      } else {
        // Regular users see only their assigned companies
        const userRoles = await db
          .select({ companyId: userCompanyRoles.companyId })
          .from(userCompanyRoles)
          .where(eq(userCompanyRoles.userId, userId));
        const userCompanyIds = userRoles.map((r) => r.companyId);

        if (userCompanyIds.length === 0) {
          return res.json({ vouchers: [], total: 0, page, totalPages: 0, summary: [] });
        }

        // Intersect with allowed company types only
        const erpCompanies = await db
          .select({ id: companies.id })
          .from(companies)
          .where(and(allowedTypeFilter, inArray(companies.id, userCompanyIds)));
        allowedCompanyIds = erpCompanies.map((c) => c.id);
      }

      if (allowedCompanyIds.length === 0) {
        return res.json({ vouchers: [], total: 0, page, totalPages: 0, summary: [] });
      }

      // 1b. Optionally exclude factory companies
      if (!includeFactoryBool) {
        const nonFactoryCompanies = await db
          .select({ id: companies.id })
          .from(companies)
          .where(and(
            inArray(companies.id, allowedCompanyIds),
            or(eq(companies.companyType, "erp"), eq(companies.companyType, "properties"))
          ));
        allowedCompanyIds = nonFactoryCompanies.map((c) => c.id);
        if (allowedCompanyIds.length === 0) {
          return res.json({ vouchers: [], total: 0, page, totalPages: 0, summary: [], companies: [] });
        }
      }

      // 2. Apply company filter from request (must be subset of allowed)
      let targetCompanyIds = allowedCompanyIds;
      if (companyIdsParam && companyIdsParam !== "all") {
        const requested = companyIdsParam.split(",").map((id) => parseInt(id)).filter(Boolean);
        targetCompanyIds = requested.filter((id) => allowedCompanyIds.includes(id));
        if (targetCompanyIds.length === 0) {
          return res.json({ vouchers: [], total: 0, page, totalPages: 0, summary: [] });
        }
      }

      // 3. Build WHERE conditions
      const conditions: any[] = [
        inArray(vouchers.companyId, targetCompanyIds),
        isNull(vouchers.deletedAt),
      ];

      if (startDate) conditions.push(gte(vouchers.voucherDate, startDate));
      if (endDate)   conditions.push(lte(vouchers.voucherDate, endDate));
      if (voucherType && voucherType !== "all") {
        // Treat "Stock Transfer" and "StockTransfer" as the same type
        if (voucherType === "Stock Transfer" || voucherType === "StockTransfer") {
          conditions.push(or(eq(vouchers.voucherType, "Stock Transfer"), eq(vouchers.voucherType, "StockTransfer")));
        } else {
          conditions.push(eq(vouchers.voucherType, voucherType));
        }
      }
      if (currency    && currency    !== "all") conditions.push(eq(vouchers.currency, currency));

      // optional filter: "active" → false, "optional" → true, "all" → both
      if (optionalParam === "active")   conditions.push(eq(vouchers.optional, false));
      if (optionalParam === "optional") conditions.push(eq(vouchers.optional, true));

      if (search) {
        conditions.push(
          or(
            ilike(vouchers.voucherNumber, `%${search}%`),
            // narration search: check if any entry for this voucher matches
            sql`EXISTS (
              SELECT 1 FROM voucher_entries ve
              WHERE ve.voucher_id = ${vouchers.id}
              AND ve.narration ILIKE ${"%" + search + "%"}
            )`
          )
        );
      }

      const whereClause = and(...conditions);

      // 4. Count total
      const [{ total }] = await db
        .select({ total: count() })
        .from(vouchers)
        .where(whereClause);

      const totalCount = Number(total);
      const totalPages = Math.ceil(totalCount / limit);

      // 5. Fetch paginated vouchers with company name + first entry narration
      const rows = await db
        .select({
          id:            vouchers.id,
          companyId:     vouchers.companyId,
          companyName:   companies.name,
          voucherNumber: vouchers.voucherNumber,
          voucherType:   vouchers.voucherType,
          voucherDate:   vouchers.voucherDate,
          totalAmount:   vouchers.totalAmount,
          currency:      vouchers.currency,
          optional:      vouchers.optional,
          narration: sql<string>`(
            SELECT ve.narration FROM voucher_entries ve
            WHERE ve.voucher_id = ${vouchers.id}
            AND ve.narration IS NOT NULL AND ve.narration != ''
            LIMIT 1
          )`,
        })
        .from(vouchers)
        .innerJoin(companies, eq(companies.id, vouchers.companyId))
        .where(whereClause)
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.id))
        .limit(limit)
        .offset(offset);

      // 6. Per-company summary (debit/credit totals for the filtered period)
      const summaryRows = await db
        .select({
          companyId:   vouchers.companyId,
          companyName: companies.name,
          currency:    vouchers.currency,
          voucherCount: count(),
          totalDebits: sql<string>`SUM(CASE WHEN ve.debit_amount > 0 THEN ve.debit_amount ELSE 0 END)`,
          totalCredits: sql<string>`SUM(CASE WHEN ve.credit_amount > 0 THEN ve.credit_amount ELSE 0 END)`,
        })
        .from(vouchers)
        .innerJoin(companies, eq(companies.id, vouchers.companyId))
        .innerJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
        .where(whereClause)
        .groupBy(vouchers.companyId, companies.name, vouchers.currency)
        .orderBy(companies.name);

      // 7. Return all company names (for the filter dropdown)
      const allCompanyRows = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(companies.id, allowedCompanyIds))
        .orderBy(companies.name);

      return res.json({
        vouchers: rows,
        total:       totalCount,
        page,
        totalPages,
        summary:     summaryRows,
        companies:   allCompanyRows,
      });
    } catch (err) {
      console.error("[GlobalTransactions]", err);
      return res.status(500).json({ message: "Failed to fetch global transactions" });
    }
  });

  // GET /api/global/transactions/voucher-types
  // Returns the distinct voucher types present across the user's companies
  app.get("/api/global/transactions/voucher-types", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId as string;
      const userRole = (req.session as any).role as string;
      const isAdmin = userRole === "Admin" || userRole === "Developer";

      let allowedCompanyIds: number[];
      const typeFilter = or(
        eq(companies.companyType, "erp"),
        eq(companies.companyType, "properties"),
        eq(companies.companyType, "factory"),
      );
      if (isAdmin) {
        const all = await db.select({ id: companies.id }).from(companies).where(typeFilter);
        allowedCompanyIds = all.map((c) => c.id);
      } else {
        const userRoles = await db.select({ companyId: userCompanyRoles.companyId })
          .from(userCompanyRoles).where(eq(userCompanyRoles.userId, userId));
        allowedCompanyIds = userRoles.map((r) => r.companyId);
      }

      if (allowedCompanyIds.length === 0) return res.json([]);

      const types = await db
        .selectDistinct({ voucherType: vouchers.voucherType })
        .from(vouchers)
        .where(and(inArray(vouchers.companyId, allowedCompanyIds), isNull(vouchers.deletedAt)))
        .orderBy(vouchers.voucherType);

      return res.json(types.map((t) => t.voucherType));
    } catch (err) {
      console.error("[GlobalTransactions/types]", err);
      return res.status(500).json({ message: "Failed to fetch voucher types" });
    }
  });

  // GET /api/global/transactions/:voucherId/detail
  // Returns full voucher + entries without session-company restriction (auth only).
  app.get("/api/global/transactions/:voucherId/detail", requireAuth, async (req, res) => {
    try {
      const voucherId = parseInt(req.params.voucherId);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucher ID" });

      const [voucher] = await db
        .select({
          id:            vouchers.id,
          companyId:     vouchers.companyId,
          companyName:   companies.name,
          voucherNumber: vouchers.voucherNumber,
          voucherType:   vouchers.voucherType,
          voucherDate:   vouchers.voucherDate,
          totalAmount:   vouchers.totalAmount,
          currency:      vouchers.currency,
          optional:      vouchers.optional,
        })
        .from(vouchers)
        .innerJoin(companies, eq(companies.id, vouchers.companyId))
        .where(eq(vouchers.id, voucherId));

      if (!voucher) return res.status(404).json({ message: "Voucher not found" });

      const entries = await db
        .select({
          id:            voucherEntries.id,
          ledgerAccountId: voucherEntries.ledgerAccountId,
          accountName:   ledgerAccounts.name,
          debitAmount:   voucherEntries.debitAmount,
          creditAmount:  voucherEntries.creditAmount,
          narration:     voucherEntries.narration,
        })
        .from(voucherEntries)
        .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, voucherEntries.ledgerAccountId))
        .where(eq(voucherEntries.voucherId, voucherId))
        .orderBy(voucherEntries.id);

      return res.json({ voucher, entries });
    } catch (err) {
      console.error("[GlobalTransactions/detail]", err);
      return res.status(500).json({ message: "Failed to fetch voucher detail" });
    }
  });
}
