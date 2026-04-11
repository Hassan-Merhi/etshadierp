import { pool } from "../db";

export interface CompanyExportData {
  company: any;
  locations: any[];
  ledgerAccounts: any[];
  vouchers: any[];
  voucherEntries: any[];
  suppliers: any[];
  supplierTransactions: any[];
  customers: any[];
  customerTransactions: any[];
  employees: any[];
  employeePayrolls: any[];
  employeeAdvances: any[];
  factoryWorkers: any[];
  factoryPayrolls: any[];
  factoryAttendance: any[];
  factoryDaybook: any[];
  stockItems: any[];
  inventory: any[];
  stockGroups: any[];
  stockTransfers: any[];
  stockTransferItems: any[];
  stockTransferRevisions: any[];
  stockTransferRevisionItems: any[];
  stockAdjustments: any[];
  stockAdjustmentItems: any[];
  purchaseOrders: any[];
  poLineItems: any[];
  containers: any[];
  containerCharges: any[];
  containerOffloads: any[];
  containerOffloadItems: any[];
  bales: any[];
  factoryBaleProducts: any[];
  factoryBales: any[];
  factoryContainers: any[];
  bankAccounts: any[];
  fixedAssets: any[];
  exchangeRates: any[];
  posShifts: any[];
  salesItems: any[];
  auditLog: any[];
}

async function q(sql: string): Promise<any[]> {
  try {
    const result = await pool.query(sql);
    return result.rows;
  } catch (err: any) {
    console.warn(`[ExportData] Query warning: ${err.message}`);
    return [];
  }
}

export async function fetchAllCompanies(): Promise<any[]> {
  return q(`SELECT * FROM companies ORDER BY id`);
}

export async function fetchCompanyExportData(
  companyId: number,
  fromDate?: string,
  toDate?: string
): Promise<CompanyExportData> {
  const cid = Number(companyId);
  const dateFilter = (col: string) => {
    const parts: string[] = [];
    if (fromDate) parts.push(`AND ${col} >= '${fromDate}'`);
    if (toDate) parts.push(`AND ${col} <= '${toDate}'`);
    return parts.join(" ");
  };

  const [
    companiesRows,
    locations,
    ledgerAccounts,
    vouchers,
    voucherEntries,
    suppliers,
    supplierTransactions,
    customers,
    customerTransactions,
    employees,
    employeePayrolls,
    employeeAdvances,
    factoryWorkers,
    factoryPayrolls,
    factoryAttendance,
    factoryDaybook,
    stockItems,
    inventory,
    stockGroups,
    stockTransfers,
    stockTransferItems,
    stockTransferRevisions,
    stockTransferRevisionItems,
    stockAdjustments,
    stockAdjustmentItems,
    purchaseOrders,
    poLineItems,
    containers,
    containerCharges,
    containerOffloads,
    containerOffloadItems,
    bales,
    factoryBaleProducts,
    factoryBales,
    factoryContainers,
    bankAccounts,
    fixedAssets,
    exchangeRates,
    posShifts,
    salesItems,
    auditLog,
  ] = await Promise.all([
    q(`SELECT * FROM companies WHERE id = ${cid}`),
    q(`SELECT * FROM locations WHERE company_id = ${cid} AND deleted_at IS NULL ORDER BY name`),
    q(`SELECT * FROM ledger_accounts WHERE company_id = ${cid} AND deleted_at IS NULL ORDER BY code`),
    q(`SELECT * FROM vouchers WHERE company_id = ${cid} ${dateFilter("voucher_date")} ORDER BY voucher_date, id`),
    q(`SELECT ve.* FROM voucher_entries ve INNER JOIN vouchers v ON v.id = ve.voucher_id WHERE v.company_id = ${cid} ${dateFilter("v.voucher_date")} ORDER BY ve.id`),
    q(`SELECT * FROM suppliers WHERE company_id = ${cid} AND deleted_at IS NULL ORDER BY legal_name`),
    q(`SELECT ve.*, v.voucher_number, v.voucher_type, v.voucher_date, v.narration as voucher_narration FROM voucher_entries ve INNER JOIN vouchers v ON v.id = ve.voucher_id WHERE v.company_id = ${cid} AND ve.supplier_id IS NOT NULL ${dateFilter("v.voucher_date")} ORDER BY v.voucher_date, ve.id`),
    q(`SELECT * FROM customers WHERE company_id = ${cid} AND deleted_at IS NULL ORDER BY name`),
    q(`SELECT ve.*, v.voucher_number, v.voucher_type, v.voucher_date, v.narration as voucher_narration FROM voucher_entries ve INNER JOIN vouchers v ON v.id = ve.voucher_id WHERE v.company_id = ${cid} AND ve.customer_id IS NOT NULL ${dateFilter("v.voucher_date")} ORDER BY v.voucher_date, ve.id`),
    q(`SELECT * FROM employees WHERE company_id = ${cid} AND deleted_at IS NULL ORDER BY first_name, last_name`),
    q(`SELECT p.* FROM erp_payroll_run_items p INNER JOIN erp_payroll_runs r ON r.id = p.payroll_run_id WHERE r.company_id = ${cid} ${dateFilter("r.pay_date")} ORDER BY r.pay_date, p.id`),
    q(`SELECT * FROM salary_advances WHERE company_id = ${cid} ${dateFilter("advance_date")} ORDER BY advance_date, id`),
    q(`SELECT * FROM factory_workers WHERE company_id = ${cid} ORDER BY name`),
    q(`SELECT * FROM factory_payrolls WHERE company_id = ${cid} ${dateFilter("period_start")} ORDER BY period_start, id`),
    q(`SELECT * FROM factory_attendance WHERE company_id = ${cid} ${dateFilter("attendance_date")} ORDER BY attendance_date, id`),
    q(`SELECT * FROM factory_daybook_entries WHERE company_id = ${cid} ${dateFilter("entry_date")} ORDER BY entry_date, id`),
    q(`SELECT * FROM stock_items WHERE company_id = ${cid} ORDER BY code`),
    q(`SELECT i.*, si.code as item_code, si.name as item_name, l.name as location_name FROM inventory i INNER JOIN stock_items si ON si.id = i.stock_item_id INNER JOIN locations l ON l.id = i.location_id WHERE si.company_id = ${cid} ORDER BY l.name, si.code`),
    q(`SELECT * FROM stock_groups WHERE company_id = ${cid} ORDER BY name`),
    q(`SELECT stv.*, l1.name as from_location_name, l2.name as to_location_name FROM stock_transfer_vouchers stv LEFT JOIN locations l1 ON l1.id = stv.from_location_id LEFT JOIN locations l2 ON l2.id = stv.to_location_id WHERE stv.company_id = ${cid} ${dateFilter("stv.transfer_date")} ORDER BY stv.transfer_date, stv.id`),
    q(`SELECT sti.* FROM stock_transfer_items sti INNER JOIN stock_transfer_vouchers stv ON stv.id = sti.transfer_voucher_id WHERE stv.company_id = ${cid} ORDER BY sti.id`),
    q(`SELECT r.* FROM stock_transfer_revisions r INNER JOIN stock_transfer_vouchers stv ON stv.id = r.transfer_id WHERE stv.company_id = ${cid} ORDER BY r.id`),
    q(`SELECT ri.* FROM stock_transfer_revision_items ri INNER JOIN stock_transfer_revisions r ON r.id = ri.revision_id INNER JOIN stock_transfer_vouchers stv ON stv.id = r.transfer_id WHERE stv.company_id = ${cid} ORDER BY ri.id`),
    q(`SELECT * FROM stock_adjustment_vouchers WHERE company_id = ${cid} ${dateFilter("adjustment_date")} ORDER BY adjustment_date, id`),
    q(`SELECT ai.* FROM stock_adjustment_items ai INNER JOIN stock_adjustment_vouchers av ON av.id = ai.adjustment_voucher_id WHERE av.company_id = ${cid} ORDER BY ai.id`),
    q(`SELECT po.* FROM purchase_orders po WHERE po.company_id = ${cid} ${dateFilter("po.po_date")} ORDER BY po.po_date, po.id`),
    q(`SELECT pli.* FROM po_line_items pli INNER JOIN purchase_orders po ON po.id = pli.po_id WHERE po.company_id = ${cid} ORDER BY pli.id`),
    q(`SELECT * FROM containers WHERE company_id = ${cid} ${dateFilter("import_date")} ORDER BY import_date DESC, id`),
    q(`SELECT cc.* FROM container_charges cc INNER JOIN containers c ON c.id = cc.container_id WHERE c.company_id = ${cid} ORDER BY cc.id`),
    q(`SELECT co.* FROM container_offloads co INNER JOIN containers c ON c.id = co.container_id WHERE c.company_id = ${cid} ORDER BY co.id`),
    q(`SELECT coi.* FROM container_offload_items coi INNER JOIN container_offloads co ON co.id = coi.offload_id INNER JOIN containers c ON c.id = co.container_id WHERE c.company_id = ${cid} ORDER BY coi.id`),
    q(`SELECT * FROM bales WHERE company_id = ${cid} ${dateFilter("date_pressed")} ORDER BY date_pressed DESC, id`),
    q(`SELECT * FROM factory_bale_products WHERE company_id = ${cid} ORDER BY name`),
    q(`SELECT * FROM factory_bales WHERE company_id = ${cid} ${dateFilter("pressed_date")} ORDER BY pressed_date DESC, id`),
    q(`SELECT * FROM factory_containers WHERE company_id = ${cid} ORDER BY id DESC`),
    q(`SELECT ba.* FROM bank_accounts ba INNER JOIN ledger_accounts la ON la.id = ba.ledger_account_id WHERE la.company_id = ${cid} ORDER BY ba.id`),
    q(`SELECT fa.* FROM fixed_assets fa INNER JOIN ledger_accounts la ON la.id = fa.ledger_account_id WHERE la.company_id = ${cid} ORDER BY fa.id`),
    q(`SELECT * FROM exchange_rates WHERE company_id = ${cid} ${dateFilter("effective_date")} ORDER BY effective_date DESC, id`),
    q(`SELECT * FROM pos_shifts WHERE company_id = ${cid} ${dateFilter("opened_at::date")} ORDER BY opened_at DESC`),
    q(`SELECT si.*, v.voucher_number, v.voucher_date FROM sales_items si INNER JOIN vouchers v ON v.id = si.voucher_id WHERE v.company_id = ${cid} ${dateFilter("v.voucher_date")} ORDER BY v.voucher_date, si.id`),
    q(`SELECT * FROM audit_log WHERE company_id = ${cid} ${dateFilter("created_at::date")} ORDER BY created_at DESC LIMIT 100000`),
  ]);

  return {
    company: companiesRows[0] || {},
    locations,
    ledgerAccounts,
    vouchers,
    voucherEntries,
    suppliers,
    supplierTransactions,
    customers,
    customerTransactions,
    employees,
    employeePayrolls,
    employeeAdvances,
    factoryWorkers,
    factoryPayrolls,
    factoryAttendance,
    factoryDaybook,
    stockItems,
    inventory,
    stockGroups,
    stockTransfers,
    stockTransferItems,
    stockTransferRevisions,
    stockTransferRevisionItems,
    stockAdjustments,
    stockAdjustmentItems,
    purchaseOrders,
    poLineItems,
    containers,
    containerCharges,
    containerOffloads,
    containerOffloadItems,
    bales,
    factoryBaleProducts,
    factoryBales,
    factoryContainers,
    bankAccounts,
    fixedAssets,
    exchangeRates,
    posShifts,
    salesItems,
    auditLog,
  };
}
