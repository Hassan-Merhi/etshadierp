import type { Express } from "express";

import { requireAuth } from "../../auth";
import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { requireExportAccess } from "../../lib/permissionMiddleware";
import { auditLog, companies, factoryUserProfiles, users } from "@shared/schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { resolveActiveCompanyId } from "../helpers/resolveActiveCompanyId";

export function registerAuthAuditLogRoutes(app: Express) {
  app.get("/api/audit-log", requireAuth, requireExportAccess("exp_audit_log"), async (req, res) => {
    try {
      const companyId = resolveActiveCompanyId(req);
      const {
        limit: limitStr,
        offset: offsetStr,
        page: pageStr,
        tableName,
        module: moduleParam,
        userId,
        action,
        dateFrom,
        from: fromParam,
        dateTo,
        to: toParam,
        search,
      } = req.query as Record<string, string>;

      const requestedLimit = Number.parseInt(limitStr ?? "50", 10);
      const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));
      const pageNum = Math.max(1, pageStr ? parseInt(pageStr, 10) : 1);
      const offset = offsetStr ? parseInt(offsetStr, 10) : (pageNum - 1) * pageSize;
      const resolvedTable = tableName || moduleParam || "";
      const resolvedFrom = dateFrom || fromParam || "";
      const resolvedTo = dateTo || toParam || "";
      const excludedActions = [
        "create",
        "delete",
        "login",
        "import",
        "export",
        "send_whatsapp",
        "send_email",
        "permission_change",
        "settings_change",
        "approve",
      ];
      const baseConditions: any[] = [
        sql`${auditLog.userId} NOT IN (SELECT user_id FROM user_company_roles WHERE role = 'Developer')`,
        sql`${auditLog.tableName} != 'security_events'`,
        sql`lower(${auditLog.action}) NOT IN (${sql.join(excludedActions.map((value) => sql`${value}`), sql`, `)})`,
        ...(companyId ? [eq(auditLog.companyId, companyId)] : []),
      ];
      const filterConditions: any[] = [];
      if (resolvedTable) filterConditions.push(eq(auditLog.tableName, resolvedTable));
      if (userId) filterConditions.push(eq(auditLog.userId, userId));
      if (action && action !== "all") {
        const actionValues = action
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        if (actionValues.length === 1) filterConditions.push(sql`lower(${auditLog.action}) = ${actionValues[0]}`);
        if (actionValues.length > 1) {
          filterConditions.push(
            sql`lower(${auditLog.action}) IN (${sql.join(actionValues.map((value) => sql`${value}`), sql`, `)})`,
          );
        }
      }
      if (resolvedFrom) filterConditions.push(gte(auditLog.createdAt, new Date(resolvedFrom)));
      if (resolvedTo) {
        const to = new Date(resolvedTo);
        to.setHours(23, 59, 59, 999);
        filterConditions.push(lte(auditLog.createdAt, to));
      }
      if (search?.trim()) {
        const value = `%${search.trim()}%`;
        filterConditions.push(
          or(
            ilike(auditLog.recordIdentifier, value),
            ilike(auditLog.username, value),
            ilike(auditLog.tableName, value),
            ilike(auditLog.action, value),
          )!,
        );
      }

      const whereClause = and(...baseConditions, ...filterConditions);
      const [rawLogs, countResult, modulesResult] = await Promise.all([
        db
          .select({
            id: auditLog.id,
            userId: auditLog.userId,
            storedUsername: auditLog.username,
            companyId: auditLog.companyId,
            action: auditLog.action,
            tableName: auditLog.tableName,
            recordId: auditLog.recordId,
            recordIdentifier: auditLog.recordIdentifier,
            changes: auditLog.changes,
            createdAt: auditLog.createdAt,
            resolvedUsername: users.username,
            displayName: factoryUserProfiles.displayName,
            companyName: companies.name,
            companyCode: companies.code,
          })
          .from(auditLog)
          .leftJoin(users, eq(users.id, auditLog.userId))
          .leftJoin(
            factoryUserProfiles,
            and(
              eq(factoryUserProfiles.userId, auditLog.userId),
              companyId ? eq(factoryUserProfiles.companyId, companyId) : sql`1 = 0`,
            ),
          )
          .leftJoin(companies, eq(companies.id, auditLog.companyId))
          .where(whereClause)
          .orderBy(desc(auditLog.createdAt))
          .limit(pageSize)
          .offset(offset),
        db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(whereClause),
        db.selectDistinct({ tableName: auditLog.tableName }).from(auditLog).where(and(...baseConditions)).orderBy(auditLog.tableName),
      ]);

      const moduleLabels: Record<string, string> = {
        vouchers: "Vouchers",
        voucher_entries: "Journal Entries",
        ledger_accounts: "Accounts",
        customers: "Customers",
        suppliers: "Suppliers",
        stock_items: "Stock Items",
        inventory: "Inventory",
        stock_transfers: "Stock Transfers",
        containers: "Containers",
        factory_containers: "Factory Containers",
        factory_offload_charges: "Post-Offload Charges",
        factory_mix_batches: "Mix Batches",
        factory_mix_batch_sources: "Mix Batch Sources",
        production_raw_stock: "Raw Material Stock",
        bales: "Bales",
        factory_customer_orders: "Factory Customer Orders",
        users: "Users",
        user_company_roles: "Roles & Permissions",
        exchange_rates: "Exchange Rates",
        company_settings: "Company Settings",
        reports: "Reports",
      };
      const actionLabels: Record<string, string> = {
        create: "Created",
        update: "Updated",
        delete: "Deleted",
        restore: "Restored",
        reverse: "Reversed",
        void: "Voided",
        recalculate: "Recalculated",
        repair: "Repaired",
        import: "Imported",
        export: "Exported",
        send_whatsapp: "Sent to WhatsApp",
        send_email: "Sent by Email",
        approve: "Approved",
        cancel: "Cancelled",
        offload: "Offloaded",
        transfer: "Transferred",
        adjust: "Adjusted",
        login: "Login",
        permission_change: "Permission Changed",
        settings_change: "Settings Changed",
      };
      const deriveModuleLabel = (name: string) =>
        moduleLabels[name] ||
        name
          .replace(/^(factory_|payroll_|rental_|pos_)/, "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (character) => character.toUpperCase()) ||
        "Unknown";
      const logs = rawLogs.map(({ storedUsername, resolvedUsername, displayName, companyName, companyCode, ...row }) => {
        const actionLower = (row.action || "").toLowerCase();
        return {
          ...row,
          username: resolvedUsername || displayName || storedUsername || "Unknown",
          companyName: companyName || null,
          companyCode: companyCode || null,
          moduleLabel: deriveModuleLabel(row.tableName),
          actionLabel:
            actionLabels[actionLower] ||
            (row.action ? row.action.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "Unknown"),
          targetUrl: null as string | null,
        };
      });
      const total = countResult[0]?.count ?? 0;
      res.json({
        logs,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        total,
        knownModules: modulesResult.map((row) => row.tableName).filter(Boolean),
      });
    } catch (error: unknown) {
      logger.error("Error fetching audit logs:", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
