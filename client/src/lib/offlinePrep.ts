import { db, type CachedEntity, type OfflineMeta } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DatasetSpec {
  id: string;
  label: string;
  endpoint: string;
  /** Dexie table key on `db` to bulk-save CachedEntities into, or null = offlinePackages */
  tableKey: keyof typeof db | null;
  /** Extract array of items from API response (handles any response shape) */
  extractItems: (data: any, companyId: number) => CachedEntity[];
}

export interface PrepPack {
  id: string;
  label: string;
  datasets: DatasetSpec[];
}

export interface DatasetResult {
  datasetId: string;
  label: string;
  packId: string;
  success: boolean;
  count: number;
  error?: string;
}

export interface PrepProgress {
  phase: "idle" | "sw" | "preparing" | "verifying" | "done" | "error";
  currentLabel: string;
  totalDatasets: number;
  completedDatasets: number;
  failedDatasets: number;
  percent: number;
  results: DatasetResult[];
  errors: string[];
}

export interface OfflineReadiness {
  ready: boolean;
  partial: boolean;
  preparedAt: number | null;
  completedDatasets: number;
  totalDatasets: number;
  errors: string[];
  packSummary: Record<string, { label: string; count: number; completedAt: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEntity(id: string | number, companyId: number, data: any): CachedEntity {
  return {
    id,
    companyId,
    data: JSON.stringify(data),
    updatedAt: Date.now(),
    fetchedAt: Date.now(),
  };
}

function extractArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  // Common wrapper shapes
  for (const key of [
    "items",
    "data",
    "results",
    "rows",
    "records",
    "containers",
    "suppliers",
    "customers",
    "stock",
    "rawStock",
    "bales",
    "products",
    "accounts",
    "suppliers",
    "categories",
  ]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  // Single object — wrap it
  if (data && typeof data === "object") return [data];
  return [];
}

// ─── Data Packs ───────────────────────────────────────────────────────────────

function buildPacks(): PrepPack[] {
  return [
    {
      id: "shared",
      label: "Shared (user & settings)",
      datasets: [
        {
          id: "user",
          label: "Current user",
          endpoint: "/api/auth/me",
          tableKey: "users",
          extractItems: (data, cid) => [toEntity(data.id ?? "me", cid, data)],
        },
        {
          id: "companies",
          label: "Companies",
          endpoint: "/api/user/companies",
          tableKey: "companies",
          extractItems: (data, _cid) => extractArray(data).map((c: any) => toEntity(c.id, c.id, c)),
        },
        {
          id: "companySettings",
          label: "Company settings",
          endpoint: "/api/company-settings",
          tableKey: "companySettings",
          extractItems: (data, cid) => [toEntity(cid, cid, data)],
        },
        {
          id: "permissions",
          label: "Page permissions",
          endpoint: "/api/my-erp-pages",
          tableKey: "permissions",
          extractItems: (data, cid) => [toEntity(cid, cid, data)],
        },
        {
          id: "exchangeRates",
          label: "Exchange rates",
          endpoint: "/api/exchange-rates",
          tableKey: null,
          extractItems: (data, cid) =>
            extractArray(data).map((r: any) => toEntity(`er_${r.id ?? Math.random()}`, cid, r)),
        },
      ],
    },
    {
      id: "erp",
      label: "ERP (accounts, suppliers, stock)",
      datasets: [
        {
          id: "locations",
          label: "Locations",
          endpoint: "/api/locations",
          tableKey: "locations",
          extractItems: (data, cid) => extractArray(data).map((l: any) => toEntity(l.id, cid, l)),
        },
        {
          id: "ledgerAccounts",
          label: "Ledger accounts",
          endpoint: "/api/ledger-accounts",
          tableKey: "ledgerAccounts",
          extractItems: (data, cid) => extractArray(data).map((a: any) => toEntity(a.id, cid, a)),
        },
        {
          id: "suppliers",
          label: "ERP suppliers",
          endpoint: "/api/suppliers",
          tableKey: "suppliers",
          extractItems: (data, cid) => extractArray(data).map((s: any) => toEntity(s.id, cid, s)),
        },
        {
          id: "customers",
          label: "Customers",
          endpoint: "/api/customers",
          tableKey: "customers",
          extractItems: (data, cid) => extractArray(data).map((c: any) => toEntity(c.id, cid, c)),
        },
        {
          id: "stockItems",
          label: "Stock items",
          endpoint: "/api/stock-items",
          tableKey: "stockItems",
          extractItems: (data, cid) => extractArray(data).map((s: any) => toEntity(s.id, cid, s)),
        },
        {
          id: "inventory",
          label: "Inventory levels",
          endpoint: "/api/inventory",
          tableKey: "inventoryByLocation",
          extractItems: (data, cid) =>
            extractArray(data).map((i: any) =>
              toEntity(`${i.stockItemId ?? i.stock_item_id}_${i.locationId ?? i.location_id}`, cid, i)
            ),
        },
      ],
    },
    {
      id: "pos",
      label: "POS (drafts & bale products)",
      datasets: [
        {
          id: "posDrafts",
          label: "POS drafts",
          endpoint: "/api/pos/drafts",
          tableKey: null,
          extractItems: (data, cid) => extractArray(data).map((d: any) => toEntity(`pos_draft_${d.id}`, cid, d)),
        },
        {
          id: "baleProducts",
          label: "Bale products (ERP)",
          endpoint: "/api/bale-products",
          tableKey: null,
          extractItems: (data, cid) => extractArray(data).map((b: any) => toEntity(`bp_${b.id}`, cid, b)),
        },
        {
          id: "employees",
          label: "Employees",
          endpoint: "/api/employees",
          tableKey: "employees",
          extractItems: (data, cid) => extractArray(data).map((e: any) => toEntity(e.id, cid, e)),
        },
      ],
    },
    {
      id: "factory",
      label: "Factory (containers, stock, bales)",
      datasets: [
        {
          id: "factorySuppliers",
          label: "Factory suppliers",
          endpoint: "/api/factory/suppliers",
          tableKey: "factorySuppliers",
          extractItems: (data, cid) => extractArray(data).map((s: any) => toEntity(s.id, cid, s)),
        },
        {
          id: "factoryCategories",
          label: "Factory categories",
          endpoint: "/api/factory/categories",
          tableKey: "factoryCategories",
          extractItems: (data, cid) => extractArray(data).map((c: any) => toEntity(c.id, cid, c)),
        },
        {
          id: "factoryBaleProducts",
          label: "Factory bale products",
          endpoint: "/api/factory/bale-products",
          tableKey: "factoryBaleProducts",
          extractItems: (data, cid) => extractArray(data).map((b: any) => toEntity(b.id, cid, b)),
        },
        {
          id: "factoryContainers",
          label: "Containers",
          endpoint: "/api/factory/containers",
          tableKey: "factoryContainers",
          extractItems: (data, cid) => extractArray(data).map((c: any) => toEntity(c.id, cid, c)),
        },
        {
          id: "factoryRawStock",
          label: "Raw stock entries",
          endpoint: "/api/factory/raw-stock",
          tableKey: "factoryRawStock",
          extractItems: (data, cid) => extractArray(data).map((r: any) => toEntity(r.id, cid, r)),
        },
        {
          id: "factorySuppliersWithBalances",
          label: "Supplier balances",
          endpoint: "/api/factory/suppliers/with-balances",
          tableKey: null,
          extractItems: (data, cid) => extractArray(data).map((s: any) => toEntity(`fsb_${s.id}`, cid, s)),
        },
        {
          id: "factoryDaybook",
          label: "Factory daybook",
          endpoint: "/api/factory/daybook",
          tableKey: null,
          extractItems: (data, cid) => extractArray(data).map((e: any) => toEntity(e.id ?? Math.random(), cid, e)),
        },
        {
          id: "factoryFxRates",
          label: "FX rates",
          endpoint: "/api/factory/fx-rates",
          tableKey: null,
          extractItems: (data, cid) => extractArray(data).map((r: any) => toEntity(r.id ?? Math.random(), cid, r)),
        },
      ],
    },
  ];
}

// ─── Service Worker Check ─────────────────────────────────────────────────────

async function ensureServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) {
    await navigator.serviceWorker.register("/sw.js");
    // Give SW time to install
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ─── Main Preparation Function ────────────────────────────────────────────────

export async function runOfflinePrep(companyId: number, onProgress: (p: PrepProgress) => void): Promise<PrepProgress> {
  const packs = buildPacks();
  const allDatasets = packs.flatMap((p) => p.datasets.map((d) => ({ ...d, packId: p.id })));
  let total = allDatasets.length;
  const results: DatasetResult[] = [];
  const errors: string[] = [];

  const emit = (phase: PrepProgress["phase"], label: string) => {
    const completed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const done = completed + failed;
    onProgress({
      phase,
      currentLabel: label,
      totalDatasets: total,
      completedDatasets: completed,
      failedDatasets: failed,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      results: [...results],
      errors: [...errors],
    });
  };

  // Step 1: Service worker
  emit("sw", "Checking service worker…");
  try {
    await ensureServiceWorker();
  } catch {
    // Non-fatal
  }

  // Step 2: Download datasets
  emit("preparing", "Starting download…");

  for (const pack of packs) {
    for (const dataset of pack.datasets) {
      emit("preparing", `Downloading ${dataset.label}…`);
      try {
        const res = await fetch(dataset.endpoint, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Guard against HTML responses (e.g. SPA catch-all served instead of JSON)
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("json")) {
          // Non-fatal: some endpoints aren't relevant in factory-only mode
          results.push({ datasetId: dataset.id, label: dataset.label, packId: pack.id, success: true, count: 0 });
          continue;
        }

        const raw = await res.json();

        // Offline-error marker
        if (raw?.offline || raw?.error === "Offline") {
          throw new Error("App is already offline — cannot download");
        }

        const items = dataset.extractItems(raw, companyId);

        if (dataset.tableKey && (db as any)[dataset.tableKey]) {
          const table = (db as any)[dataset.tableKey] as ReturnType<typeof db.users.toCollection>["db"]["table"];
          // Clear existing data for this company, then bulk-insert
          await (db as any)[dataset.tableKey].where("companyId").equals(companyId).delete();
          await (db as any)[dataset.tableKey].bulkPut(items);
        } else {
          // Save as offlinePackages blob
          const existing = await db.offlinePackages.where("key").equals(`pkg_${dataset.id}_${companyId}`).first();
          const pkg = {
            key: `pkg_${dataset.id}_${companyId}`,
            entityType: dataset.id,
            companyId,
            data: JSON.stringify(items.map((e) => JSON.parse(e.data))),
            downloadedAt: Date.now(),
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            version: (existing?.version ?? 0) + 1,
          };
          if (existing?.id) {
            await db.offlinePackages.update(existing.id, pkg);
          } else {
            await db.offlinePackages.add(pkg);
          }
        }

        results.push({
          datasetId: dataset.id,
          label: dataset.label,
          packId: pack.id,
          success: true,
          count: items.length,
        });
      } catch (e: any) {
        const msg = `${dataset.label}: ${e?.message ?? "Unknown error"}`;
        errors.push(msg);
        results.push({
          datasetId: dataset.id,
          label: dataset.label,
          packId: pack.id,
          success: false,
          count: 0,
          error: e?.message,
        });
      }
    }
  }

  // Step 2b: Pre-warm lazy-loaded factory page JS chunks so they work offline
  // without needing a prior visit. Dynamic import() fetches the chunk; the
  // service worker caches it automatically via stale-while-revalidate.
  const pageChunks: Array<{ label: string; loader: () => Promise<any> }> = [
    // ── Core factory pages ───────────────────────────────────────────────
    { label: "Dashboard", loader: () => import("@/pages/factory/FactoryDashboard") },
    { label: "Daybook", loader: () => import("@/pages/factory/FactoryDaybook") },
    { label: "Suppliers", loader: () => import("@/pages/factory/FactorySuppliers") },
    { label: "Containers", loader: () => import("@/pages/factory/FactoryContainers") },
    { label: "Container Create", loader: () => import("@/pages/factory/FactoryContainerCreate") },
    // ── Stock & bales ────────────────────────────────────────────────────
    { label: "Stock Entry", loader: () => import("@/pages/factory/BaleStockEntry") },
    { label: "Bale Products", loader: () => import("@/pages/BaleProducts") },
    { label: "Raw Stock", loader: () => import("@/pages/factory/ProductionRawStock") },
    { label: "Raw Materials Hub", loader: () => import("@/pages/factory/FactoryRawMaterialsHub") },
    { label: "Mix Batches", loader: () => import("@/pages/MixBatches") },
    { label: "Bales Hub", loader: () => import("@/pages/factory/FactoryBalesHub") },
    { label: "Bales History", loader: () => import("@/pages/factory/BalesHistory") },
    { label: "Bale Product History", loader: () => import("@/pages/factory/FactoryBaleProductHistory") },
    { label: "Bale Ledger", loader: () => import("@/pages/BaleLedger") },
    { label: "Bale Relabeling", loader: () => import("@/pages/factory/FactoryBaleRelabeling") },
    { label: "Wipers Re-Entry", loader: () => import("@/pages/factory/WipersReEntry") },
    { label: "Waste Dispatch", loader: () => import("@/pages/factory/WasteDispatch") },
    // ── Inventory & stock queries ────────────────────────────────────────
    { label: "Location Inventory", loader: () => import("@/pages/factory/FactoryLocationInventory") },
    { label: "Stock Query", loader: () => import("@/pages/StockQuery") },
    { label: "Stock Item Detail", loader: () => import("@/pages/factory/FactoryStockItemDetail") },
    { label: "Stock OTW", loader: () => import("@/pages/StockOTW") },
    // ── Accounting ───────────────────────────────────────────────────────
    { label: "Accounts", loader: () => import("@/pages/factory/FactoryAccounts") },
    { label: "Vouchers", loader: () => import("@/pages/factory/FactoryVouchers") },
    { label: "Voucher Edit", loader: () => import("@/pages/VoucherEdit") },
    { label: "Voucher Detail", loader: () => import("@/pages/VoucherDetail") },
    { label: "New Voucher", loader: () => import("@/pages/AccountingCreate") },
    { label: "Ledger Monthly", loader: () => import("@/pages/LedgerMonthlySummary") },
    { label: "Ledger Vouchers", loader: () => import("@/pages/LedgerVouchers") },
    // ── Sales & loadings ─────────────────────────────────────────────────
    { label: "Loadings Hub", loader: () => import("@/pages/factory/FactoryLoadingsHub") },
    { label: "Pending Loadings", loader: () => import("@/pages/factory/FactoryPendingLoadings") },
    { label: "Container Scan", loader: () => import("@/pages/factory/FactoryContainerLoadingScan") },
    { label: "Invoices", loader: () => import("@/pages/factory/FactoryInvoices") },
    { label: "Proformas", loader: () => import("@/pages/factory/FactoryProformas") },
    { label: "Pending Invoices", loader: () => import("@/pages/factory/FactoryPendingInvoices") },
    { label: "Customers", loader: () => import("@/pages/factory/FactoryCustomers") },
    // ── People ───────────────────────────────────────────────────────────
    { label: "Workers", loader: () => import("@/pages/factory/FactoryWorkersHub") },
    { label: "Employees", loader: () => import("@/pages/factory/FactoryEmployees") },
    // ── Intelligence ─────────────────────────────────────────────────────
    { label: "KPIs", loader: () => import("@/pages/factory/FactoryKpis") },
    { label: "Cashflow", loader: () => import("@/pages/factory/FactoryCashflow") },
    { label: "Alerts", loader: () => import("@/pages/factory/FactoryAlerts") },
    { label: "Waste Intelligence", loader: () => import("@/pages/factory/FactoryWaste") },
    { label: "Production Summary", loader: () => import("@/pages/factory/ProductionSummary") },
    // ── Reports & tools ──────────────────────────────────────────────────
    { label: "Supplier Report", loader: () => import("@/pages/factory/FactorySupplierReport") },
    { label: "Supplier Statement", loader: () => import("@/pages/factory/FactorySupplierStatement") },
    { label: "Barcode Lookup", loader: () => import("@/pages/BarcodeLookup") },
    { label: "Import", loader: () => import("@/pages/factory/FactoryImport") },
    { label: "Factory Settings", loader: () => import("@/pages/factory/FactorySettings") },
  ];
  total += pageChunks.length;
  for (const chunk of pageChunks) {
    emit("preparing", `Pre-caching page: ${chunk.label}…`);
    try {
      await chunk.loader();
      results.push({
        datasetId: `chunk_${chunk.label}`,
        label: chunk.label,
        packId: "factory",
        success: true,
        count: 1,
      });
    } catch {
      // Non-fatal — chunk may already be loaded or not exist
      results.push({
        datasetId: `chunk_${chunk.label}`,
        label: chunk.label,
        packId: "factory",
        success: true,
        count: 0,
      });
    }
  }

  // Step 2c: Dynamic — pre-cache every supplier's broker statement so the
  // supplier ledger page works offline without needing a prior visit.
  try {
    const supplierEntities = await db.factorySuppliers.where("companyId").equals(companyId).toArray();
    if (supplierEntities.length > 0) {
      total += supplierEntities.length;
      for (const entity of supplierEntities) {
        let supplier: any = {};
        try {
          supplier = JSON.parse(entity.data);
        } catch {
          /* skip */
        }
        const label = supplier.name || `Supplier ${supplier.id ?? entity.id}`;
        emit("preparing", `Caching ledger: ${label}…`);
        try {
          const r = await fetch(`/api/factory/suppliers/${supplier.id}/broker-statement`, { credentials: "include" });
          results.push({
            datasetId: `ledger_${supplier.id}`,
            label,
            packId: "factory",
            success: r.ok,
            count: r.ok ? 1 : 0,
            error: r.ok ? undefined : `HTTP ${r.status}`,
          });
        } catch {
          // Non-fatal: network down or route not yet visited — SW cache miss is fine
          results.push({ datasetId: `ledger_${supplier.id}`, label, packId: "factory", success: true, count: 0 });
        }
      }
    }
  } catch {
    // Non-fatal — supplier ledger pre-cache is a best-effort step
  }

  // Step 3: Verify
  emit("verifying", "Verifying offline package…");
  const completed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const status: OfflineMeta["status"] = failed === 0 ? "ready" : completed > 0 ? "partial" : "not_ready";

  // Build pack summary
  const packSummary: Record<string, { label: string; count: number; completedAt: number }> = {};
  for (const pack of packs) {
    const packResults = results.filter((r) => r.packId === pack.id && r.success);
    const totalCount = packResults.reduce((s, r) => s + r.count, 0);
    packSummary[pack.id] = { label: pack.label, count: totalCount, completedAt: Date.now() };
  }

  // Write metadata
  const meta: OfflineMeta = {
    key: "main",
    preparedAt: Date.now(),
    status,
    totalDatasets: total,
    completedDatasets: completed,
    errors: JSON.stringify(errors),
    packSummary: JSON.stringify(packSummary),
  };
  const existing = await db.offlineMeta.where("key").equals("main").first();
  if (existing?.id) {
    await db.offlineMeta.update(existing.id, meta);
  } else {
    await db.offlineMeta.add(meta);
  }

  const finalPhase = status === "not_ready" ? "error" : "done";
  const finalProgress: PrepProgress = {
    phase: finalPhase,
    currentLabel:
      status === "ready" ? "All datasets downloaded — device is offline-ready" : `Done with ${failed} error(s)`,
    totalDatasets: total,
    completedDatasets: completed,
    failedDatasets: failed,
    percent: 100,
    results,
    errors,
  };
  onProgress(finalProgress);
  return finalProgress;
}

// ─── Query Readiness ──────────────────────────────────────────────────────────

export async function getOfflineReadiness(): Promise<OfflineReadiness> {
  try {
    const meta = await db.offlineMeta.where("key").equals("main").first();
    if (!meta) {
      return {
        ready: false,
        partial: false,
        preparedAt: null,
        completedDatasets: 0,
        totalDatasets: 0,
        errors: [],
        packSummary: {},
      };
    }
    const packSummary = JSON.parse(meta.packSummary || "{}");
    const errors = JSON.parse(meta.errors || "[]");
    return {
      ready: meta.status === "ready",
      partial: meta.status === "partial",
      preparedAt: meta.preparedAt,
      completedDatasets: meta.completedDatasets,
      totalDatasets: meta.totalDatasets,
      errors,
      packSummary,
    };
  } catch {
    return {
      ready: false,
      partial: false,
      preparedAt: null,
      completedDatasets: 0,
      totalDatasets: 0,
      errors: [],
      packSummary: {},
    };
  }
}

export { buildPacks };
