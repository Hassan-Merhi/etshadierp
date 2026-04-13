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

// Auto-detect all columns from data rows and export every field
// Empty sheets are created as hidden so they can be unhidden manually in Excel
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
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));
    styleHeaderRow(ws, columns.length);

    chunk.forEach((row, ri) => {
      const values = columns.map(c => formatValue(row[c.key]));
      const r = ws.addRow(values);
      if (ri % 2 === 1) {
        r.eachCell(cell => { cell.fill = ALT_FILL; });
      }
      columns.forEach((c, ci) => {
        if (c.numFmt) r.getCell(ci + 1).numFmt = c.numFmt;
      });
    });

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  });
}

function addSummarySheet(wb: ExcelJS.Workbook, data: CompanyExportData) {
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
    ["Company Settings", data.companySettings.length],
    ["Locations", data.locations.length],
    ["Ledger Accounts", data.ledgerAccounts.length],
    ["Bank Accounts", data.bankAccounts.length],
    ["Fixed Assets", data.fixedAssets.length],
    ["Exchange Rates", data.exchangeRates.length],
    ["Fiscal Period Closures", data.fiscalPeriodClosures.length],
    ["Reference Sequences", data.referenceSequences.length],
    ["Agent Accounts", data.agentAccounts.length],
    ["Vouchers", data.vouchers.length],
    ["Voucher Entries", data.voucherEntries.length],
    ["Suppliers", data.suppliers.length],
    ["Supplier Transactions", data.supplierTransactions.length],
    ["Supplier Proformas", data.supplierProformas.length],
    ["Supplier Proforma Lines", data.supplierProformaLines.length],
    ["Supplier Containers", data.supplierContainers.length],
    ["Supplier Container Items", data.supplierContainerLoadedItems.length],
    ["Customers", data.customers.length],
    ["Customer Transactions", data.customerTransactions.length],
    ["Customer Balances", data.customerBalances.length],
    ["Customer Orders", data.customerOrders.length],
    ["Customer Order Lines", data.customerOrderLines.length],
    ["Customer Order Bales", data.customerOrderBales.length],
    ["Customer Order Charges", data.customerOrderCharges.length],
    ["Customer Proformas", data.customerProformas.length],
    ["Customer Proforma Lines", data.customerProformaLines.length],
    ["Credit Note Items", data.creditNoteItems.length],
    ["Employees", data.employees.length],
    ["Payroll Runs", data.employeePayrolls.length],
    ["Payroll Run Items", data.employeePayrollItems.length],
    ["Employee Advances", data.employeeAdvances.length],
    ["Salary Advances", data.salaryAdvances.length],
    ["Salary Advance Deductions", data.salaryAdvanceDeductions.length],
    ["Employee Advance Repayments", data.employeeAdvanceRepayments.length],
    ["Employee Attendance", data.employeeAttendance.length],
    ["Employee Bonuses", data.employeeBonuses.length],
    ["Employee Groups", data.employeeGroups.length],
    ["Employee Group Members", data.employeeGroupMembers.length],
    ["Employee Bale Rates", data.employeeBaleRates.length],
    ["Employee Bale Pct Rates", data.employeeBalePercentRates.length],
    ["Worker Documents (ERP)", data.workerDocs.length],
    ["Factory Workers", data.factoryWorkers.length],
    ["Factory Worker Categories", data.factoryWorkerCategories.length],
    ["Factory Worker Documents", data.factoryWorkerDocuments.length],
    ["Factory Worker Advances", data.factoryWorkerAdvances.length],
    ["Factory Advance Repayments", data.factoryAdvanceRepayments.length],
    ["Factory Payrolls", data.factoryPayrolls.length],
    ["Factory Attendance", data.factoryAttendance.length],
    ["Worker Bonuses", data.workerBonuses.length],
    ["Factory Settings", data.factorySettings.length],
    ["Factory Categories", data.factoryCategories.length],
    ["Factory Daybook", data.factoryDaybook.length],
    ["Daybook Entry Edits", data.factoryDaybookEdits.length],
    ["Factory KPI Snapshots", data.factoryDailyKpiSnapshots.length],
    ["Factory Daily Usages", data.factoryDailyUsages.length],
    ["Factory Alerts", data.factoryAlerts.length],
    ["Factory Duty Audit Log", data.factoryDutyAuditLog.length],
    ["Factory Raw Stock", data.factoryRawStock.length],
    ["Raw Material Adjustments", data.factoryRawMaterialAdjustments.length],
    ["Factory Pressing Batches", data.factoryPressingBatches.length],
    ["Pressing Batches", data.pressingBatches.length],
    ["Factory Mix Batches", data.factoryMixBatches.length],
    ["Factory Mix Batch Sources", data.factoryMixBatchSources.length],
    ["Mix Batches", data.mixBatches.length],
    ["Mix Batch Sources", data.mixBatchSources.length],
    ["Production Bales", data.productionBales.length],
    ["Production Raw Stock", data.productionRawStock.length],
    ["Factory Bale Products", data.factoryBaleProducts.length],
    ["Factory Bales", data.factoryBales.length],
    ["Factory Bale Sequences", data.factoryBaleSequences.length],
    ["Factory Bale Cost Snapshots", data.factoryBaleCostSnapshots.length],
    ["Factory Bale Waste Dispatches", data.factoryBaleWasteDispatches.length],
    ["Factory Waste Entries", data.factoryWasteEntries.length],
    ["Factory Containers", data.factoryContainers.length],
    ["Factory Container Commissions", data.factoryContainerCommissions.length],
    ["Factory Container Other Charges", data.factoryContainerOtherCharges.length],
    ["Factory Container P&L Snapshots", data.factoryContainerProfitSnapshots.length],
    ["Offload Additional Charges", data.factoryOffloadAdditionalCharges.length],
    ["Factory Suppliers", data.factorySuppliers.length],
    ["Factory Supplier Payments", data.factorySupplierPayments.length],
    ["Factory Supplier FX Transfers", data.factorySupplierFxTransfers.length],
    ["Factory Supplier Scores", data.factorySupplierScoreSnapshots.length],
    ["Factory FX Rates", data.factoryFxRates.length],
    ["Factory FX Allocations", data.factoryFxAllocations.length],
    ["Factory POS Sales", data.factoryPosSales.length],
    ["Factory POS Sale Items", data.factoryPosSaleItems.length],
    ["Bales (Sorting)", data.bales.length],
    ["Bale Products", data.baleProducts.length],
    ["Bale Product Categories", data.baleProductCategories.length],
    ["Bale Sequences", data.baleSequences.length],
    ["Bale Label Prints", data.baleLabelPrints.length],
    ["Bale Transfers", data.baleTransfers.length],
    ["Bale Transfer Items", data.baleTransferItems.length],
    ["Bale Recode Sessions", data.baleRecodeSessions.length],
    ["Bale Recode Items", data.baleRecodeItems.length],
    ["Stock Groups", data.stockGroups.length],
    ["Stock Items", data.stockItems.length],
    ["Stock Item Aliases", data.stockItemCodeAliases.length],
    ["Stock Item Location Prices", data.stockItemLocationPrices.length],
    ["Inventory by Location", data.inventory.length],
    ["Inventory Negative Layers", data.inventoryNegativeLayers.length],
    ["Stock Group Archives", data.stockGroupLocationArchives.length],
    ["Stock Group Archive Items", data.stockGroupLocationArchiveItems.length],
    ["Stock Transfers", data.stockTransfers.length],
    ["Transfer Items", data.stockTransferItems.length],
    ["Transfer Revisions", data.stockTransferRevisions.length],
    ["Revision Items", data.stockTransferRevisionItems.length],
    ["Stock Adjustments", data.stockAdjustments.length],
    ["Adjustment Items", data.stockAdjustmentItems.length],
    ["Proforma Reservations", data.proformaStockReservations.length],
    ["Containers", data.containers.length],
    ["Container Charges", data.containerCharges.length],
    ["Container Offloads", data.containerOffloads.length],
    ["Offload Items", data.containerOffloadItems.length],
    ["Container Freight", data.containerFreight.length],
    ["Container Freight Payments", data.containerFreightPayments.length],
    ["Container Documents", data.containerDocuments.length],
    ["Container Sales", data.containerSales.length],
    ["Purchase Orders", data.purchaseOrders.length],
    ["PO Line Items", data.poLineItems.length],
    ["POS Shifts", data.posShifts.length],
    ["Sales Items", data.salesItems.length],
    ["Waste Dispatches", data.wasteDispatches.length],
    ["Waste Dispatch Items", data.wasteDispatchItems.length],
    ["Spreadsheets", data.spreadsheets.length],
    ["Import Logs", data.importLogs.length],
    ["Audit Log", data.auditLog.length],
    ["— ENRICHED VIEWS —", 0],
    ["Voucher Lines Detail", data.voucherLinesDetail.length],
    ["PO Detail (flat)", data.poDetail.length],
    ["Stock Transfer Detail", data.stockTransferDetail.length],
    ["Supplier Balances", data.supplierBalances.length],
    ["Supplier Txn Detail", data.supplierTxnDetail.length],
    ["Customer Balances Detail", data.customerBalancesDetail.length],
    ["Customer Order Detail", data.customerOrderDetail.length],
    ["Credit-Debit Note Detail", data.creditNoteDetail.length],
    ["Salary Advances Detail", data.salaryAdvancesDetail.length],
    ["Employee Txn Detail", data.employeeTxnDetail.length],
    ["Location Stock Detail", data.locationStockDetail.length],
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

export async function buildCompanyWorkbook(data: CompanyExportData): Promise<Buffer> {
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

  // ── Enriched Detail Views ─────────────────────────────────────────────────
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

  const buf = await wb.xlsx.writeBuffer();
  return buf as Buffer;
}
