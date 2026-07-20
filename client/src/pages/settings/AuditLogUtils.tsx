// ── Date formatting ──────────────────────────────────────────────────────────

export function fmtDate(d: string) {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

// ── Field label helpers ──────────────────────────────────────────────────────

export function fieldLabel(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export const BUSINESS_FIELD_LABELS: Record<string, string> = {
  voucherType: "Voucher Type",
  date: "Date",
  amount: "Amount",
  description: "Description",
  narration: "Narration",
  location: "Location",
  optional: "Status",
  ledgerAccount: "Ledger Account",
  debitAccount: "Debit Account",
  creditAccount: "Credit Account",
  cashAccount: "Cash / Bank Account",
  customer: "Customer",
  supplier: "Supplier",
  paymentMethod: "Payment Method",
  currency: "Currency",
  exchangeRate: "Exchange Rate",
  sourceLocation: "Source Location",
  destinationLocation: "Destination Location",
  company: "Company",
  reference: "Reference",
  name: "Name",
  status: "Status",
  type: "Type",
  balance: "Balance",
  phone: "Phone",
  email: "Email",
  address: "Address",
  contactPerson: "Contact Person",
  notes: "Notes",
  paymentTerms: "Payment Terms",
  taxNumber: "Tax Number",
  code: "Code",
  unit: "Unit",
  category: "Category",
  quantity: "Quantity",
  unitPrice: "Unit Price",
  total: "Total",
};

export function fmtBusinessValue(field: string, value: any): string {
  if (value === null || value === undefined) return "—";
  if (field === "optional") return value ? "Optional" : "Active";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "amount" || field === "balance" || field === "total" || field === "unitPrice") {
    const n = parseFloat(String(value));
    if (!isNaN(n)) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (field === "exchangeRate" || field === "quantity") {
    const n = parseFloat(String(value));
    if (!isNaN(n)) return n.toLocaleString();
  }
  if (field === "date" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(value)))) {
    try {
      const d = new Date(String(value));
      if (!isNaN(d.getTime()))
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(value)) return `(${value.length} item${value.length !== 1 ? "s" : ""})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "—";
    const preview = keys
      .slice(0, 3)
      .map((k) => `${fieldLabel(k)}: ${String((value as any)[k] ?? "—")}`)
      .join(", ");
    return keys.length > 3 ? `${preview}, +${keys.length - 3} more` : preview;
  }
  return String(value);
}

// ── Module/table name mapping ────────────────────────────────────────────────

const MODULE_LABEL_MAP: Record<string, string> = {
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
  // payroll
  payroll_workers: "Payroll Workers",
  payroll_salaries: "Payroll Salaries",
  // rental
  rental_properties: "Rental Properties",
  rental_payments: "Rental Payments",
  // pos
  pos_shifts: "POS Shifts",
  pos_sales: "POS Sales",
  pos_locations: "POS Locations",
};

/** Returns a human-readable title for a database table name. */
export function tableShortName(t: string): string {
  if (!t) return "Unknown";
  if (MODULE_LABEL_MAP[t]) return MODULE_LABEL_MAP[t];
  // Strip well-known prefixes, then title-case
  return t
    .replace(/^(factory_|payroll_|rental_|pos_)/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Action labels and badge variants ─────────────────────────────────────────

const ACTION_LABEL_MAP: Record<string, string> = {
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
  send_whatsapp: "WhatsApp",
  send_email: "Email",
  approve: "Approved",
  cancel: "Cancelled",
  offload: "Offloaded",
  transfer: "Transferred",
  adjust: "Adjusted",
  login: "Login",
  permission_change: "Permissions",
  settings_change: "Settings",
};

/** Returns a readable label for an audit action string. */
export function actionLabel(action: string): string {
  if (!action) return "—";
  const key = action.toLowerCase();
  if (ACTION_LABEL_MAP[key]) return ACTION_LABEL_MAP[key];
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Maps an audit action to a shadcn Badge variant for color-coding. */
export function actionBadgeVariant(action: string): BadgeVariant {
  const key = (action || "").toLowerCase();
  if (key === "delete" || key === "void" || key === "reverse") return "destructive";
  if (key === "create" || key === "approve" || key === "restore") return "default";
  return "secondary";
}

/** All action values accepted by the /api/audit-log endpoint. */
export const ALL_SUPPORTED_ACTIONS = [
  "create", "update", "delete",
  "restore", "reverse", "void",
  "recalculate", "repair",
  "import", "export",
  "send_whatsapp", "send_email",
  "approve", "cancel",
  "offload", "transfer", "adjust",
  "login", "permission_change", "settings_change",
] as const;

// ── Record / diff helpers ────────────────────────────────────────────────────

export function isItemDiffKey(field: string): boolean {
  return /^item_(added|removed|changed)_/.test(field);
}

export function getRecordLabel(log: any): string {
  if (log.recordIdentifier) {
    const id = log.recordIdentifier as string;
    if (id.length <= 40) return id;
    return id.slice(0, 38) + "…";
  }
  if (log.recordId) return `${log.tableName} #${log.recordId}`;
  return log.tableName;
}

export function getDetailsSentence(log: any): string {
  if (!log.diff || typeof log.diff !== "object") {
    if (log.action === "create") return "Record created";
    if (log.action === "delete") return "Record deleted";
    return "Record updated";
  }
  const keys = Object.keys(log.diff).filter((k) => !isItemDiffKey(k));
  const itemKeys = Object.keys(log.diff).filter((k) => isItemDiffKey(k));
  if (keys.length === 0 && itemKeys.length === 0) {
    if (log.action === "create") return "Record created";
    if (log.action === "delete") return "Record deleted";
    return "Record updated";
  }
  const parts: string[] = [];
  if (keys.length > 0) {
    const changed = keys.slice(0, 3).map((k) => {
      const label = BUSINESS_FIELD_LABELS[k] || fieldLabel(k);
      const val = log.diff[k];
      const newVal = val && typeof val === "object" && "new" in val ? val.new : val;
      return `${label}: ${fmtBusinessValue(k, newVal)}`;
    });
    parts.push(changed.join("; "));
    if (keys.length > 3) parts.push(`+${keys.length - 3} more`);
  }
  if (itemKeys.length > 0) {
    parts.push(`${itemKeys.length} item change${itemKeys.length !== 1 ? "s" : ""}`);
  }
  return parts.join(" — ");
}
