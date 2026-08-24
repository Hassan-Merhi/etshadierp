import fs from "node:fs";

const targets = [
  ["client/src/pages/factory/factory-location-inventory/dialogs/FinalizeProformaDialog.tsx", "../../FactoryLocationInventoryModel", "useFactoryLocationInventory", "FactoryLocationInventoryModel"],
  ["client/src/pages/factory/factory-location-inventory/dialogs/PrintBarcodesDialog.tsx", "../../FactoryLocationInventoryModel", "useFactoryLocationInventory", "FactoryLocationInventoryModel"],
  ["client/src/pages/factory/factory-location-inventory/dialogs/RemoveBalesDialog.tsx", "../../FactoryLocationInventoryModel", "useFactoryLocationInventory", "FactoryLocationInventoryModel"],
  ["client/src/pages/factory/factory-location-inventory/dialogs/RenameLocationDialog.tsx", "../../FactoryLocationInventoryModel", "useFactoryLocationInventory", "FactoryLocationInventoryModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/AddPriceLineDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/CreatePendingLoadingDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/EditPriceLineDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/ImportProformaExcelDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/RenameProformaDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-proformas/dialogs/TransferProformaDialog.tsx", "../../factoryproformas/useFactoryProformasModel", "useFactoryProformasModel", "FactoryProformasModel"],
  ["client/src/pages/factory/factory-suppliers/SupplierDialogs.tsx", "./useFactorySuppliersModel", "useFactorySuppliersModel", "FactorySuppliersModel"],
  ["client/src/pages/factory/factory-suppliers/SupplierFormDialog.tsx", "./useFactorySuppliersModel", "useFactorySuppliersModel", "FactorySuppliersModel"],
  ["client/src/pages/factory/factory-suppliers/SupplierOtherDialogs.tsx", "./useFactorySuppliersModel", "useFactorySuppliersModel", "FactorySuppliersModel"],
  ["client/src/pages/factory/factory-suppliers/SupplierPaymentFxDialogs.tsx", "./useFactorySuppliersModel", "useFactorySuppliersModel", "FactorySuppliersModel"],
  ["client/src/pages/vouchers/stock-transfer-form/dialogs/ImportTransferExcelDialog.tsx", "../useStockTransferFormModel", "useStockTransferFormModel", "StockTransferFormModel"],
  ["client/src/pages/factory/factory-worker-detail/dialogs/EndContractDialog.tsx", "../../factoryworkerdetail/useFactoryWorkerDetailModel", "useFactoryWorkerDetailModel", "FactoryWorkerDetailModel"],
  ["client/src/pages/factory/factory-worker-detail/dialogs/GenerateMissingAccountingEntryDialog.tsx", "../../factoryworkerdetail/useFactoryWorkerDetailModel", "useFactoryWorkerDetailModel", "FactoryWorkerDetailModel"],
  ["client/src/pages/factory/factory-worker-detail/dialogs/MarkPayrollPaidDialog.tsx", "../../factoryworkerdetail/useFactoryWorkerDetailModel", "useFactoryWorkerDetailModel", "FactoryWorkerDetailModel"],
  ["client/src/pages/factory/factory-worker-detail/dialogs/PayrollDetailDialog.tsx", "../../factoryworkerdetail/useFactoryWorkerDetailModel", "useFactoryWorkerDetailModel", "FactoryWorkerDetailModel"],
  ["client/src/pages/payroll/AdvanceDialogs.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/BonusDialog.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/BulkDialogs.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/BulkPaymentDialog.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/EditEmployeeDialog.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/EmployeeCrudDialogs.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/WorkerDialogs.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/WorkersTab.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/payroll/WorkersTable.tsx", "./usePayrollModel", "usePayrollModel", "PayrollModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/BulkAdvanceDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/CashAccountAdjustmentDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/ConfirmRepaymentDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/PostAccountingPreviewDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/ReconcileBalancesDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/RecordAdvanceDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/RepayByMonthDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/RepaymentAuditDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
  ["client/src/pages/factory/factoryadvancestab/dialogs/ReverseAdvanceDialog.tsx", "../advances/useAdvancesModel", "useAdvancesModel", "AdvancesModel"],
];

function insertModelType(source, modelPath, hookName, alias) {
  const importLine = `import type { ${hookName} } from "${modelPath}";`;
  const aliasLine = `type ${alias} = ReturnType<typeof ${hookName}>;`;
  if (!source.includes(importLine)) {
    const firstImport = source.indexOf("import ");
    if (firstImport < 0) throw new Error("No import block found");
    source = `${source.slice(0, firstImport)}${importLine}\n${source.slice(firstImport)}`;
  }
  if (!source.includes(aliasLine)) {
    const importIndex = source.indexOf(importLine);
    const end = importIndex + importLine.length;
    source = `${source.slice(0, end)}\n\n${aliasLine}${source.slice(end)}`;
  }
  return source;
}

function replaceAnyPropTypes(source, alias) {
  const propPattern = /^(\s{2})([A-Za-z_$][\w$]*)(\??):\s*([^;\n]*\bany\b[^;\n]*);\s*$/gm;
  let replacements = 0;
  source = source.replace(propPattern, (_match, indent, prop, optional) => {
    replacements += 1;
    return `${indent}${prop}${optional}: ${alias}["${prop}"];`;
  });
  source = source.replace(/\(([A-Za-z_$][\w$]*)\s*:\s*any\)/g, "($1)");
  source = source.replace(/\(([A-Za-z_$][\w$]*)\s*:\s*any\[\]\)/g, "($1)");
  return { source, replacements };
}

let changedFiles = 0;
let replacedProps = 0;
for (const [file, modelPath, hookName, alias] of targets) {
  if (!fs.existsSync(file)) {
    console.warn(`SKIP missing ${file}`);
    continue;
  }
  const before = fs.readFileSync(file, "utf8");
  let after = insertModelType(before, modelPath, hookName, alias);
  const result = replaceAnyPropTypes(after, alias);
  after = result.source;
  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles += 1;
    replacedProps += result.replacements;
    console.log(`${file}: ${result.replacements} model-bound any prop type(s) replaced`);
  }
}
console.log(`Phase 2.2 codemod changed ${changedFiles} files and model-bound ${replacedProps} prop declarations.`);
