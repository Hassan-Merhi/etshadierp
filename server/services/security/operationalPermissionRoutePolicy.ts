export type OperationalPermissionType = "action" | "export";

export interface OperationalPermissionRouteMatch {
  operation: "import" | "bulk-maintenance" | "excel-export" | "pdf-export" | "stock-export" | "print" | "whatsapp-export" | "backup-export" | "global-export-center";
  permissionType: OperationalPermissionType;
  permissionKey: string;
  developerOnly?: boolean;
  deniedRoles?: readonly string[];
}

function normalizePath(path: string): string {
  const withoutQuery = path.split("?", 1)[0] || "/";
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
}

function isMutation(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

const IMPORT_PREFIXES = [
  "/api/po-import",
  "/api/pos-import",
  "/api/credit-sales-import",
  "/api/stock-transfer-import",
  "/api/chatbot-po-import",
  "/api/ai-import",
  "/api/import",
];

function isImportRoute(method: string, path: string): boolean {
  if (path.startsWith("/api/import-cycle") || path.startsWith("/api/stats/import-cycle")) {
    return false;
  }
  if (IMPORT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }
  if (!isMutation(method) && !/\/(template|sample)$/.test(path)) return false;
  return /(?:^|[-/])import(?:[-/]|$)/.test(path);
}

function isBulkMaintenanceRoute(method: string, path: string): boolean {
  if (!isMutation(method)) return false;
  return /(?:^|[-/])(repair|recalculate|rebuild|cleanup|backfill|reconcile|resync|fix)(?:[-/]|$)/.test(path);
}

function exportPermission(path: string): OperationalPermissionRouteMatch | null {
  const lower = path.toLowerCase();

  if (lower === "/api/export" || lower.startsWith("/api/export/")) {
    return {
      operation: "global-export-center",
      permissionType: "export",
      permissionKey: "exp_backup_download",
      developerOnly: true,
    };
  }

  const looksLikeExport =
    /(?:^|[-/])export(?:[-/]|$)/.test(lower) ||
    /(?:^|[-/])(excel|xlsx|pdf|print)(?:[-/]|$)/.test(lower) ||
    lower.includes("daily-export") ||
    lower.includes("backup-download");
  if (!looksLikeExport) return null;

  if (lower.includes("whatsapp") || lower.includes("send-wa")) {
    return {
      operation: "whatsapp-export",
      permissionType: "export",
      permissionKey: "exp_whatsapp_send",
    };
  }
  if (lower.includes("stock") && (lower.includes("export") || lower.includes("excel") || lower.includes("pdf"))) {
    return {
      operation: "stock-export",
      permissionType: "export",
      permissionKey: "exp_stock_report",
    };
  }
  if (/(?:^|[-/])pdf(?:[-/]|$)/.test(lower)) {
    return {
      operation: "pdf-export",
      permissionType: "export",
      permissionKey: "exp_pdf",
    };
  }
  if (/(?:^|[-/])print(?:[-/]|$)/.test(lower)) {
    return {
      operation: "print",
      permissionType: "export",
      permissionKey: "exp_print_invoice",
    };
  }
  if (lower.includes("backup") || lower.includes("daily-export") || lower.includes("data-export")) {
    return {
      operation: "backup-export",
      permissionType: "export",
      permissionKey: "exp_backup_download",
    };
  }
  return {
    operation: "excel-export",
    permissionType: "export",
    permissionKey: "exp_excel",
  };
}

export function classifyOperationalPermissionRoute(
  method: string,
  rawPath: string
): OperationalPermissionRouteMatch | null {
  const path = normalizePath(rawPath);

  if (isImportRoute(method, path)) {
    return {
      operation: "import",
      permissionType: "action",
      permissionKey: "act_import_data",
      deniedRoles: ["POS", "View Only"],
    };
  }

  if (isBulkMaintenanceRoute(method, path)) {
    return {
      operation: "bulk-maintenance",
      permissionType: "action",
      permissionKey: "act_bulk_operations",
      deniedRoles: ["POS", "View Only"],
    };
  }

  return exportPermission(path);
}
