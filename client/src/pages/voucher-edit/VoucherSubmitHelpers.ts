import { format } from "date-fns";
import {
  VoucherFormData,
  JournalFormData,
  PurchaseFormData,
  SalesFormData,
  AdjustmentFormData,
  TransferFormData,
} from "./VoucherEditSchemas";

export const convertAmountToUSD = (amount: string, currency: string, exchangeRate: number | undefined): string => {
  if (currency === "CFA" && exchangeRate) {
    const cfaAmount = parseFloat(amount || "0");
    return (cfaAmount / exchangeRate).toFixed(2);
  }
  return amount;
};

export const preparePaymentReceiptData = (
  data: VoucherFormData,
  voucherType: string,
  exchangeRate: number | undefined
) => {
  const voucherUpdates = {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    voucherType: voucherType,
    description: data.notes,
    currency: "USD",
  };

  const total = data.entries
    .reduce((sum, e) => {
      const amt = parseFloat(e.amount || "0");
      const usdAmt = data.currency === "CFA" && exchangeRate ? amt / exchangeRate : amt;
      return sum + usdAmt;
    }, 0)
    .toFixed(2);

  const isLiabilityPayment =
    data.paymentAccountType === "supplier" ||
    data.paymentAccountType === "factorySupplier" ||
    data.paymentAccountType === "employee";

  const paymentEntry = {
    ledgerAccountId: data.paymentAccountType === "ledger" ? data.paymentAccountId : null,
    bankAccountId: data.paymentAccountType === "bank" ? data.paymentAccountId : null,
    supplierId: data.paymentAccountType === "supplier" ? data.paymentAccountId : null,
    factorySupplierId: data.paymentAccountType === "factorySupplier" ? data.paymentAccountId : null,
    employeeId: data.paymentAccountType === "employee" ? data.paymentAccountId : null,
    debitAmount:
      (voucherType === "Receipt" && !isLiabilityPayment) || (voucherType === "Payment" && isLiabilityPayment)
        ? total
        : "0",
    creditAmount:
      (voucherType === "Payment" && !isLiabilityPayment) || (voucherType === "Receipt" && isLiabilityPayment)
        ? total
        : "0",
  };

  const contraEntries = data.entries.map((entry) => {
    const usdAmount = convertAmountToUSD(entry.amount, data.currency, exchangeRate);
    return {
      ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
      bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
      supplierId: entry.accountType === "supplier" ? entry.accountId : null,
      factorySupplierId: entry.accountType === "factorySupplier" ? entry.accountId : null,
      employeeId: entry.accountType === "employee" ? entry.accountId : null,
      debitAmount:
        (voucherType === "Payment" && !isLiabilityPayment) || (voucherType === "Receipt" && isLiabilityPayment)
          ? usdAmount
          : "0",
      creditAmount:
        (voucherType === "Receipt" && !isLiabilityPayment) || (voucherType === "Payment" && isLiabilityPayment)
          ? usdAmount
          : "0",
    };
  });

  return { voucherUpdates, entries: [paymentEntry, ...contraEntries] };
};

export const prepareJournalData = (data: JournalFormData, exchangeRate: number | undefined) => {
  const voucherUpdates = {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    voucherType: "Journal",
    description: data.notes,
    currency: "USD",
  };

  const entries = data.entries.map((entry) => {
    const usdAmount = convertAmountToUSD(entry.amount, data.currency, exchangeRate);
    return {
      ledgerAccountId: entry.accountType === "ledger" ? entry.accountId : null,
      bankAccountId: entry.accountType === "bank" ? entry.accountId : null,
      supplierId: entry.accountType === "supplier" ? entry.accountId : null,
      factorySupplierId: entry.accountType === "factorySupplier" ? entry.accountId : null,
      debitAmount: entry.type === "DR" ? usdAmount : "0",
      creditAmount: entry.type === "CR" ? usdAmount : "0",
    };
  });

  return { voucherUpdates, entries };
};

export const prepareSalesData = (data: SalesFormData) => {
  return {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    description: data.notes,
    currency: data.currency,
    items: data.items.map((item) => ({
      id: item.id,
      stockItemId: item.stockItemId,
      quantity: item.quantity,
      sellingPrice: item.sellingPrice,
    })),
  };
};

export const preparePurchaseData = (data: PurchaseFormData) => {
  return {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    description: data.notes,
    currency: data.currency,
    items: data.items.map((item) => ({
      id: item.id,
      stockItemId: item.stockItemId,
      itemName: item.stockItemName,
      quantity: item.quantity,
      rate: item.rate,
    })),
  };
};

export const prepareAdjustmentData = (data: AdjustmentFormData) => {
  return {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    description: data.notes,
    currency: data.currency,
    locationId: data.locationId,
    items: data.items.map((item) => ({
      id: item.id,
      stockItemId: item.stockItemId,
      quantity: item.quantity,
      rate: item.rate,
    })),
  };
};

export const prepareTransferData = (data: TransferFormData) => {
  return {
    voucherDate: format(data.voucherDate, "yyyy-MM-dd"),
    description: data.notes,
    sourceLocationId: data.sourceLocationId,
    destinationLocationId: data.destinationLocationId,
    items: data.items.map((item) => ({
      id: item.id,
      stockItemId: item.stockItemId,
      quantity: item.quantity,
      rate: item.rate,
    })),
  };
};
