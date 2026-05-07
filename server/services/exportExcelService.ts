import ExcelJS from "exceljs";
import type { CompanyExportData } from "./exportDataService";

const HDR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const HDR_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const ALT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4FA" } };
const MAX_ROWS = 60000;

// Convert snake_case db column name to a readable Title Case header
function toHeader(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Guess if a column key looks like a numeric/money/qty field
function guessNumFmt(key: string): string | null {
  const k = key.toLowerCase();
  if (/amount|total|balance|salary|rate|price|value|cost|revenue|profit|commission|fee|tax|discount|advance|bonus|deposit|withdrawal|payment|freight|duty|margin/.test(k)) {
    return "#,##0.00";
  }
  if (/qty|quantity|weight|kg|count|bales|units|percentage|pct/.test(k)) {
    return "#,##0.###";
  }
  if (/fx_rate|exchange_rate/.test(k)) {
    return "#,##0.000000";
  }
  return null;
}

// Guess column width based on key name
function guessWidth(key: string): number {
  const k = key.toLowerCase();
  if (/narration|description|notes|message|address|changes|reason|error/.test(k)) return 45;
  if (/name|legal_name|email/.test(k)) return 28;
  if (/number|voucher_number|container_number|reference|barcode|code/.test(k)) return 22;
  if (/date|at|created|updated/.test(k)) return 22;
  if (/amount|total|balance|salary|value|cost|revenue|profit/.test(k)) return 18;
  return 16;
}

function formatValue(val: any): any {
  if (val === null || val === undefined) return "";
  if (val instanceof Date) return val.toISOString().substring(0, 19).replace("T", " ");
  // Stringify objects/arrays (e.g. JSONB columns)
  if (typeof val === "object") return JSON.stringify(val);
  return val;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function styleHeaderRow(ws: ExcelJS.Worksheet, colCount: number) {
  const hdr = ws.getRow(1);
  for (let i = 1; i <= colCount; i++) {
    const cell = hdr.getCell(i);
    cell.fill = HDR_FILL;
    cell.font = HDR_FONT;
    cell.border = { bottom: { style: "thin", color: { argb: "FF3B82F6" } } };
    cell.alignment = { vertical: "middle" };
  }
  hdr.height = 20;
}

// Auto-detect all columns from data rows and export every field.
// Empty sheets are created as hidden so they can be unhidden manually in Excel.
// NOTE: Per-cell fill and numFmt are intentionally avoided — they create one cell
// object per cell in the ExcelJS model, causing OOM crashes on large sheets.
// numFmt is applied at the column level (one shared style object per column).
function addSheet(wb: ExcelJS.Workbook, name: string, rows: any[]) {
  const sheetBase = name.substring(0, 31);

  if (!rows || rows.length === 0) {
    const ws = wb.addWorksheet(sheetBase);
    ws.state = "hidden";
    return;
  }

  // Collect all unique keys across first 200 rows (handles sparse rows)
  const keysSet = new Set<string>();
  const sample = rows.slice(0, 200);
  for (const row of sample) {
    if (row && typeof row === "object") {
      for (const key of Object.keys(row)) keysSet.add(key);
    }
  }
  const keys = Array.from(keysSet);

  const columns = keys.map(key => ({
    key,
    header: toHeader(key),
    width: guessWidth(key),
    numFmt: guessNumFmt(key),
  }));

  const chunks = chunkArray(rows, MAX_ROWS);
  chunks.forEach((chunk, idx) => {
    const sheetName = chunks.length > 1
      ? `${name.substring(0, 28)} ${idx + 1}`
      : sheetBase;

    const ws = wb.addWorksheet(sheetName);

    // Set numFmt at column level — one shared style per column instead of one
    // cell object per row × column. Critical for keeping memory bounded.
    ws.columns = columns.map(c => ({
      header:  c.header,
      key:     c.key,
      width:   c.width,
      style:   c.numFmt ? { numFmt: c.numFmt } : undefined,
    }));

    styleHeaderRow(ws, columns.length);

    // Plain row insertion — no per-cell styling to avoid O(rows × cols) objects.
    for (const row of chunk) {
      ws.addRow(columns.map(c => formatValue(row[c.key])));
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  });
}

function addSummarySheet(wb: ExcelJS.Workbook, data: CompanyExportData) {
  const sl = (arr: any[] | undefined | null): number => (Array.isArray(arr) ? arr.length : 0);
  const ws = wb.addWorksheet("SUMMARY");
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 18;

  const title = ws.addRow([`Full Data Export — ${data.company?.name || ""}`]);
  title.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  ws.addRow(["Generated at", new Date().toISOString()]);
  ws.addRow([]);

  const headerRow = ws.addRow(["Data Category", "Record Count"]);
  headerRow.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; });
  headerRow.height = 18;

  const counts: [string, number][] = [
    ["Company Info", 1],
    ["Company Settings", sl(data.companySettings)],
    ["Locations", sl(data.locations)],
    ["Ledger Accounts", sl(data.ledgerAccounts)],
    ["Bank Accounts", sl(data.bankAccounts)],
    ["Fixed Assets", sl(data.fixedAssets)],
    ["Exchange Rates", sl(data.exchangeRates)],
    ["Fiscal Period Closures", sl(data.fiscalPeriodClosures)],
    ["Reference Sequences", sl(data.referenceSequences)],
    ["Agent Accounts", sl(data.agentAccounts)],
    ["Vouchers", sl(data.vouchers)],
    ["Voucher Entries", sl(data.voucherEntries)],
    ["Suppliers", sl(data.suppliers)],
    ["Supplier Transactions", sl(data.supplierTransactions)],
    ["Supplier Proformas", sl(data.supplierProformas)],
    ["Supplier Proforma Lines", sl(data.supplierProformaLines)],
    ["Supplier Containers", sl(data.supplierContainers)],
    ["Supplier Container Items", sl(data.supplierContainerLoadedItems)],
    ["Customers", sl(data.customers)],
    ["Customer Transactions", sl(data.customerTransactions)],
    ["Customer Balances", sl(data.customerBalances)],
    ["Customer Orders", sl(data.customerOrders)],
    ["Customer Order Lines", sl(data.customerOrderLines)],
    ["Customer Order Bales", sl(data.customerOrderBales)],
    ["Customer Order Charges", sl(data.customerOrderCharges)],
    ["Customer Proformas", sl(data.customerProformas)],
    ["Customer Proforma Lines", sl(data.customerProformaLines)],
    ["Credit Note Items", sl(data.creditNoteItems)],
    ["Employees", sl(data.employees)],
    ["Payroll Runs", sl(data.employeePayrolls)],
    ["Payroll Run Items", sl(data.employeePayrollItems)],
    ["Employee Advances", sl(data.employeeAdvances)],
    ["Salary Advances", sl(data.salaryAdvances)],
    ["Salary Advance Deductions", sl(data.salaryAdvanceDeductions)],
    ["Employee Advance Repayments", sl(data.employeeAdvanceRepayments)],
    ["Employee Attendance", sl(data.employeeAttendance)],
    ["Employee Bonuses", sl(data.employeeBonuses)],
    ["Employee Groups", sl(data.employeeGroups)],
    ["Employee Group Members", sl(data.employeeGroupMembers)],
    ["Employee Bale Rates", sl(data.employeeBaleRates)],
    ["Employee Bale Pct Rates", sl(data.employeeBalePercentRates)],
    ["Worker Documents (ERP)", sl(data.workerDocs)],
    ["Factory Workers", sl(data.factoryWorkers)],
    ["Factory Worker Categories", sl(data.factoryWorkerCategories)],
    ["Factory Worker Documents", sl(data.factoryWorkerDocuments)],
    ["Factory Worker Advances", sl(data.factoryWorkerAdvances)],
    ["Factory Advance Repayments", sl(data.factoryAdvanceRepayments)],
    ["Factory Payrolls", sl(data.factoryPayrolls)],
    ["Factory Attendance", sl(data.factoryAttendance)],
    ["Worker Bonuses", sl(data.workerBonuses)],
    ["Factory Settings", sl(data.factorySettings)],
    ["Factory Categories", sl(data.factoryCategories)],
    ["Factory Daybook", sl(data.factoryDaybook)],
    ["Daybook Entry Edits", sl(data.factoryDaybookEdits)],
    ["Factory KPI Snapshots", sl(data.factoryDailyKpiSnapshots)],
    ["Factory Daily Usages", sl(data.factoryDailyUsages)],
    ["Factory Alerts", sl(data.factoryAlerts)],
    ["Factory Duty Audit Log", sl(data.factoryDutyAuditLog)],
    ["Factory Raw Stock", sl(data.factoryRawStock)],
    ["Raw Material Adjustments", sl(data.factoryRawMaterialAdjustments)],
    ["Factory Pressing Batches", sl(data.factoryPressingBatches)],
    ["Pressing Batches", sl(data.pressingBatches)],
    ["Factory Mix Batches", sl(data.factoryMixBatches)],
    ["Factory Mix Batch Sources", sl(data.factoryMixBatchSources)],
    ["Mix Batches", sl(data.mixBatches)],
    ["Mix Batch Sources", sl(data.mixBatchSources)],
    ["Production Bales", sl(data.productionBales)],
    ["Production Raw Stock", sl(data.productionRawStock)],
    ["Factory Bale Products", sl(data.factoryBaleProducts)],
    ["Factory Bales", sl(data.factoryBales)],
    ["Factory Bale Sequences", sl(data.factoryBaleSequences)],
    ["Factory Bale Cost Snapshots", sl(data.factoryBaleCostSnapshots)],
    ["Factory Bale Waste Dispatches", sl(data.factoryBaleWasteDispatches)],
    ["Factory Waste Entries", sl(data.factoryWasteEntries)],
    ["Factory Containers", sl(data.factoryContainers)],
    ["Factory Container Commissions", sl(data.factoryContainerCommissions)],
    ["Factory Container Other Charges", sl(data.factoryContainerOtherCharges)],
    ["Factory Container P&L Snapshots", sl(data.factoryContainerProfitSnapshots)],
    ["Offload Additional Charges", sl(data.factoryOffloadAdditionalCharges)],
    ["Factory Suppliers", sl(data.factorySuppliers)],
    ["Factory Supplier Payments", sl(data.factorySupplierPayments)],
    ["Factory Supplier FX Transfers", sl(data.factorySupplierFxTransfers)],
    ["Factory Supplier Scores", sl(data.factorySupplierScoreSnapshots)],
    ["Factory FX Rates", sl(data.factoryFxRates)],
    ["Factory FX Allocations", sl(data.factoryFxAllocations)],
    ["Factory POS Sales", sl(data.factoryPosSales)],
    ["Factory POS Sale Items", sl(data.factoryPosSaleItems)],
    ["Bales (Sorting)", sl(data.bales)],
    ["Bale Products", sl(data.baleProducts)],
    ["Bale Product Categories", sl(data.baleProductCategories)],
    ["Bale Sequences", sl(data.baleSequences)],
    ["Bale Label Prints", sl(data.baleLabelPrints)],
    ["Bale Transfers", sl(data.baleTransfers)],
    ["Bale Transfer Items", sl(data.baleTransferItems)],
    ["Bale Recode Sessions", sl(data.baleRecodeSessions)],
    ["Bale Recode Items", sl(data.baleRecodeItems)],
    ["Stock Groups", sl(data.stockGroups)],
    ["Stock Items", sl(data.stockItems)],
    ["Stock Item Aliases", sl(data.stockItemCodeAliases)],
    ["Stock Item Location Prices", sl(data.stockItemLocationPrices)],
    ["Inventory by Location", sl(data.inventory)],
    ["Inventory Negative Layers", sl(data.inventoryNegativeLayers)],
    ["Stock Group Archives", sl(data.stockGroupLocationArchives)],
    ["Stock Group Archive Items", sl(data.stockGroupLocationArchiveItems)],
    ["Stock Transfers", sl(data.stockTransfers)],
    ["Transfer Items", sl(data.stockTransferItems)],
    ["Transfer Revisions", sl(data.stockTransferRevisions)],
    ["Revision Items", sl(data.stockTransferRevisionItems)],
    ["Stock Adjustments", sl(data.stockAdjustments)],
    ["Adjustment Items", sl(data.stockAdjustmentItems)],
    ["Proforma Reservations", sl(data.proformaStockReservations)],
    ["Containers", sl(data.containers)],
    ["Container Charges", sl(data.containerCharges)],
    ["Container Offloads", sl(data.containerOffloads)],
    ["Offload Items", sl(data.containerOffloadItems)],
    ["Container Freight", sl(data.containerFreight)],
    ["Container Freight Payments", sl(data.containerFreightPayments)],
    ["Container Documents", sl(data.containerDocuments)],
    ["Container Sales", sl(data.containerSales)],
    ["Purchase Orders", sl(data.purchaseOrders)],
    ["PO Line Items", sl(data.poLineItems)],
    ["POS Shifts", sl(data.posShifts)],
    ["Sales Items", sl(data.salesItems)],
    ["Waste Dispatches", sl(data.wasteDispatches)],
    ["Waste Dispatch Items", sl(data.wasteDispatchItems)],
    ["Spreadsheets", sl(data.spreadsheets)],
    ["Import Logs", sl(data.importLogs)],
    ["Audit Log", sl(data.auditLog)],
    ["— FACTORY ENRICHED VIEWS —", 0],
    ["Factory Bale Production Detail", sl(data.factoryBaleDetail)],
    ["Factory Worker Advances Detail", sl(data.factoryWorkerAdvancesDetail)],
    ["Factory Payroll Detail", sl(data.factoryPayrollDetail)],
    ["Factory Container Detail", sl(data.factoryContainerDetail)],
    ["Factory Supplier Payments Detail", sl(data.factorySupplierPaymentsDetail)],
    ["Factory Raw Stock Detail", sl(data.factoryRawStockDetail)],
    ["Factory Mix Batch Detail", sl(data.factoryMixBatchDetail)],
    ["Factory POS Sales Detail", sl(data.factoryPosSalesDetail)],
    ["— ERP ENRICHED VIEWS —", 0],
    ["Voucher Lines Detail", sl(data.voucherLinesDetail)],
    ["PO Detail (flat)", sl(data.poDetail)],
    ["Stock Transfer Detail", sl(data.stockTransferDetail)],
    ["Supplier Balances", sl(data.supplierBalances)],
    ["Supplier Txn Detail", sl(data.supplierTxnDetail)],
    ["Customer Balances Detail", sl(data.customerBalancesDetail)],
    ["Customer Order Detail", sl(data.customerOrderDetail)],
    ["Credit-Debit Note Detail", sl(data.creditNoteDetail)],
    ["Salary Advances Detail", sl(data.salaryAdvancesDetail)],
    ["Employee Txn Detail", sl(data.employeeTxnDetail)],
    ["Location Stock Detail", sl(data.locationStockDetail)],
  ];

  const total = counts.reduce((s, [, n]) => s + n, 0);

  counts.forEach(([label, count], i) => {
    const r = ws.addRow([label, count]);
    r.getCell(2).numFmt = "#,##0";
    if (i % 2 === 1) r.eachCell(c => { c.fill = ALT_FILL; });
  });

  ws.addRow([]);
  const totalRow = ws.addRow(["TOTAL RECORDS", total]);
  totalRow.getCell(1).font = { bold: true, size: 11 };
  totalRow.getCell(2).font = { bold: true, size: 11 };
  totalRow.getCell(2).numFmt = "#,##0";
}

/**
 * Write the company workbook directly to `outputStream` without buffering the
 * entire file in RAM.  The caller is responsible for ending the stream after
 * this resolves (or letting ExcelJS handle it via wb.xlsx.write which ends the
 * stream internally).
 */
export async function buildCompanyWorkbook(
  data: CompanyExportData,
  outputStream: NodeJS.WritableStream,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP System";
  wb.created = new Date();

  addSummarySheet(wb, data);

  // ── Company ───────────────────────────────────────────────────────────────
  addSheet(wb, "Company Info", [data.company]);
  addSheet(wb, "Company Settings", data.companySettings);
  addSheet(wb, "Locations", data.locations);

  // ── Finance ───────────────────────────────────────────────────────────────
  addSheet(wb, "Ledger Accounts", data.ledgerAccounts);
  addSheet(wb, "Bank Accounts", data.bankAccounts);
  addSheet(wb, "Fixed Assets", data.fixedAssets);
  addSheet(wb, "Exchange Rates", data.exchangeRates);
  addSheet(wb, "Fiscal Period Closures", data.fiscalPeriodClosures);
  addSheet(wb, "Reference Sequences", data.referenceSequences);
  addSheet(wb, "Agent Accounts", data.agentAccounts);

  // ── Vouchers ──────────────────────────────────────────────────────────────
  addSheet(wb, "Vouchers", data.vouchers);
  addSheet(wb, "Voucher Entries", data.voucherEntries);

  // ── Suppliers ─────────────────────────────────────────────────────────────
  addSheet(wb, "Suppliers", data.suppliers);
  addSheet(wb, "Supplier Transactions", data.supplierTransactions);
  addSheet(wb, "Supplier Proformas", data.supplierProformas);
  addSheet(wb, "Supplier Proforma Lines", data.supplierProformaLines);
  addSheet(wb, "Supplier Containers", data.supplierContainers);
  addSheet(wb, "Supplier Container Items", data.supplierContainerLoadedItems);

  // ── Customers ─────────────────────────────────────────────────────────────
  addSheet(wb, "Customers", data.customers);
  addSheet(wb, "Customer Transactions", data.customerTransactions);
  addSheet(wb, "Customer Balances", data.customerBalances);
  addSheet(wb, "Customer Orders", data.customerOrders);
  addSheet(wb, "Customer Order Lines", data.customerOrderLines);
  addSheet(wb, "Customer Order Bales", data.customerOrderBales);
  addSheet(wb, "Customer Order Charges", data.customerOrderCharges);
  addSheet(wb, "Customer Proformas", data.customerProformas);
  addSheet(wb, "Customer Proforma Lines", data.customerProformaLines);
  addSheet(wb, "Credit Note Items", data.creditNoteItems);

  // ── Employees ─────────────────────────────────────────────────────────────
  addSheet(wb, "Employees", data.employees);
  addSheet(wb, "Payroll Runs", data.employeePayrolls);
  addSheet(wb, "Payroll Run Items", data.employeePayrollItems);
  addSheet(wb, "Employee Advances", data.employeeAdvances);
  addSheet(wb, "Salary Advances", data.salaryAdvances);
  addSheet(wb, "Salary Advance Deductions", data.salaryAdvanceDeductions);
  addSheet(wb, "Employee Advance Repayments", data.employeeAdvanceRepayments);
  addSheet(wb, "Employee Attendance", data.employeeAttendance);
  addSheet(wb, "Employee Bonuses", data.employeeBonuses);
  addSheet(wb, "Employee Groups", data.employeeGroups);
  addSheet(wb, "Employee Group Members", data.employeeGroupMembers);
  addSheet(wb, "Employee Bale Rates", data.employeeBaleRates);
  addSheet(wb, "Employee Bale Pct Rates", data.employeeBalePercentRates);
  addSheet(wb, "Worker Documents", data.workerDocs);

  // ── Factory Workers ───────────────────────────────────────────────────────
  addSheet(wb, "Factory Workers", data.factoryWorkers);
  addSheet(wb, "Factory Worker Categories", data.factoryWorkerCategories);
  addSheet(wb, "Factory Worker Documents", data.factoryWorkerDocuments);
  addSheet(wb, "Factory Worker Advances", data.factoryWorkerAdvances);
  addSheet(wb, "Factory Advance Repayments", data.factoryAdvanceRepayments);
  addSheet(wb, "Factory Payrolls", data.factoryPayrolls);
  addSheet(wb, "Factory Attendance", data.factoryAttendance);
  addSheet(wb, "Worker Bonuses", data.workerBonuses);

  // ── Factory Operations ────────────────────────────────────────────────────
  addSheet(wb, "Factory Settings", data.factorySettings);
  addSheet(wb, "Factory Categories", data.factoryCategories);
  addSheet(wb, "Factory Daybook", data.factoryDaybook);
  addSheet(wb, "Daybook Entry Edits", data.factoryDaybookEdits);
  addSheet(wb, "Factory KPI Snapshots", data.factoryDailyKpiSnapshots);
  addSheet(wb, "Factory Daily Usages", data.factoryDailyUsages);
  addSheet(wb, "Factory Alerts", data.factoryAlerts);
  addSheet(wb, "Factory Duty Audit Log", data.factoryDutyAuditLog);

  // ── Factory Raw / Production ──────────────────────────────────────────────
  addSheet(wb, "Factory Raw Stock", data.factoryRawStock);
  addSheet(wb, "Raw Material Adjustments", data.factoryRawMaterialAdjustments);
  addSheet(wb, "Factory Pressing Batches", data.factoryPressingBatches);
  addSheet(wb, "Pressing Batches", data.pressingBatches);
  addSheet(wb, "Factory Mix Batches", data.factoryMixBatches);
  addSheet(wb, "Factory Mix Batch Sources", data.factoryMixBatchSources);
  addSheet(wb, "Mix Batches", data.mixBatches);
  addSheet(wb, "Mix Batch Sources", data.mixBatchSources);
  addSheet(wb, "Production Bales", data.productionBales);
  addSheet(wb, "Production Raw Stock", data.productionRawStock);

  // ── Factory Bales ─────────────────────────────────────────────────────────
  addSheet(wb, "Factory Bale Products", data.factoryBaleProducts);
  addSheet(wb, "Factory Bales", data.factoryBales);
  addSheet(wb, "Factory Bale Sequences", data.factoryBaleSequences);
  addSheet(wb, "Factory Bale Cost Snapshots", data.factoryBaleCostSnapshots);
  addSheet(wb, "Factory Bale Waste Dispatches", data.factoryBaleWasteDispatches);
  addSheet(wb, "Factory Waste Entries", data.factoryWasteEntries);

  // ── Factory Containers ────────────────────────────────────────────────────
  addSheet(wb, "Factory Containers", data.factoryContainers);
  addSheet(wb, "Factory Ctnr Commissions", data.factoryContainerCommissions);
  addSheet(wb, "Factory Ctnr Other Charges", data.factoryContainerOtherCharges);
  addSheet(wb, "Factory Ctnr PL Snapshots", data.factoryContainerProfitSnapshots);
  addSheet(wb, "Offload Additional Charges", data.factoryOffloadAdditionalCharges);

  // ── Factory Suppliers ─────────────────────────────────────────────────────
  addSheet(wb, "Factory Suppliers", data.factorySuppliers);
  addSheet(wb, "Factory Supplier Payments", data.factorySupplierPayments);
  addSheet(wb, "Factory Supplier FX Xfers", data.factorySupplierFxTransfers);
  addSheet(wb, "Factory Supplier Scores", data.factorySupplierScoreSnapshots);

  // ── Factory FX & POS ──────────────────────────────────────────────────────
  addSheet(wb, "Factory FX Rates", data.factoryFxRates);
  addSheet(wb, "Factory FX Allocations", data.factoryFxAllocations);
  addSheet(wb, "Factory POS Sales", data.factoryPosSales);
  addSheet(wb, "Factory POS Sale Items", data.factoryPosSaleItems);

  // ── Bales (Sorting) ───────────────────────────────────────────────────────
  addSheet(wb, "Bales (Sorting)", data.bales);
  addSheet(wb, "Bale Products", data.baleProducts);
  addSheet(wb, "Bale Product Categories", data.baleProductCategories);
  addSheet(wb, "Bale Sequences", data.baleSequences);
  addSheet(wb, "Bale Label Prints", data.baleLabelPrints);
  addSheet(wb, "Bale Transfers", data.baleTransfers);
  addSheet(wb, "Bale Transfer Items", data.baleTransferItems);
  addSheet(wb, "Bale Recode Sessions", data.baleRecodeSessions);
  addSheet(wb, "Bale Recode Items", data.baleRecodeItems);

  // ── Stock ─────────────────────────────────────────────────────────────────
  addSheet(wb, "Stock Groups", data.stockGroups);
  addSheet(wb, "Stock Items", data.stockItems);
  addSheet(wb, "Stock Item Aliases", data.stockItemCodeAliases);
  addSheet(wb, "Stock Item Location Prices", data.stockItemLocationPrices);
  addSheet(wb, "Inventory by Location", data.inventory);
  addSheet(wb, "Inventory Negative Layers", data.inventoryNegativeLayers);
  addSheet(wb, "Stock Group Archives", data.stockGroupLocationArchives);
  addSheet(wb, "Stock Group Archive Items", data.stockGroupLocationArchiveItems);
  addSheet(wb, "Stock Transfers", data.stockTransfers);
  addSheet(wb, "Transfer Items", data.stockTransferItems);
  addSheet(wb, "Transfer Revisions", data.stockTransferRevisions);
  addSheet(wb, "Revision Items", data.stockTransferRevisionItems);
  addSheet(wb, "Stock Adjustments", data.stockAdjustments);
  addSheet(wb, "Adjustment Items", data.stockAdjustmentItems);
  addSheet(wb, "Proforma Reservations", data.proformaStockReservations);

  // ── Containers ────────────────────────────────────────────────────────────
  addSheet(wb, "Containers Detail", data.containersDetail);
  addSheet(wb, "Containers", data.containers);
  addSheet(wb, "Container Charges", data.containerCharges);
  addSheet(wb, "Container Offloads", data.containerOffloads);
  addSheet(wb, "Offload Items", data.containerOffloadItems);
  addSheet(wb, "Container Freight", data.containerFreight);
  addSheet(wb, "Container Freight Payments", data.containerFreightPayments);
  addSheet(wb, "Container Documents", data.containerDocuments);
  addSheet(wb, "Container Sales", data.containerSales);

  // ── Purchase Orders ───────────────────────────────────────────────────────
  addSheet(wb, "Purchase Orders", data.purchaseOrders);
  addSheet(wb, "PO Line Items", data.poLineItems);

  // ── POS ───────────────────────────────────────────────────────────────────
  addSheet(wb, "POS Shifts", data.posShifts);
  addSheet(wb, "Sales Items", data.salesItems);

  // ── Waste ─────────────────────────────────────────────────────────────────
  addSheet(wb, "Waste Dispatches", data.wasteDispatches);
  addSheet(wb, "Waste Dispatch Items", data.wasteDispatchItems);

  // ── Misc ──────────────────────────────────────────────────────────────────
  addSheet(wb, "Spreadsheets", data.spreadsheets);
  addSheet(wb, "Import Logs", data.importLogs);

  // ── Audit ─────────────────────────────────────────────────────────────────
  addSheet(wb, "Audit Log", data.auditLog);

  // ── Factory Enriched Detail Views ─────────────────────────────────────────
  addSheet(wb, "Factory Bale Production", data.factoryBaleDetail);
  addSheet(wb, "Factory Wkr Advances Detail", data.factoryWorkerAdvancesDetail);
  addSheet(wb, "Factory Payroll Detail", data.factoryPayrollDetail);
  addSheet(wb, "Factory Container Detail", data.factoryContainerDetail);
  addSheet(wb, "Factory Supplier Pay Detail", data.factorySupplierPaymentsDetail);
  addSheet(wb, "Factory Raw Stock Detail", data.factoryRawStockDetail);
  addSheet(wb, "Factory Mix Batch Detail", data.factoryMixBatchDetail);
  addSheet(wb, "Factory POS Sales Detail", data.factoryPosSalesDetail);

  // ── ERP Enriched Detail Views ─────────────────────────────────────────────
  addSheet(wb, "Voucher Lines Detail", data.voucherLinesDetail);
  addSheet(wb, "PO Detail", data.poDetail);
  addSheet(wb, "Stock Transfer Detail", data.stockTransferDetail);
  addSheet(wb, "Supplier Balances", data.supplierBalances);
  addSheet(wb, "Supplier Txn Detail", data.supplierTxnDetail);
  addSheet(wb, "Customer Balances Detail", data.customerBalancesDetail);
  addSheet(wb, "Customer Order Detail", data.customerOrderDetail);
  addSheet(wb, "Credit-Debit Note Detail", data.creditNoteDetail);
  addSheet(wb, "Salary Advances Detail", data.salaryAdvancesDetail);
  addSheet(wb, "Employee Txn Detail", data.employeeTxnDetail);
  addSheet(wb, "Location Stock Detail", data.locationStockDetail);

  await wb.xlsx.write(outputStream);
}
