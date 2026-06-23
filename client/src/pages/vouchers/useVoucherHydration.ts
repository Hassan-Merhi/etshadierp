import { useEffect, useRef } from "react";
import { UseFormReturn } from "react-hook-form";
import { parseDateLocal } from "@/components/vouchers/PrintTemplate";
import type { VoucherFormData } from "./voucherTypes";
import type {
  BankAccount,
  LedgerAccount,
  Supplier,
  Customer,
  Employee,
  FixedAsset,
  FactorySupplierBasic,
} from "./voucherTypes";

interface UseVoucherHydrationProps {
  voucherToEdit: any;
  allAccounts: any[];
  bankAccounts: BankAccount[];
  ledgerAccounts: LedgerAccount[];
  suppliers: Supplier[];
  employees: Employee[];
  fixedAssets: FixedAsset[];
  customers: Customer[];
  factorySuppliersList: FactorySupplierBasic[];
  form: UseFormReturn<VoucherFormData>;
  setTransactionRate: (rate: number) => void;
  setVoucherEffectiveDate: (date: string) => void;
}

export function useVoucherHydration({
  voucherToEdit,
  allAccounts,
  bankAccounts,
  ledgerAccounts,
  suppliers,
  employees,
  fixedAssets,
  customers,
  factorySuppliersList,
  form,
  setTransactionRate,
  setVoucherEffectiveDate,
}: UseVoucherHydrationProps) {
  const hydratedVoucherIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (voucherToEdit && voucherToEdit.entries && allAccounts.length > 0) {
      if (hydratedVoucherIdRef.current === voucherToEdit.id) return;
      const needsFactorySuppliers = voucherToEdit.entries.some((e: any) => e.factorySupplierId);
      if (needsFactorySuppliers && factorySuppliersList.length === 0) return;

      const allEntries = voucherToEdit.entries;
      let paymentEntry: any = null;

      if (voucherToEdit.voucherType === "Payment") {
        paymentEntry = allEntries.find((entry: any) => {
          const cr = parseFloat(entry.creditAmount || "0");
          const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
          return !isLiability && cr > 0;
        });
        if (!paymentEntry) {
          paymentEntry = allEntries.find((entry: any) => {
            const dr = parseFloat(entry.debitAmount || "0");
            const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
            return isLiability && dr > 0;
          });
        }
      } else if (voucherToEdit.voucherType === "Receipt") {
        paymentEntry = allEntries.find((entry: any) => {
          const dr = parseFloat(entry.debitAmount || "0");
          const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
          return !isLiability && dr > 0;
        });
        if (!paymentEntry) {
          paymentEntry = allEntries.find((entry: any) => {
            const cr = parseFloat(entry.creditAmount || "0");
            const isLiability = entry.supplierId || entry.employeeId || entry.factorySupplierId;
            return isLiability && cr > 0;
          });
        }
      }

      if (!paymentEntry) return;

      let paymentType: string = "bank";
      let paymentId = 0;
      let paymentName = "";

      if (paymentEntry.bankAccountId) {
        paymentType = "bank";
        paymentId = paymentEntry.bankAccountId;
        const account = bankAccounts.find((b) => b.id === paymentId);
        paymentName = account?.bankName || "";
      } else if (paymentEntry.ledgerAccountId) {
        paymentType = "ledger";
        paymentId = paymentEntry.ledgerAccountId;
        const account = ledgerAccounts.find((l) => l.id === paymentId);
        paymentName = account?.name || "";
      } else if (paymentEntry.supplierId) {
        paymentType = "supplier";
        paymentId = paymentEntry.supplierId;
        const supplier = suppliers.find((s) => s.id === paymentId);
        paymentName = supplier?.legalName || "";
      } else if (paymentEntry.factorySupplierId) {
        paymentType = "factorySupplier";
        paymentId = paymentEntry.factorySupplierId;
        const fs = factorySuppliersList.find((s) => s.id === paymentId);
        paymentName = fs?.name || "";
      } else if (paymentEntry.employeeId) {
        paymentType = "employee";
        paymentId = paymentEntry.employeeId;
        const employee = employees.find((e) => e.id === paymentId);
        paymentName = employee ? `${employee.firstName} ${employee.lastName}` : "";
      } else if (paymentEntry.fixedAssetId) {
        paymentType = "fixedAsset";
        paymentId = paymentEntry.fixedAssetId;
        const asset = fixedAssets.find((f) => f.id === paymentId);
        paymentName = asset?.name || "";
      }

      const payFromCustomerId = paymentEntry.customerId || null;
      const payFromLedgerId = paymentEntry.ledgerAccountId || null;
      const payFromBankId = paymentEntry.bankAccountId || null;
      const payFromSupplierId = paymentEntry.supplierId || null;
      const payFromFactorySupplierId = paymentEntry.factorySupplierId || null;
      const payFromEmployeeId = paymentEntry.employeeId || null;

      const formEntries = voucherToEdit.entries
        .filter((entry: any) => {
          if (entry === paymentEntry) return false;
          if (payFromLedgerId && entry.ledgerAccountId === payFromLedgerId) return false;
          if (payFromBankId && entry.bankAccountId === payFromBankId) return false;
          if (payFromSupplierId && entry.supplierId === payFromSupplierId) return false;
          if (payFromFactorySupplierId && entry.factorySupplierId === payFromFactorySupplierId) return false;
          if (payFromEmployeeId && entry.employeeId === payFromEmployeeId) return false;
          if (payFromCustomerId && entry.customerId === payFromCustomerId) return false;
          return true;
        })
        .map((entry: any) => {
          let accountType: "ledger" | "bank" | "supplier" | "employee" | "fixedAsset" | "customer" | "factorySupplier" =
            "ledger";
          let accountId = 0;
          let accountName = "";
          let amount = "0";

          if (entry.ledgerAccountId) {
            accountType = "ledger";
            accountId = entry.ledgerAccountId;
            const account = ledgerAccounts.find((l) => l.id === accountId);
            accountName = account?.name || "";
          } else if (entry.bankAccountId) {
            accountType = "bank";
            accountId = entry.bankAccountId;
            const account = bankAccounts.find((b) => b.id === accountId);
            accountName = account?.bankName || "";
          } else if (entry.supplierId) {
            accountType = "supplier";
            accountId = entry.supplierId;
            const supplier = suppliers.find((s) => s.id === accountId);
            accountName = supplier?.legalName || "";
          } else if (entry.factorySupplierId) {
            accountType = "factorySupplier";
            accountId = entry.factorySupplierId;
            const fs = factorySuppliersList.find((s) => s.id === accountId);
            accountName = fs?.name || "";
          } else if (entry.employeeId) {
            accountType = "employee";
            accountId = entry.employeeId;
            const employee = employees.find((e) => e.id === accountId);
            accountName = employee ? `${employee.firstName} ${employee.lastName}` : "";
          } else if (entry.fixedAssetId) {
            accountType = "fixedAsset";
            accountId = entry.fixedAssetId;
            const asset = fixedAssets.find((f) => f.id === accountId);
            accountName = asset?.name || "";
          } else if (entry.customerId) {
            accountType = "customer";
            accountId = entry.customerId;
            const customer = customers.find((c) => c.id === accountId);
            accountName = customer?.legalName || "";
          }

          const isLiabilityPayment =
            paymentEntry.supplierId ||
            paymentEntry.employeeId ||
            paymentEntry.customerId ||
            paymentEntry.factorySupplierId;
          if (voucherToEdit.voucherType === "Payment") {
            amount = isLiabilityPayment ? entry.creditAmount || "0" : entry.debitAmount || "0";
          } else if (voucherToEdit.voucherType === "Receipt") {
            amount = isLiabilityPayment ? entry.debitAmount || "0" : entry.creditAmount || "0";
          }

          return { accountType, accountId, accountName, amount };
        })
        .filter((entry: any) => parseFloat(entry.amount || "0") > 0);

      form.reset({
        paymentAccountType: paymentType as any,
        paymentAccountId: paymentId,
        paymentAccountName: paymentName,
        voucherDate: parseDateLocal(voucherToEdit.voucherDate),
        entries:
          formEntries.length > 0
            ? formEntries
            : [
                {
                  accountType: "ledger",
                  accountId: 0,
                  accountName: "",
                  amount: "",
                },
              ],
        notes: voucherToEdit.description || "",
        optional: voucherToEdit.optional || false,
      });

      hydratedVoucherIdRef.current = voucherToEdit.id;

      if (voucherToEdit.exchangeRate) {
        setTransactionRate(parseFloat(voucherToEdit.exchangeRate));
      }
      setVoucherEffectiveDate(voucherToEdit.effectiveDate || "");
    }
  }, [
    voucherToEdit,
    allAccounts,
    bankAccounts,
    ledgerAccounts,
    suppliers,
    employees,
    fixedAssets,
    customers,
    factorySuppliersList,
    form,
  ]);

  return { hydratedVoucherIdRef };
}
