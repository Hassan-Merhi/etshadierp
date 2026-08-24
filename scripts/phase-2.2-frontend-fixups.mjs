import fs from "node:fs";

function rewrite(file, transform) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(`fixed ${file}`);
  }
}

function dedupeExactBlock(source, block) {
  const first = source.indexOf(block);
  if (first < 0) return source;
  let next = source.indexOf(block, first + block.length);
  while (next >= 0) {
    source = source.slice(0, next) + source.slice(next + block.length);
    next = source.indexOf(block, first + block.length);
  }
  return source;
}

const spOffloadTypes = `interface SpContainerLine {\n  qty?: string | number | null;\n  unitRateUsd?: string | number | null;\n}\n\ninterface SpPrepaidCharge {\n  id: string | number;\n  chargeType: string;\n  amountPaidUsd: string | number;\n}\n\ninterface SpOffloadContainer {\n  id: number;\n  supplierName?: string | null;\n  containerNumber?: string | null;\n  invoiceNumber?: string | null;\n  discountPct?: string | number | null;\n  invoiceTotalUsd?: string | number | null;\n  lines?: SpContainerLine[];\n  prepaid?: SpPrepaidCharge[];\n}\n\ninterface SpSetupAccount {\n  id: string | number;\n  subType: string;\n  name?: string | null;\n}\n\ninterface SpBankAccount {\n  id: string | number;\n  bankName: string;\n}\n\ninterface SpSetupStatus {\n  spAccounts?: SpSetupAccount[];\n  bankAccounts?: SpBankAccount[];\n}\n\ninterface SpLedgerAccount {\n  id: string | number;\n  code?: string | null;\n  name: string;\n}\n\ninterface SpLocationOption {\n  id: string | number;\n  name: string;\n}\n\ninterface ParentAgentOption {\n  ledger_account_id: string | number;\n  account_name: string;\n}\n\n`;

const offloadTypes = `interface LedgerAccountOption {\n  id: string | number;\n  name: string;\n}\n\ninterface SpSetupAccountOption {\n  id: string | number;\n  subType: string;\n  name?: string | null;\n}\n\ninterface SpSetupStatusData {\n  spAccounts?: SpSetupAccountOption[];\n}\n\ninterface ParentAgentOption {\n  ledger_account_id: string | number;\n  account_name: string;\n}\n\ninterface ContainerCharge {\n  amount?: string | number | null;\n}\n\ninterface ContainerOffloadData {\n  charges?: ContainerCharge[];\n}\n\n`;

rewrite("client/src/components/SpOffloadDialog.tsx", (source) => dedupeExactBlock(source, spOffloadTypes));
rewrite("client/src/components/OffloadDialog.tsx", (source) => dedupeExactBlock(source, offloadTypes));

rewrite("client/src/pages/factory/factory-location-inventory/dialogs/PrintBarcodesDialog.tsx", (source) =>
  source
    .replace("${selectedLocation.name}", '${selectedLocation?.name ?? "selected location"}')
    .replace("parseFloat(row.bale.weightKg).toFixed(1)", "Number(row.bale.weightKg ?? 0).toFixed(1)")
);

rewrite("client/src/pages/factory/factory-location-inventory/dialogs/RemoveBalesDialog.tsx", (source) =>
  source.replace("<strong>{selectedLocation.name}</strong>", '<strong>{selectedLocation?.name ?? "selected location"}</strong>')
);

rewrite("client/src/pages/factory/factoryproformas/types.ts", (source) => {
  if (source.includes("export interface CatalogStockItem")) return source;
  const block = `export interface CatalogStockItem {\n  id: number;\n  code?: string | null;\n  name: string;\n  uom?: string | null;\n  stockGroup?: { name?: string | null } | null;\n}\n\n`;
  return source.replace("export interface ProformaLine {", `${block}export interface ProformaLine {`);
});

rewrite("client/src/pages/factory/factoryproformas/useFactoryProformasModel.ts", (source) =>
  source
    .replace(
      'import type { Customer, Proforma, ProformaLine } from "./types";',
      'import type { CatalogStockItem, Customer, Proforma, ProformaLine } from "./types";'
    )
    .replace("useState<unknown | null>(null)", "useState<CatalogStockItem | null>(null)")
    .replace("const { data: allStockItems = [] } = useQuery({", "const { data: allStockItems = [] } = useQuery<CatalogStockItem[]>({")
);

for (const file of [
  "client/src/pages/factory/factory-suppliers/SupplierFormDialog.tsx",
  "client/src/pages/factory/factory-suppliers/SupplierOtherDialogs.tsx",
  "client/src/pages/factory/factory-suppliers/SupplierPaymentFxDialogs.tsx",
]) {
  rewrite(file, (source) => source.replace('import { UseMutationResult } from "@tanstack/react-query";\n', ""));
}

rewrite("client/src/pages/factory/factory-suppliers/useFactorySuppliersModel.tsx", (source) => {
  if (!source.includes("interface OpeningCommissionUpdatePayload")) {
    source = source.replace(
      "interface MoveContainerState {",
      `interface OpeningCommissionUpdatePayload {\n  rawStockId: number;\n  commissionAmount: string;\n  commissionCurrencyCode: string;\n  commissionPersonName: string;\n  commissionNotes: string;\n}\n\ninterface DueContainer {\n  id: number;\n  containerNumber: string;\n  offloadDate: string;\n  currencyCode: string;\n  value: string;\n  daysPastDue: number;\n}\n\ninterface MoveContainerState {`
    );
  }
  return source
    .replace(
      'useState<{ name: string; containers: unknown[] } | null>(null)',
      'useState<{ name: string; containers: DueContainer[] } | null>(null)'
    )
    .replace("mutationFn: async (data: OpeningCommissionEdit) =>", "mutationFn: async (data: OpeningCommissionUpdatePayload) =>");
});

rewrite("client/src/pages/factory/factory-suppliers/SupplierOtherDialogs.tsx", (source) =>
  source.replace('dueDialogSupplier: { name: string; containers: any[] } | null;', 'dueDialogSupplier: FactorySuppliersModel["dueDialogSupplier"];')
);

rewrite("client/src/pages/factory/factory-worker-detail/dialogs/EndContractDialog.tsx", (source) => {
  if (source.includes("  if (!worker) return null;")) return source;
  return source.replace("}) {\n  return (", "}) {\n  if (!worker) return null;\n\n  return (");
});

rewrite("client/src/pages/factory/factory-worker-detail/dialogs/PayrollDetailDialog.tsx", (source) =>
  source
    .replace(/parseFloat\(payrollDetail\.payroll\.balesCount \|\| "0"\)/g, "Number(payrollDetail.payroll.balesCount ?? 0)")
    .replace(/parseFloat\(payrollDetail\.payroll\.kgProcessed \|\| "0"\)/g, "Number(payrollDetail.payroll.kgProcessed ?? 0)")
    .replace(/parseFloat\(payrollDetail\.payroll\.overtimeHours \|\| "0"\)/g, "Number(payrollDetail.payroll.overtimeHours ?? 0)")
);

rewrite("client/src/pages/payroll/payrollTypes.ts", (source) =>
  source
    .replace("  accountType?: string;", "  accountType?: string;\n  code?: string;\n  accountNumber?: string | null;")
);

rewrite("client/src/pages/payroll/AdvanceDialogs.tsx", (source) => {
  source = source.replace(
    'import type { usePayrollModel } from "./usePayrollModel";\n\ntype PayrollModel = ReturnType<typeof usePayrollModel>;\n',
    'import type { UseFormReturn } from "react-hook-form";\nimport type { Employee } from "@shared/schema";\nimport type { AccountOption } from "./payrollTypes";\nimport type { DeductionFormData, SalaryAdvance, SalaryAdvanceFormData } from "./payrollSchemas";\n\ninterface MutationController<TVariables> {\n  isPending: boolean;\n  mutate: (variables: TVariables) => void;\n}\n'
  );
  return source
    .replace('advanceForm: PayrollModel["advanceForm"];', "advanceForm: UseFormReturn<SalaryAdvanceFormData>;")
    .replace('advanceMutation: PayrollModel["advanceMutation"];', "advanceMutation: MutationController<SalaryAdvanceFormData>;")
    .replace('workerStaff: PayrollModel["workerStaff"];', "workerStaff: Employee[];")
    .replace('cashAccounts: PayrollModel["cashAccounts"];', "cashAccounts: AccountOption[];")
    .replace('selectedAdvance: PayrollModel["selectedAdvance"];', "selectedAdvance: SalaryAdvance | null;")
    .replace('deductionForm: PayrollModel["deductionForm"];', "deductionForm: UseFormReturn<DeductionFormData>;")
    .replace('deductionMutation: PayrollModel["deductionMutation"];', "deductionMutation: MutationController<DeductionFormData>;")
    .replace('deleteAdvanceMutation: PayrollModel["deleteAdvanceMutation"];', "deleteAdvanceMutation: MutationController<number>;")
    .replace(/handleSubmit\(\(data: unknown\) =>/g, "handleSubmit((data) =>");
});

rewrite("client/src/pages/payroll/BulkPaymentDialog.tsx", (source) =>
  source
    .replace('selectedPayments: PayrollModel["selectedPayments"];', 'selectedPayments: PayrollModel["selectedPaymentsSummary"];')
    .replace('form: PayrollModel["form"];', 'form: PayrollModel["bulkPaymentForm"];')
    .replace('mutation: PayrollModel["mutation"];', 'mutation: PayrollModel["bulkPaymentMutation"];')
    .replace(/handleSubmit\(\(data: unknown\) =>/g, "handleSubmit((data) =>")
);

rewrite("client/src/pages/payroll/EditEmployeeDialog.tsx", (source) =>
  source.replace('pctLocations: PayrollModel["pctLocations"];', 'pctLocations: PayrollModel["allCompanyLocations"];')
);

rewrite("client/src/pages/payroll/WorkerDialogs.tsx", (source) =>
  source
    .replace('allWorkerGroups: PayrollModel["allWorkerGroups"];', 'allWorkerGroups: PayrollModel["workerGroupsData"];')
    .replace("updateWorkerMutation.mutate({ ...data, id: selectedWorkerForEdit.id });", "updateWorkerMutation.mutate(data);")
);

rewrite("client/src/pages/payroll/WorkersTab.tsx", (source) =>
  source.replace('workerGroups: PayrollModel["workerGroups"];', 'workerGroups: PayrollModel["workerGroupsData"];')
);

rewrite("client/src/pages/payroll/WorkersTable.tsx", (source) => {
  if (!source.includes("type PayrollWorker =")) {
    source = source.replace(
      'import { getEmpAvatarColor, getEmpInitials } from "./payrollSchemas";\n',
      'import { getEmpAvatarColor, getEmpInitials } from "./payrollSchemas";\n\ntype PayrollWorker = Employee & {\n  advanceInfo?: { total: number; count: number };\n  deductionInfo?: { total: number; count: number };\n};\n'
    );
  }
  return source
    .replace("  workers: Employee[];", "  workers: PayrollWorker[];")
    .replace('workerGroups: PayrollModel["workerGroups"];', 'workerGroups: PayrollModel["workerGroupsData"];')
    .replace("setWorkerOverrides: (val: Record<string, unknown>) => void;", 'setWorkerOverrides: PayrollModel["setWorkerOverrides"];')
    .replace('const advanceInfo = (worker as any).advanceInfo || { total: 0, count: 0 };', "const advanceInfo = worker.advanceInfo ?? { total: 0, count: 0 };")
    .replace('const deductionInfo = (worker as any).deductionInfo || { total: 0, count: 0 };', "const deductionInfo = worker.deductionInfo ?? { total: 0, count: 0 };")
    .replace(/\n\s*const _balance = parseFloat\(\(worker as any\)\.calculatedBalance \|\| "0"\);/, "");
});

rewrite("client/src/pages/payroll/BulkDialogs.tsx", (source) =>
  source.replace(
    "setBulkWithdrawalAccountType(val);\n                    setBulkWithdrawalAccountId(\"\");",
    'if (val === "cash" || val === "bank") {\n                      setBulkWithdrawalAccountType(val);\n                      setBulkWithdrawalAccountId("");\n                    }'
  )
);

rewrite("client/src/pages/payroll/payrollSchemas.ts", (source) => {
  if (source.includes("  isOpeningBalance?: boolean;")) return source;
  return source.replace("  fullyPaid: boolean;", "  fullyPaid: boolean;\n  isOpeningBalance?: boolean;");
});

rewrite("client/src/pages/payroll/AdvancesTab.tsx", (source) => {
  source = source
    .replace('import type { Employee } from "@shared/schema";', 'import type { Employee } from "@shared/schema";\nimport type { AccountOption } from "./payrollTypes";')
    .replace("  cashAccounts?: any[];", "  cashAccounts?: AccountOption[];")
    .replace("select: (data: any[]) => data.filter((e) => e.employeeType === \"Worker\"),", 'select: (data) => data.filter((e) => e.employeeType === "Worker"),')
    .replace(
      '(advance as unknown as SalaryAdvance & { isOpeningBalance: React.ReactNode }).isOpeningBalance',
      "advance.isOpeningBalance"
    );
  return source;
});
