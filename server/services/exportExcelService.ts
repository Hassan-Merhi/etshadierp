import ExcelJS from "exceljs";
import type { CompanyExportData } from "./exportDataService";

const HDR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const HDR_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const ALT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4FA" } };
const NUM_FMT = "#,##0.00";
const MAX_ROWS = 60000;

function addSheet(wb: ExcelJS.Workbook, name: string, rows: any[], columns: { header: string; key: string; width?: number; numFmt?: string }[]) {
  if (!rows || rows.length === 0) {
    const ws = wb.addWorksheet(name.substring(0, 31));
    ws.addRow(columns.map(c => c.header));
    styleHeaderRow(ws, columns);
    return;
  }

  const chunks = chunkArray(rows, MAX_ROWS);
  chunks.forEach((chunk, idx) => {
    const sheetName = chunks.length > 1
      ? `${name.substring(0, 28)} ${idx + 1}`
      : name.substring(0, 31);
    const ws = wb.addWorksheet(sheetName);
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }));
    styleHeaderRow(ws, columns);
    chunk.forEach((row, ri) => {
      const r = ws.addRow(columns.map(c => {
        const val = row[c.key];
        if (val === null || val === undefined) return "";
        if (val instanceof Date) return val.toISOString().substring(0, 19).replace("T", " ");
        return val;
      }));
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

function styleHeaderRow(ws: ExcelJS.Worksheet, columns: { header: string; key: string; width?: number }[]) {
  const hdr = ws.getRow(1);
  hdr.eachCell(cell => {
    cell.fill = HDR_FILL;
    cell.font = HDR_FONT;
    cell.border = { bottom: { style: "thin", color: { argb: "FF3B82F6" } } };
    cell.alignment = { vertical: "middle" };
  });
  hdr.height = 20;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function addSummarySheet(wb: ExcelJS.Workbook, data: CompanyExportData) {
  const ws = wb.addWorksheet("SUMMARY");
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 50;

  const addKV = (label: string, value: any) => {
    const r = ws.addRow([label, String(value ?? "")]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10 };
  };

  const title = ws.addRow([`Full Data Export — ${data.company?.name || ""}`]);
  title.font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  ws.addRow(["Generated at", new Date().toISOString()]);
  ws.addRow([]);

  const headerRow = ws.addRow(["Data Category", "Record Count"]);
  headerRow.eachCell(cell => { cell.fill = HDR_FILL; cell.font = HDR_FONT; });
  headerRow.height = 18;

  const counts: [string, number][] = [
    ["Company Info", 1],
    ["Company Settings", data.companySettings.length],
    ["Locations", data.locations.length],
    // Finance
    ["Ledger Accounts", data.ledgerAccounts.length],
    ["Bank Accounts", data.bankAccounts.length],
    ["Fixed Assets", data.fixedAssets.length],
    ["Exchange Rates", data.exchangeRates.length],
    ["Fiscal Period Closures", data.fiscalPeriodClosures.length],
    ["Reference Sequences", data.referenceSequences.length],
    ["Agent Accounts", data.agentAccounts.length],
    // Vouchers
    ["Vouchers", data.vouchers.length],
    ["Voucher Entries", data.voucherEntries.length],
    // Suppliers
    ["Suppliers", data.suppliers.length],
    ["Supplier Transactions", data.supplierTransactions.length],
    ["Supplier Proformas", data.supplierProformas.length],
    ["Supplier Proforma Lines", data.supplierProformaLines.length],
    ["Supplier Containers", data.supplierContainers.length],
    ["Supplier Container Items", data.supplierContainerLoadedItems.length],
    // Customers
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
    // Employees
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
    // Factory Workers
    ["Factory Workers", data.factoryWorkers.length],
    ["Factory Worker Categories", data.factoryWorkerCategories.length],
    ["Factory Worker Documents", data.factoryWorkerDocuments.length],
    ["Factory Worker Advances", data.factoryWorkerAdvances.length],
    ["Factory Advance Repayments", data.factoryAdvanceRepayments.length],
    ["Factory Payrolls", data.factoryPayrolls.length],
    ["Factory Attendance", data.factoryAttendance.length],
    ["Worker Bonuses", data.workerBonuses.length],
    // Factory Operations
    ["Factory Settings", data.factorySettings.length],
    ["Factory Categories", data.factoryCategories.length],
    ["Factory Daybook", data.factoryDaybook.length],
    ["Daybook Entry Edits", data.factoryDaybookEdits.length],
    ["Factory KPI Snapshots", data.factoryDailyKpiSnapshots.length],
    ["Factory Daily Usages", data.factoryDailyUsages.length],
    ["Factory Alerts", data.factoryAlerts.length],
    ["Factory Duty Audit Log", data.factoryDutyAuditLog.length],
    // Factory Raw / Production
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
    // Factory Bales
    ["Factory Bale Products", data.factoryBaleProducts.length],
    ["Factory Bales", data.factoryBales.length],
    ["Factory Bale Sequences", data.factoryBaleSequences.length],
    ["Factory Bale Cost Snapshots", data.factoryBaleCostSnapshots.length],
    ["Factory Bale Waste Dispatches", data.factoryBaleWasteDispatches.length],
    ["Factory Waste Entries", data.factoryWasteEntries.length],
    // Factory Containers
    ["Factory Containers", data.factoryContainers.length],
    ["Factory Container Commissions", data.factoryContainerCommissions.length],
    ["Factory Container Other Charges", data.factoryContainerOtherCharges.length],
    ["Factory Container P&L Snapshots", data.factoryContainerProfitSnapshots.length],
    ["Offload Additional Charges", data.factoryOffloadAdditionalCharges.length],
    // Factory Suppliers
    ["Factory Suppliers", data.factorySuppliers.length],
    ["Factory Supplier Payments", data.factorySupplierPayments.length],
    ["Factory Supplier FX Transfers", data.factorySupplierFxTransfers.length],
    ["Factory Supplier Scores", data.factorySupplierScoreSnapshots.length],
    // Factory FX & POS
    ["Factory FX Rates", data.factoryFxRates.length],
    ["Factory FX Allocations", data.factoryFxAllocations.length],
    ["Factory POS Sales", data.factoryPosSales.length],
    ["Factory POS Sale Items", data.factoryPosSaleItems.length],
    // Bales (Sorting)
    ["Bales (Sorting)", data.bales.length],
    ["Bale Products", data.baleProducts.length],
    ["Bale Product Categories", data.baleProductCategories.length],
    ["Bale Sequences", data.baleSequences.length],
    ["Bale Label Prints", data.baleLabelPrints.length],
    ["Bale Transfers", data.baleTransfers.length],
    ["Bale Transfer Items", data.baleTransferItems.length],
    ["Bale Recode Sessions", data.baleRecodeSessions.length],
    ["Bale Recode Items", data.baleRecodeItems.length],
    // Stock
    ["Stock Groups", data.stockGroups.length],
    ["Stock Items", data.stockItems.length],
    ["Stock Item Aliases", data.stockItemCodeAliases.length],
    ["Stock Item Location Prices", data.stockItemLocationPrices.length],
    ["Inventory (by location)", data.inventory.length],
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
    // Containers
    ["Containers", data.containers.length],
    ["Container Charges", data.containerCharges.length],
    ["Container Offloads", data.containerOffloads.length],
    ["Offload Items", data.containerOffloadItems.length],
    ["Container Freight", data.containerFreight.length],
    ["Container Freight Payments", data.containerFreightPayments.length],
    ["Container Documents", data.containerDocuments.length],
    ["Container Sales", data.containerSales.length],
    // Purchase Orders
    ["Purchase Orders", data.purchaseOrders.length],
    ["PO Line Items", data.poLineItems.length],
    // POS
    ["POS Shifts", data.posShifts.length],
    ["Sales Items", data.salesItems.length],
    // Waste
    ["Waste Dispatches", data.wasteDispatches.length],
    ["Waste Dispatch Items", data.wasteDispatchItems.length],
    // Misc
    ["Spreadsheets", data.spreadsheets.length],
    ["Import Logs", data.importLogs.length],
    // Audit
    ["Audit Log", data.auditLog.length],
  ];

  counts.forEach(([label, count], i) => {
    const r = ws.addRow([label, count]);
    r.getCell(2).numFmt = "#,##0";
    if (i % 2 === 1) r.eachCell(c => { c.fill = ALT_FILL; });
  });
}

export async function buildCompanyWorkbook(data: CompanyExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP System";
  wb.created = new Date();

  addSummarySheet(wb, data);

  addSheet(wb, "Locations", data.locations, [
    { header: "ID", key: "id", width: 8 },
    { header: "Code", key: "code", width: 15 },
    { header: "Name", key: "name", width: 30 },
    { header: "City", key: "city", width: 20 },
    { header: "State", key: "state", width: 20 },
    { header: "Country", key: "country", width: 20 },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Ledger Accounts", data.ledgerAccounts, [
    { header: "ID", key: "id", width: 8 },
    { header: "Code", key: "code", width: 15 },
    { header: "Name", key: "name", width: 35 },
    { header: "Account Type", key: "account_type", width: 18 },
    { header: "Sub Type", key: "sub_type", width: 18 },
    { header: "Parent ID", key: "parent_id", width: 12 },
    { header: "Opening Balance", key: "opening_balance", width: 18, numFmt: NUM_FMT },
    { header: "Opening Side", key: "opening_balance_side", width: 15 },
    { header: "Active", key: "active", width: 10 },
    { header: "Hidden", key: "is_hidden", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Bank Accounts", data.bankAccounts, [
    { header: "ID", key: "id", width: 8 },
    { header: "Account Name", key: "account_name", width: 30 },
    { header: "Bank Name", key: "bank_name", width: 25 },
    { header: "Account Number", key: "account_number", width: 22 },
    { header: "Branch", key: "branch", width: 20 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Ledger Account ID", key: "ledger_account_id", width: 18 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Fixed Assets", data.fixedAssets, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 35 },
    { header: "Asset Code", key: "asset_code", width: 18 },
    { header: "Purchase Date", key: "purchase_date", width: 16 },
    { header: "Purchase Value", key: "purchase_value", width: 18, numFmt: NUM_FMT },
    { header: "Depreciation Rate %", key: "depreciation_rate", width: 20, numFmt: NUM_FMT },
    { header: "Ledger Account ID", key: "ledger_account_id", width: 18 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Vouchers", data.vouchers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Voucher Number", key: "voucher_number", width: 20 },
    { header: "Type", key: "voucher_type", width: 18 },
    { header: "Date", key: "voucher_date", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Exchange Rate", key: "exchange_rate", width: 16, numFmt: "#,##0.000000" },
    { header: "Narration", key: "narration", width: 40 },
    { header: "Reference", key: "reference", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Voucher Entries", data.voucherEntries, [
    { header: "ID", key: "id", width: 10 },
    { header: "Voucher ID", key: "voucher_id", width: 12 },
    { header: "Ledger Account ID", key: "ledger_account_id", width: 18 },
    { header: "Type (Dr/Cr)", key: "type", width: 14 },
    { header: "Debit Amount", key: "debit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Credit Amount", key: "credit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "FX Rate", key: "fx_rate", width: 14, numFmt: "#,##0.000000" },
    { header: "Narration", key: "narration", width: 40 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Bank Account ID", key: "bank_account_id", width: 18 },
    { header: "Fixed Asset ID", key: "fixed_asset_id", width: 16 },
  ]);

  addSheet(wb, "Suppliers", data.suppliers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Code", key: "code", width: 15 },
    { header: "Legal Name", key: "legal_name", width: 35 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Address", key: "address", width: 40 },
    { header: "Tax ID", key: "tax_id", width: 18 },
    { header: "Payment Terms", key: "payment_terms", width: 18 },
    { header: "Opening Balance", key: "opening_balance", width: 18, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Supplier Transactions", data.supplierTransactions, [
    { header: "Entry ID", key: "id", width: 10 },
    { header: "Voucher ID", key: "voucher_id", width: 12 },
    { header: "Voucher Number", key: "voucher_number", width: 20 },
    { header: "Voucher Type", key: "voucher_type", width: 18 },
    { header: "Date", key: "voucher_date", width: 14 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Type (Dr/Cr)", key: "type", width: 14 },
    { header: "Debit", key: "debit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Credit", key: "credit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Narration", key: "narration", width: 40 },
    { header: "Voucher Narration", key: "voucher_narration", width: 40 },
  ]);

  addSheet(wb, "Customers", data.customers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Code", key: "code", width: 15 },
    { header: "Name", key: "name", width: 35 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Address", key: "address", width: 40 },
    { header: "Credit Limit", key: "credit_limit", width: 18, numFmt: NUM_FMT },
    { header: "Opening Balance", key: "opening_balance", width: 18, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Customer Transactions", data.customerTransactions, [
    { header: "Entry ID", key: "id", width: 10 },
    { header: "Voucher ID", key: "voucher_id", width: 12 },
    { header: "Voucher Number", key: "voucher_number", width: 20 },
    { header: "Voucher Type", key: "voucher_type", width: 18 },
    { header: "Date", key: "voucher_date", width: 14 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Type (Dr/Cr)", key: "type", width: 14 },
    { header: "Debit", key: "debit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Credit", key: "credit_amount", width: 18, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Narration", key: "narration", width: 40 },
    { header: "Voucher Narration", key: "voucher_narration", width: 40 },
  ]);

  addSheet(wb, "Employees", data.employees, [
    { header: "ID", key: "id", width: 10 },
    { header: "Code", key: "code", width: 15 },
    { header: "First Name", key: "first_name", width: 20 },
    { header: "Last Name", key: "last_name", width: 20 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Join Date", key: "join_date", width: 14 },
    { header: "Employee Type", key: "employee_type", width: 18 },
    { header: "Monthly Salary", key: "monthly_salary", width: 18, numFmt: NUM_FMT },
    { header: "Current Balance", key: "current_balance", width: 18, numFmt: NUM_FMT },
    { header: "Total Deposits", key: "total_deposits", width: 18, numFmt: NUM_FMT },
    { header: "Total Withdrawals", key: "total_withdrawals", width: 20, numFmt: NUM_FMT },
    { header: "Sales Bonus %", key: "sales_bonus_pct", width: 15, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
  ]);

  addSheet(wb, "Employee Payrolls", data.employeePayrolls, [
    { header: "ID", key: "id", width: 10 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Payroll Run ID", key: "payroll_run_id", width: 16 },
    { header: "Basic Salary", key: "basic_salary", width: 18, numFmt: NUM_FMT },
    { header: "Allowances", key: "allowances", width: 18, numFmt: NUM_FMT },
    { header: "Deductions", key: "deductions", width: 18, numFmt: NUM_FMT },
    { header: "Net Salary", key: "net_salary", width: 18, numFmt: NUM_FMT },
    { header: "Pay Date", key: "pay_date", width: 14 },
    { header: "Status", key: "status", width: 14 },
  ]);

  addSheet(wb, "Salary Advances", data.employeeAdvances, [
    { header: "ID", key: "id", width: 10 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Amount", key: "amount", width: 18, numFmt: NUM_FMT },
    { header: "Advance Date", key: "advance_date", width: 16 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Workers", data.factoryWorkers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Position", key: "position", width: 20 },
    { header: "Department", key: "department", width: 20 },
    { header: "Phone 1", key: "phone1", width: 18 },
    { header: "Phone 2", key: "phone2", width: 18 },
    { header: "Nationality", key: "nationality", width: 18 },
    { header: "Passport No.", key: "passport_number", width: 20 },
    { header: "Visa Number", key: "visa_number", width: 20 },
    { header: "Visa Expiry", key: "visa_expiry", width: 14 },
    { header: "Work Permit", key: "work_permit_number", width: 20 },
    { header: "Permit Expiry", key: "work_permit_expiry", width: 16 },
    { header: "Salary Type", key: "salary_type", width: 16 },
    { header: "Base Salary", key: "base_salary", width: 18, numFmt: NUM_FMT },
    { header: "Transport Allowance", key: "transport_allowance", width: 20, numFmt: NUM_FMT },
    { header: "Per Bale Rate", key: "per_bale_rate", width: 18, numFmt: NUM_FMT },
    { header: "Per KG Rate", key: "per_kg_rate", width: 16, numFmt: NUM_FMT },
    { header: "Overtime Rate", key: "overtime_rate", width: 16, numFmt: NUM_FMT },
    { header: "Pay Frequency", key: "pay_frequency", width: 16 },
    { header: "Payment Method", key: "payment_method", width: 18 },
    { header: "Bank Name", key: "bank_name", width: 20 },
    { header: "Bank Account", key: "bank_account_number", width: 22 },
    { header: "Date Joined", key: "date_joined", width: 14 },
    { header: "Contract Start", key: "contract_start_date", width: 16 },
    { header: "Contract End", key: "contract_end_date", width: 16 },
    { header: "Active", key: "active", width: 10 },
    { header: "Notes", key: "notes", width: 40 },
  ]);

  addSheet(wb, "Factory Payrolls", data.factoryPayrolls, [
    { header: "ID", key: "id", width: 10 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Period Start", key: "period_start", width: 16 },
    { header: "Period End", key: "period_end", width: 14 },
    { header: "Base Salary", key: "base_salary", width: 18, numFmt: NUM_FMT },
    { header: "Transport", key: "transport", width: 16, numFmt: NUM_FMT },
    { header: "Bonuses", key: "bonuses", width: 16, numFmt: NUM_FMT },
    { header: "Deductions", key: "deductions", width: 16, numFmt: NUM_FMT },
    { header: "Advances", key: "advances", width: 16, numFmt: NUM_FMT },
    { header: "Net Salary", key: "net_salary", width: 18, numFmt: NUM_FMT },
    { header: "Present Days", key: "present_days", width: 14 },
    { header: "Working Days", key: "working_days", width: 16 },
    { header: "Bales Count", key: "bales_count", width: 14 },
    { header: "KGs Processed", key: "kgs_processed", width: 16, numFmt: NUM_FMT },
    { header: "Status", key: "status", width: 14 },
    { header: "Payment Date", key: "payment_date", width: 16 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Attendance", data.factoryAttendance, [
    { header: "ID", key: "id", width: 10 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Date", key: "attendance_date", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Check In", key: "check_in", width: 20 },
    { header: "Check Out", key: "check_out", width: 20 },
    { header: "Overtime Hours", key: "overtime_hours", width: 16, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 30 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Daybook", data.factoryDaybook, [
    { header: "ID", key: "id", width: 10 },
    { header: "Entry Date", key: "entry_date", width: 14 },
    { header: "Type", key: "entry_type", width: 18 },
    { header: "Amount", key: "amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Description", key: "description", width: 40 },
    { header: "Reference", key: "reference", width: 20 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Stock Groups", data.stockGroups, [
    { header: "ID", key: "id", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Stock Items", data.stockItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Code", key: "code", width: 15 },
    { header: "Name", key: "name", width: 35 },
    { header: "Group ID", key: "stock_group_id", width: 14 },
    { header: "UOM", key: "uom", width: 12 },
    { header: "Opening Qty", key: "opening_qty", width: 16, numFmt: "#,##0.000" },
    { header: "Opening Rate", key: "opening_rate", width: 16, numFmt: NUM_FMT },
    { header: "Opening Value", key: "opening_value", width: 16, numFmt: NUM_FMT },
    { header: "Selling Price", key: "selling_price", width: 16, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
  ]);

  addSheet(wb, "Inventory by Location", data.inventory, [
    { header: "ID", key: "id", width: 10 },
    { header: "Item Code", key: "item_code", width: 15 },
    { header: "Item Name", key: "item_name", width: 35 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Location Name", key: "location_name", width: 25 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Quantity", key: "quantity", width: 16, numFmt: "#,##0.000" },
    { header: "Average Cost", key: "average_cost", width: 16, numFmt: NUM_FMT },
    { header: "Total Value", key: "total_value", width: 16, numFmt: NUM_FMT },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Stock Transfers", data.stockTransfers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Transfer Number", key: "transfer_number", width: 20 },
    { header: "Transfer Date", key: "transfer_date", width: 16 },
    { header: "From Location", key: "from_location_name", width: 25 },
    { header: "To Location", key: "to_location_name", width: 25 },
    { header: "From Location ID", key: "from_location_id", width: 18 },
    { header: "To Location ID", key: "to_location_id", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Transfer Items", data.stockTransferItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Transfer Voucher ID", key: "transfer_voucher_id", width: 20 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Batch No.", key: "batch_no", width: 16 },
    { header: "Expiry Date", key: "expiry_date", width: 14 },
  ]);

  addSheet(wb, "Transfer Revisions", data.stockTransferRevisions, [
    { header: "ID", key: "id", width: 10 },
    { header: "Transfer ID", key: "transfer_id", width: 14 },
    { header: "Revision Number", key: "revision_number", width: 18 },
    { header: "Note", key: "note", width: 40 },
    { header: "Optional", key: "optional", width: 12 },
    { header: "Revision Date", key: "revision_date", width: 22 },
  ]);

  addSheet(wb, "Revision Items", data.stockTransferRevisionItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Revision ID", key: "revision_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Item Name", key: "stock_item_name", width: 30 },
    { header: "Source Location ID", key: "source_location_id", width: 20 },
    { header: "Source Location", key: "source_location_name", width: 25 },
    { header: "Original Qty", key: "original_quantity", width: 16, numFmt: "#,##0.000" },
    { header: "Delta", key: "delta", width: 14, numFmt: "#,##0.000" },
    { header: "New Qty", key: "new_quantity", width: 14, numFmt: "#,##0.000" },
  ]);

  addSheet(wb, "Stock Adjustments", data.stockAdjustments, [
    { header: "ID", key: "id", width: 10 },
    { header: "Voucher Number", key: "voucher_number", width: 20 },
    { header: "Adjustment Date", key: "adjustment_date", width: 18 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Type", key: "adjustment_type", width: 20 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Adjustment Items", data.stockAdjustmentItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Adjustment Voucher ID", key: "adjustment_voucher_id", width: 22 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Reason", key: "reason", width: 30 },
  ]);

  addSheet(wb, "Purchase Orders", data.purchaseOrders, [
    { header: "ID", key: "id", width: 10 },
    { header: "PO Number", key: "po_number", width: 18 },
    { header: "PO Date", key: "po_date", width: 14 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Items Total", key: "items_total", width: 16, numFmt: NUM_FMT },
    { header: "Freight", key: "freight", width: 14, numFmt: NUM_FMT },
    { header: "Duty", key: "duty", width: 14, numFmt: NUM_FMT },
    { header: "Grand Total", key: "grand_total", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 30 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "PO Line Items", data.poLineItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "PO ID", key: "po_id", width: 10 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "UOM", key: "uom", width: 12 },
  ]);

  addSheet(wb, "Containers", data.containers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Container Number", key: "container_number", width: 22 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Import Date", key: "import_date", width: 14 },
    { header: "ETA", key: "eta", width: 14 },
    { header: "Offload Date", key: "offload_date", width: 16 },
    { header: "Items Total", key: "items_total", width: 16, numFmt: NUM_FMT },
    { header: "Charges Total", key: "charges_total", width: 16, numFmt: NUM_FMT },
    { header: "Grand Total", key: "grand_total", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Transport Fee", key: "transport_fee", width: 16, numFmt: NUM_FMT },
    { header: "Duty Fee", key: "duty_fee", width: 14, numFmt: NUM_FMT },
    { header: "Number Plate", key: "number_plate", width: 16 },
    { header: "Transporter", key: "transporter", width: 20 },
    { header: "Doc Received", key: "doc_received", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Container Charges", data.containerCharges, [
    { header: "ID", key: "id", width: 10 },
    { header: "Container ID", key: "container_id", width: 16 },
    { header: "Charge Type", key: "charge_type", width: 20 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Description", key: "description", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Container Offloads", data.containerOffloads, [
    { header: "ID", key: "id", width: 10 },
    { header: "Container ID", key: "container_id", width: 16 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Offloaded At", key: "offloaded_at", width: 22 },
    { header: "Notes", key: "notes", width: 30 },
  ]);

  addSheet(wb, "Offload Items", data.containerOffloadItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Offload ID", key: "offload_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Batch No.", key: "batch_no", width: 16 },
  ]);

  addSheet(wb, "Bales (Sorting)", data.bales, [
    { header: "ID", key: "id", width: 10 },
    { header: "Barcode", key: "barcode", width: 20 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Category", key: "category", width: 16 },
    { header: "Grade", key: "grade", width: 14 },
    { header: "Origin", key: "origin", width: 14 },
    { header: "Weight (KG)", key: "weight", width: 14, numFmt: "#,##0.000" },
    { header: "Date Pressed", key: "date_pressed", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Sell Price", key: "sell_price", width: 16, numFmt: NUM_FMT },
    { header: "Cost Per KG", key: "cost_per_kg", width: 16, numFmt: NUM_FMT },
  ]);

  addSheet(wb, "Factory Bale Products", data.factoryBaleProducts, [
    { header: "ID", key: "id", width: 10 },
    { header: "Name", key: "name", width: 30 },
    { header: "Article Code", key: "article_code", width: 18 },
    { header: "Weight Per Bale (KG)", key: "weight_per_bale_kg", width: 22, numFmt: "#,##0.000" },
    { header: "Production Price", key: "production_price", width: 20, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Bales", data.factoryBales, [
    { header: "ID", key: "id", width: 10 },
    { header: "Reference Number", key: "reference_number", width: 22 },
    { header: "Bale Code", key: "bale_code", width: 18 },
    { header: "Product ID", key: "product_id", width: 14 },
    { header: "Batch ID", key: "batch_id", width: 14 },
    { header: "Weight (KG)", key: "weight_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Cost Per KG", key: "cost_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Total Cost", key: "total_cost", width: 16, numFmt: NUM_FMT },
    { header: "Pressed Date", key: "pressed_date", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Containers", data.factoryContainers, [
    { header: "ID", key: "id", width: 10 },
    { header: "Container Number", key: "container_number", width: 22 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Import Date", key: "import_date", width: 16 },
    { header: "Items Total", key: "items_total", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "FX Rate (Import)", key: "fx_rate_to_usd_import", width: 20, numFmt: "#,##0.000000" },
    { header: "FX Rate (Offload)", key: "fx_rate_to_usd_offload", width: 20, numFmt: "#,##0.000000" },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Exchange Rates", data.exchangeRates, [
    { header: "ID", key: "id", width: 10 },
    { header: "From Currency", key: "from_currency", width: 16 },
    { header: "To Currency", key: "to_currency", width: 14 },
    { header: "Rate", key: "rate", width: 20, numFmt: "#,##0.000000" },
    { header: "Effective Date", key: "effective_date", width: 16 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "POS Shifts", data.posShifts, [
    { header: "ID", key: "id", width: 10 },
    { header: "User ID", key: "user_id", width: 14 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Opened At", key: "opened_at", width: 22 },
    { header: "Closed At", key: "closed_at", width: 22 },
    { header: "Opening Cash", key: "opening_cash", width: 18, numFmt: NUM_FMT },
    { header: "Closing Cash", key: "closing_cash", width: 18, numFmt: NUM_FMT },
    { header: "Expected Cash", key: "expected_cash", width: 18, numFmt: NUM_FMT },
    { header: "Variance", key: "variance", width: 14, numFmt: NUM_FMT },
    { header: "Status", key: "status", width: 14 },
  ]);

  addSheet(wb, "Sales Items", data.salesItems, [
    { header: "ID", key: "id", width: 10 },
    { header: "Voucher ID", key: "voucher_id", width: 14 },
    { header: "Voucher Number", key: "voucher_number", width: 20 },
    { header: "Date", key: "voucher_date", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Discount %", key: "discount_pct", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Cost", key: "cost", width: 14, numFmt: NUM_FMT },
    { header: "Profit", key: "profit", width: 14, numFmt: NUM_FMT },
  ]);

  addSheet(wb, "Audit Log", data.auditLog, [
    { header: "ID", key: "id", width: 10 },
    { header: "User ID", key: "user_id", width: 14 },
    { header: "Action", key: "action", width: 14 },
    { header: "Table", key: "table_name", width: 22 },
    { header: "Record ID", key: "record_id", width: 14 },
    { header: "Changes", key: "changes", width: 60 },
    { header: "IP Address", key: "ip_address", width: 18 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Company Settings ──────────────────────────────────────────────────────
  addSheet(wb, "Company Settings", data.companySettings, [
    { header: "ID", key: "id", width: 8 },
    { header: "Company ID", key: "company_id", width: 14 },
    { header: "Logo URL", key: "logo_url", width: 40 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Date Format", key: "date_format", width: 16 },
    { header: "Language", key: "language", width: 14 },
    { header: "Tax Rate %", key: "tax_rate", width: 14, numFmt: NUM_FMT },
    { header: "Financial Year Start", key: "financial_year_start", width: 22 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Finance ───────────────────────────────────────────────────────────────
  addSheet(wb, "Fiscal Period Closures", data.fiscalPeriodClosures, [
    { header: "ID", key: "id", width: 8 },
    { header: "Period Start", key: "period_start", width: 16 },
    { header: "Period End", key: "period_end", width: 14 },
    { header: "Closed At", key: "closed_at", width: 22 },
    { header: "Closed By", key: "closed_by_user_id", width: 18 },
    { header: "Notes", key: "notes", width: 40 },
  ]);

  addSheet(wb, "Reference Sequences", data.referenceSequences, [
    { header: "ID", key: "id", width: 8 },
    { header: "Document Type", key: "document_type", width: 22 },
    { header: "Prefix", key: "prefix", width: 14 },
    { header: "Last Number", key: "last_number", width: 14 },
    { header: "Padding", key: "padding", width: 12 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Agent Accounts", data.agentAccounts, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Commission %", key: "commission_pct", width: 16, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Supplier Extended ─────────────────────────────────────────────────────
  addSheet(wb, "Supplier Proformas", data.supplierProformas, [
    { header: "ID", key: "id", width: 8 },
    { header: "Proforma Number", key: "proforma_number", width: 20 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Date", key: "proforma_date", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Supplier Proforma Lines", data.supplierProformaLines, [
    { header: "ID", key: "id", width: 8 },
    { header: "Proforma ID", key: "proforma_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "UOM", key: "uom", width: 12 },
  ]);

  addSheet(wb, "Supplier Containers", data.supplierContainers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Container Number", key: "container_number", width: 22 },
    { header: "Status", key: "status", width: 14 },
    { header: "Shipment Date", key: "shipment_date", width: 16 },
    { header: "Arrival Date", key: "arrival_date", width: 16 },
    { header: "Total KG", key: "total_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Supplier Container Items", data.supplierContainerLoadedItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "UOM", key: "uom", width: 12 },
  ]);

  // ── Customer Extended ─────────────────────────────────────────────────────
  addSheet(wb, "Customer Balances", data.customerBalances, [
    { header: "ID", key: "id", width: 8 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Opening Balance", key: "opening_balance", width: 18, numFmt: NUM_FMT },
    { header: "Current Balance", key: "current_balance", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Customer Orders", data.customerOrders, [
    { header: "ID", key: "id", width: 8 },
    { header: "Order Number", key: "order_number", width: 20 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Order Date", key: "order_date", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Customer Order Lines", data.customerOrderLines, [
    { header: "ID", key: "id", width: 8 },
    { header: "Order ID", key: "order_id", width: 12 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "UOM", key: "uom", width: 12 },
  ]);

  addSheet(wb, "Customer Order Bales", data.customerOrderBales, [
    { header: "ID", key: "id", width: 8 },
    { header: "Order ID", key: "order_id", width: 12 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Bale Code", key: "bale_code", width: 18 },
    { header: "Weight KG", key: "weight_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
  ]);

  addSheet(wb, "Customer Order Charges", data.customerOrderCharges, [
    { header: "ID", key: "id", width: 8 },
    { header: "Order ID", key: "order_id", width: 12 },
    { header: "Charge Type", key: "charge_type", width: 20 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Description", key: "description", width: 35 },
  ]);

  addSheet(wb, "Customer Proformas", data.customerProformas, [
    { header: "ID", key: "id", width: 8 },
    { header: "Proforma Number", key: "proforma_number", width: 20 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Date", key: "proforma_date", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Customer Proforma Lines", data.customerProformaLines, [
    { header: "ID", key: "id", width: 8 },
    { header: "Proforma ID", key: "proforma_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "UOM", key: "uom", width: 12 },
  ]);

  addSheet(wb, "Credit Note Items", data.creditNoteItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Voucher ID", key: "voucher_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Rate", key: "rate", width: 14, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
  ]);

  // ── Employee Extended ─────────────────────────────────────────────────────
  addSheet(wb, "Payroll Runs", data.employeePayrolls, [
    { header: "ID", key: "id", width: 8 },
    { header: "Pay Date", key: "pay_date", width: 14 },
    { header: "Period Start", key: "period_start", width: 16 },
    { header: "Period End", key: "period_end", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Total Net", key: "total_net", width: 18, numFmt: NUM_FMT },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Payroll Run Items", data.employeePayrollItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Payroll Run ID", key: "payroll_run_id", width: 16 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Basic Salary", key: "basic_salary", width: 18, numFmt: NUM_FMT },
    { header: "Allowances", key: "allowances", width: 16, numFmt: NUM_FMT },
    { header: "Deductions", key: "deductions", width: 16, numFmt: NUM_FMT },
    { header: "Net Salary", key: "net_salary", width: 18, numFmt: NUM_FMT },
  ]);

  addSheet(wb, "Employee Advances", data.employeeAdvances, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Date", key: "advance_date", width: 14 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Salary Advances", data.salaryAdvances, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Advance Date", key: "advance_date", width: 16 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Salary Advance Deductions", data.salaryAdvanceDeductions, [
    { header: "ID", key: "id", width: 8 },
    { header: "Advance ID", key: "advance_id", width: 14 },
    { header: "Amount Deducted", key: "amount_deducted", width: 18, numFmt: NUM_FMT },
    { header: "Deduction Date", key: "deduction_date", width: 16 },
    { header: "Payroll Run ID", key: "payroll_run_id", width: 16 },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Employee Advance Repayments", data.employeeAdvanceRepayments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Date", key: "repayment_date", width: 16 },
    { header: "Notes", key: "notes", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Employee Attendance", data.employeeAttendance, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Date", key: "attendance_date", width: 14 },
    { header: "Status", key: "status", width: 14 },
    { header: "Check In", key: "check_in", width: 20 },
    { header: "Check Out", key: "check_out", width: 20 },
    { header: "Notes", key: "notes", width: 30 },
  ]);

  addSheet(wb, "Employee Bonuses", data.employeeBonuses, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Bonus Date", key: "bonus_date", width: 14 },
    { header: "Type", key: "bonus_type", width: 18 },
    { header: "Notes", key: "notes", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Employee Groups", data.employeeGroups, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Description", key: "description", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Employee Group Members", data.employeeGroupMembers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Group ID", key: "group_id", width: 12 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Employee Bale Rates", data.employeeBaleRates, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Bale Product ID", key: "bale_product_id", width: 18 },
    { header: "Rate Per Bale", key: "rate_per_bale", width: 16, numFmt: NUM_FMT },
    { header: "Effective From", key: "effective_from", width: 16 },
    { header: "Active", key: "active", width: 10 },
  ]);

  addSheet(wb, "Employee Bale Pct Rates", data.employeeBalePercentRates, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Percentage %", key: "percentage", width: 16, numFmt: NUM_FMT },
    { header: "Effective From", key: "effective_from", width: 16 },
    { header: "Active", key: "active", width: 10 },
  ]);

  addSheet(wb, "Worker Documents", data.workerDocs, [
    { header: "ID", key: "id", width: 8 },
    { header: "Employee ID", key: "employee_id", width: 14 },
    { header: "Document Type", key: "document_type", width: 22 },
    { header: "Document Number", key: "document_number", width: 22 },
    { header: "Issued Date", key: "issued_date", width: 14 },
    { header: "Expiry Date", key: "expiry_date", width: 14 },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  // ── Factory Workers Extended ───────────────────────────────────────────────
  addSheet(wb, "Factory Worker Categories", data.factoryWorkerCategories, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Description", key: "description", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Worker Documents", data.factoryWorkerDocuments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Document Type", key: "document_type", width: 22 },
    { header: "Document Number", key: "document_number", width: 22 },
    { header: "Issued Date", key: "issued_date", width: 14 },
    { header: "Expiry Date", key: "expiry_date", width: 14 },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Factory Worker Advances", data.factoryWorkerAdvances, [
    { header: "ID", key: "id", width: 8 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Date", key: "advance_date", width: 14 },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Advance Repayments", data.factoryAdvanceRepayments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Advance ID", key: "advance_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Date", key: "repayment_date", width: 16 },
    { header: "Notes", key: "notes", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Worker Bonuses", data.workerBonuses, [
    { header: "ID", key: "id", width: 8 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Date", key: "bonus_date", width: 14 },
    { header: "Type", key: "bonus_type", width: 18 },
    { header: "Notes", key: "notes", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Factory Operations Extended ───────────────────────────────────────────
  addSheet(wb, "Factory Settings", data.factorySettings, [
    { header: "ID", key: "id", width: 8 },
    { header: "Setting Key", key: "setting_key", width: 30 },
    { header: "Setting Value", key: "setting_value", width: 40 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Factory Categories", data.factoryCategories, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Description", key: "description", width: 40 },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Daybook Entry Edits", data.factoryDaybookEdits, [
    { header: "ID", key: "id", width: 8 },
    { header: "Entry ID", key: "entry_id", width: 12 },
    { header: "Edited At", key: "edited_at", width: 22 },
    { header: "Edited By", key: "edited_by_user_id", width: 18 },
    { header: "Old Amount", key: "old_amount", width: 16, numFmt: NUM_FMT },
    { header: "New Amount", key: "new_amount", width: 16, numFmt: NUM_FMT },
    { header: "Old Description", key: "old_description", width: 40 },
    { header: "New Description", key: "new_description", width: 40 },
    { header: "Reason", key: "reason", width: 35 },
  ]);

  addSheet(wb, "Factory KPI Snapshots", data.factoryDailyKpiSnapshots, [
    { header: "ID", key: "id", width: 8 },
    { header: "Snapshot Date", key: "snapshot_date", width: 16 },
    { header: "Bales Pressed", key: "bales_pressed", width: 14 },
    { header: "KG Processed", key: "kg_processed", width: 16, numFmt: "#,##0.000" },
    { header: "Workers Present", key: "workers_present", width: 18 },
    { header: "Revenue", key: "revenue", width: 16, numFmt: NUM_FMT },
    { header: "Costs", key: "costs", width: 14, numFmt: NUM_FMT },
    { header: "Profit", key: "profit", width: 14, numFmt: NUM_FMT },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Daily Usages", data.factoryDailyUsages, [
    { header: "ID", key: "id", width: 8 },
    { header: "Usage Date", key: "usage_date", width: 14 },
    { header: "Item ID", key: "item_id", width: 12 },
    { header: "Item Name", key: "item_name", width: 30 },
    { header: "Quantity Used", key: "quantity_used", width: 16, numFmt: "#,##0.000" },
    { header: "Unit Cost", key: "unit_cost", width: 14, numFmt: NUM_FMT },
    { header: "Total Cost", key: "total_cost", width: 14, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Factory Alerts", data.factoryAlerts, [
    { header: "ID", key: "id", width: 8 },
    { header: "Alert Type", key: "alert_type", width: 20 },
    { header: "Severity", key: "severity", width: 14 },
    { header: "Message", key: "message", width: 50 },
    { header: "Resolved", key: "resolved", width: 12 },
    { header: "Resolved At", key: "resolved_at", width: 22 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Duty Audit Log", data.factoryDutyAuditLog, [
    { header: "ID", key: "id", width: 8 },
    { header: "Worker ID", key: "worker_id", width: 14 },
    { header: "Action", key: "action", width: 20 },
    { header: "Old Value", key: "old_value", width: 20 },
    { header: "New Value", key: "new_value", width: 20 },
    { header: "Changed By", key: "changed_by_user_id", width: 18 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Factory Raw / Production ───────────────────────────────────────────────
  addSheet(wb, "Factory Raw Stock", data.factoryRawStock, [
    { header: "ID", key: "id", width: 8 },
    { header: "Category", key: "category", width: 20 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Cost Per KG", key: "cost_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Total Value", key: "total_value", width: 16, numFmt: NUM_FMT },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Raw Material Adjustments", data.factoryRawMaterialAdjustments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Adjustment Date", key: "adjustment_date", width: 18 },
    { header: "Category", key: "category", width: 20 },
    { header: "Type", key: "adjustment_type", width: 16 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Reason", key: "reason", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Pressing Batches", data.factoryPressingBatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch Number", key: "batch_number", width: 18 },
    { header: "Press Date", key: "press_date", width: 14 },
    { header: "Total KG Input", key: "total_kg_input", width: 18, numFmt: "#,##0.000" },
    { header: "Total KG Output", key: "total_kg_output", width: 18, numFmt: "#,##0.000" },
    { header: "Bales Produced", key: "bales_produced", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Pressing Batches", data.pressingBatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch Number", key: "batch_number", width: 18 },
    { header: "Press Date", key: "press_date", width: 14 },
    { header: "Input KG", key: "input_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Output KG", key: "output_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Status", key: "status", width: 14 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Mix Batches", data.factoryMixBatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch Number", key: "batch_number", width: 18 },
    { header: "Mix Date", key: "mix_date", width: 14 },
    { header: "Total KG", key: "total_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Mix Batch Sources", data.factoryMixBatchSources, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch ID", key: "batch_id", width: 12 },
    { header: "Source Type", key: "source_type", width: 18 },
    { header: "Source ID", key: "source_id", width: 12 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
  ]);

  addSheet(wb, "Mix Batches", data.mixBatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch Number", key: "batch_number", width: 18 },
    { header: "Mix Date", key: "mix_date", width: 14 },
    { header: "Total KG", key: "total_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Mix Batch Sources", data.mixBatchSources, [
    { header: "ID", key: "id", width: 8 },
    { header: "Batch ID", key: "batch_id", width: 12 },
    { header: "Source Type", key: "source_type", width: 18 },
    { header: "Source ID", key: "source_id", width: 12 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
  ]);

  addSheet(wb, "Production Bales", data.productionBales, [
    { header: "ID", key: "id", width: 8 },
    { header: "Bale Code", key: "bale_code", width: 18 },
    { header: "Product ID", key: "product_id", width: 14 },
    { header: "Batch ID", key: "batch_id", width: 12 },
    { header: "Weight KG", key: "weight_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Status", key: "status", width: 14 },
    { header: "Pressed Date", key: "pressed_date", width: 16 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Production Raw Stock", data.productionRawStock, [
    { header: "ID", key: "id", width: 8 },
    { header: "Category", key: "category", width: 20 },
    { header: "Description", key: "description", width: 35 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Cost Per KG", key: "cost_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  // ── Factory Bales Extended ─────────────────────────────────────────────────
  addSheet(wb, "Factory Bale Sequences", data.factoryBaleSequences, [
    { header: "ID", key: "id", width: 8 },
    { header: "Product ID", key: "product_id", width: 14 },
    { header: "Prefix", key: "prefix", width: 14 },
    { header: "Last Number", key: "last_number", width: 14 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Factory Bale Cost Snapshots", data.factoryBaleCostSnapshots, [
    { header: "ID", key: "id", width: 8 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Snapshot At", key: "snapshot_at", width: 22 },
    { header: "Cost Per KG", key: "cost_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Total Cost", key: "total_cost", width: 16, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Factory Bale Waste Dispatches", data.factoryBaleWasteDispatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Dispatch Date", key: "dispatch_date", width: 16 },
    { header: "Total KG", key: "total_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Destination", key: "destination", width: 30 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Waste Entries", data.factoryWasteEntries, [
    { header: "ID", key: "id", width: 8 },
    { header: "Entry Date", key: "entry_date", width: 14 },
    { header: "Waste Type", key: "waste_type", width: 20 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Disposal Method", key: "disposal_method", width: 22 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Factory Containers Extended ────────────────────────────────────────────
  addSheet(wb, "Factory Container Commissions", data.factoryContainerCommissions, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Agent Name", key: "agent_name", width: 30 },
    { header: "Commission %", key: "commission_pct", width: 16, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Paid", key: "paid", width: 10 },
    { header: "Paid Date", key: "paid_date", width: 14 },
  ]);

  addSheet(wb, "Factory Container Other Charges", data.factoryContainerOtherCharges, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Charge Type", key: "charge_type", width: 22 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Description", key: "description", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Container P&L Snapshots", data.factoryContainerProfitSnapshots, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Snapshot At", key: "snapshot_at", width: 22 },
    { header: "Revenue", key: "revenue", width: 16, numFmt: NUM_FMT },
    { header: "Costs", key: "costs", width: 14, numFmt: NUM_FMT },
    { header: "Gross Profit", key: "gross_profit", width: 16, numFmt: NUM_FMT },
    { header: "Gross Margin %", key: "gross_margin_pct", width: 16, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Offload Additional Charges", data.factoryOffloadAdditionalCharges, [
    { header: "ID", key: "id", width: 8 },
    { header: "Offload ID", key: "offload_id", width: 14 },
    { header: "Charge Type", key: "charge_type", width: 22 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Description", key: "description", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Factory Suppliers ──────────────────────────────────────────────────────
  addSheet(wb, "Factory Suppliers", data.factorySuppliers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Country", key: "country", width: 18 },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Contact", key: "contact_name", width: 25 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Email", key: "email", width: 30 },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory Supplier Payments", data.factorySupplierPayments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Payment Date", key: "payment_date", width: 16 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "FX Rate", key: "fx_rate", width: 14, numFmt: "#,##0.000000" },
    { header: "Payment Method", key: "payment_method", width: 20 },
    { header: "Reference", key: "reference", width: 20 },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Factory Supplier FX Transfers", data.factorySupplierFxTransfers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Transfer Date", key: "transfer_date", width: 16 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "From Currency", key: "from_currency", width: 16 },
    { header: "To Currency", key: "to_currency", width: 14 },
    { header: "FX Rate", key: "fx_rate", width: 14, numFmt: "#,##0.000000" },
    { header: "Converted Amount", key: "converted_amount", width: 20, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  addSheet(wb, "Factory Supplier Scores", data.factorySupplierScoreSnapshots, [
    { header: "ID", key: "id", width: 8 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Snapshot Date", key: "snapshot_date", width: 16 },
    { header: "Quality Score", key: "quality_score", width: 16, numFmt: NUM_FMT },
    { header: "Delivery Score", key: "delivery_score", width: 16, numFmt: NUM_FMT },
    { header: "Overall Score", key: "overall_score", width: 16, numFmt: NUM_FMT },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  // ── Factory FX ─────────────────────────────────────────────────────────────
  addSheet(wb, "Factory FX Rates", data.factoryFxRates, [
    { header: "ID", key: "id", width: 8 },
    { header: "From Currency", key: "from_currency", width: 16 },
    { header: "To Currency", key: "to_currency", width: 14 },
    { header: "Rate", key: "rate", width: 20, numFmt: "#,##0.000000" },
    { header: "Effective Date", key: "effective_date", width: 16 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory FX Allocations", data.factoryFxAllocations, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Supplier ID", key: "supplier_id", width: 14 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "FX Rate", key: "fx_rate", width: 14, numFmt: "#,##0.000000" },
    { header: "Allocated At", key: "allocated_at", width: 22 },
    { header: "Notes", key: "notes", width: 35 },
  ]);

  // ── Factory POS ────────────────────────────────────────────────────────────
  addSheet(wb, "Factory POS Sales", data.factoryPosSales, [
    { header: "ID", key: "id", width: 8 },
    { header: "Sale Date", key: "sale_date", width: 14 },
    { header: "Customer Name", key: "customer_name", width: 30 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Payment Method", key: "payment_method", width: 20 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Factory POS Sale Items", data.factoryPosSaleItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Sale ID", key: "sale_id", width: 12 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Bale Code", key: "bale_code", width: 18 },
    { header: "Weight KG", key: "weight_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Rate Per KG", key: "rate_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Discount %", key: "discount_pct", width: 14, numFmt: NUM_FMT },
  ]);

  // ── Bales (Sorting) Extended ───────────────────────────────────────────────
  addSheet(wb, "Bale Products", data.baleProducts, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Category ID", key: "category_id", width: 14 },
    { header: "Price Per KG", key: "price_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Active", key: "active", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Bale Product Categories", data.baleProductCategories, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 30 },
    { header: "Code", key: "code", width: 15 },
    { header: "Description", key: "description", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Bale Sequences", data.baleSequences, [
    { header: "ID", key: "id", width: 8 },
    { header: "Product ID", key: "product_id", width: 14 },
    { header: "Prefix", key: "prefix", width: 14 },
    { header: "Last Number", key: "last_number", width: 14 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Bale Label Prints", data.baleLabelPrints, [
    { header: "ID", key: "id", width: 8 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Printed At", key: "printed_at", width: 22 },
    { header: "Printed By", key: "printed_by_user_id", width: 18 },
    { header: "Copies", key: "copies", width: 10 },
  ]);

  addSheet(wb, "Bale Transfers", data.baleTransfers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Transfer Date", key: "transfer_date", width: 16 },
    { header: "From Location ID", key: "from_location_id", width: 18 },
    { header: "To Location ID", key: "to_location_id", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Bale Transfer Items", data.baleTransferItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Transfer ID", key: "transfer_id", width: 14 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Bale Code", key: "bale_code", width: 18 },
    { header: "Weight KG", key: "weight_kg", width: 14, numFmt: "#,##0.000" },
  ]);

  addSheet(wb, "Bale Recode Sessions", data.baleRecodeSessions, [
    { header: "ID", key: "id", width: 8 },
    { header: "Session Date", key: "session_date", width: 16 },
    { header: "Created By", key: "created_by_user_id", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Bale Recode Items", data.baleRecodeItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Session ID", key: "session_id", width: 14 },
    { header: "Bale ID", key: "bale_id", width: 12 },
    { header: "Old Code", key: "old_code", width: 18 },
    { header: "New Code", key: "new_code", width: 18 },
    { header: "Old Product ID", key: "old_product_id", width: 16 },
    { header: "New Product ID", key: "new_product_id", width: 16 },
  ]);

  // ── Stock Extended ─────────────────────────────────────────────────────────
  addSheet(wb, "Stock Item Aliases", data.stockItemCodeAliases, [
    { header: "ID", key: "id", width: 8 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Alias Code", key: "alias_code", width: 20 },
    { header: "Description", key: "description", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Stock Item Location Prices", data.stockItemLocationPrices, [
    { header: "ID", key: "id", width: 8 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Selling Price", key: "selling_price", width: 16, numFmt: NUM_FMT },
    { header: "Min Price", key: "min_price", width: 14, numFmt: NUM_FMT },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  addSheet(wb, "Inventory Negative Layers", data.inventoryNegativeLayers, [
    { header: "ID", key: "id", width: 8 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Negative Qty", key: "negative_qty", width: 16, numFmt: "#,##0.000" },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Stock Group Archives", data.stockGroupLocationArchives, [
    { header: "ID", key: "id", width: 8 },
    { header: "Stock Group ID", key: "stock_group_id", width: 16 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Archive Date", key: "archive_date", width: 16 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Stock Group Archive Items", data.stockGroupLocationArchiveItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Archive ID", key: "archive_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Quantity", key: "quantity", width: 14, numFmt: "#,##0.000" },
    { header: "Average Cost", key: "average_cost", width: 16, numFmt: NUM_FMT },
    { header: "Total Value", key: "total_value", width: 16, numFmt: NUM_FMT },
  ]);

  addSheet(wb, "Proforma Reservations", data.proformaStockReservations, [
    { header: "ID", key: "id", width: 8 },
    { header: "Proforma ID", key: "proforma_id", width: 14 },
    { header: "Stock Item ID", key: "stock_item_id", width: 16 },
    { header: "Location ID", key: "location_id", width: 14 },
    { header: "Reserved Qty", key: "reserved_qty", width: 16, numFmt: "#,##0.000" },
    { header: "Expires At", key: "expires_at", width: 22 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Containers Extended ───────────────────────────────────────────────────
  addSheet(wb, "Container Freight", data.containerFreight, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Freight Type", key: "freight_type", width: 20 },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Vendor", key: "vendor", width: 25 },
    { header: "Due Date", key: "due_date", width: 14 },
    { header: "Paid", key: "paid", width: 10 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Container Freight Payments", data.containerFreightPayments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Freight ID", key: "freight_id", width: 12 },
    { header: "Payment Date", key: "payment_date", width: 16 },
    { header: "Amount Paid", key: "amount_paid", width: 16, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Payment Method", key: "payment_method", width: 20 },
    { header: "Reference", key: "reference", width: 20 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Container Documents", data.containerDocuments, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Document Type", key: "document_type", width: 22 },
    { header: "Document Number", key: "document_number", width: 22 },
    { header: "Issued Date", key: "issued_date", width: 14 },
    { header: "Expiry Date", key: "expiry_date", width: 14 },
    { header: "Notes", key: "notes", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Container Sales", data.containerSales, [
    { header: "ID", key: "id", width: 8 },
    { header: "Container ID", key: "container_id", width: 14 },
    { header: "Customer ID", key: "customer_id", width: 14 },
    { header: "Sale Date", key: "sale_date", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 18, numFmt: NUM_FMT },
    { header: "Currency", key: "currency", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  // ── Waste ──────────────────────────────────────────────────────────────────
  addSheet(wb, "Waste Dispatches", data.wasteDispatches, [
    { header: "ID", key: "id", width: 8 },
    { header: "Dispatch Date", key: "dispatch_date", width: 16 },
    { header: "Destination", key: "destination", width: 30 },
    { header: "Total KG", key: "total_kg", width: 14, numFmt: "#,##0.000" },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
    { header: "Status", key: "status", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  addSheet(wb, "Waste Dispatch Items", data.wasteDispatchItems, [
    { header: "ID", key: "id", width: 8 },
    { header: "Dispatch ID", key: "dispatch_id", width: 14 },
    { header: "Waste Type", key: "waste_type", width: 20 },
    { header: "Quantity KG", key: "quantity_kg", width: 16, numFmt: "#,##0.000" },
    { header: "Rate Per KG", key: "rate_per_kg", width: 16, numFmt: NUM_FMT },
    { header: "Amount", key: "amount", width: 16, numFmt: NUM_FMT },
  ]);

  // ── Spreadsheets ───────────────────────────────────────────────────────────
  addSheet(wb, "Spreadsheets", data.spreadsheets, [
    { header: "ID", key: "id", width: 8 },
    { header: "Name", key: "name", width: 35 },
    { header: "Created At", key: "created_at", width: 22 },
    { header: "Updated At", key: "updated_at", width: 22 },
  ]);

  // ── Import Logs ────────────────────────────────────────────────────────────
  addSheet(wb, "Import Logs", data.importLogs, [
    { header: "ID", key: "id", width: 8 },
    { header: "Import Type", key: "import_type", width: 20 },
    { header: "File Name", key: "file_name", width: 35 },
    { header: "Status", key: "status", width: 14 },
    { header: "Records Imported", key: "records_imported", width: 18 },
    { header: "Records Failed", key: "records_failed", width: 16 },
    { header: "Error Message", key: "error_message", width: 50 },
    { header: "Created At", key: "created_at", width: 22 },
  ]);

  const buf = await wb.xlsx.writeBuffer();
  return buf as Buffer;
}
