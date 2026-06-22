import type { FactorySupplier } from "@shared/schema";

export interface CurrencyBalance {
  currencyCode: string;
  balance: number;
  fxRateToUsd?: number;
}

export interface CurrencyGroup {
  currencyCode: string;
  containers: StatementEntry[];
  totalKg: string;
  totalValue: string;
  totalCommission: string;
  remainingCommission: string;
  totalDirectCommission: string;
  netPayable: string;
  totalOwed: string;
  totalFreight?: string;
}

export interface SupplierWithBalance extends FactorySupplier {
  totalContainers: number;
  totalKg: string;
  totalValue: string;
  brokerPoolUsd?: string;
  pendingContainers: number;
  receivedContainers: number;
  lastContainerDate: string | null;
  currencyBalances?: CurrencyBalance[];
  totalCommissionUsd?: string;
  approxFxRate?: string | null;
  linkedSupplierExposure?: Array<{
    supplierId: number;
    supplierName: string;
    currencyBalances: CurrencyBalance[];
  }>;
  exposureCurrencyBalances?: CurrencyBalance[];
  otwByCurrency?: Record<string, number>;
}

export interface StatementEntry {
  id: number;
  containerNumber: string;
  date: string;
  origin: string | null;
  status: string;
  declaredKg: string | null;
  actualReceivedKg: string | null;
  totalKg: string | null;
  ratePerKg: string | null;
  differenceKg: string | null;
  value: string;
  finalPayableAmount: string | null;
  commissions: any[];
  totalCommission: string;
  notes: string | null;
}

export interface ObCommission {
  rawStockId: number;
  containerId: number;
  containerNumber: string;
  date: string;
  personName: string;
  amount: string;
  currencyCode: string;
  fxRateToUsd: string;
  amountUsd: string;
  ledgerAccountId: number | null;
}

export interface SupplierPayment {
  id: number;
  supplierId: number;
  date: string;
  amount: string;
  currencyCode: string;
  fxRateToUsd: string;
  amountUsd: string;
  paidFromAccountId: number | null;
  notes: string | null;
}

export interface FxTransfer {
  id: number;
  fromSupplierId: number;
  toSupplierId: number;
  fromSupplierName?: string;
  toSupplierName?: string;
  date: string;
  fromCurrencyCode: string;
  fromAmount: string;
  fxRateToUsd: string;
  toAmountUsd: string;
  notes: string | null;
  sourceType: string | null;
  containerRefs?: Array<{ containerNumber: string; allocatedAmount: string }>;
}

export interface StatementResponse {
  supplier: FactorySupplier;
  statement: StatementEntry[];
  currencyGroups: CurrencyGroup[];
  obCommissions: ObCommission[];
  payments: SupplierPayment[];
  fxTransfers: FxTransfer[];
  linkedSupplierGroups: Array<{
    supplierId: number;
    supplierName: string;
    containerCount: number;
    lastActivity: string | null;
    currencyGroups: Array<{
      currencyCode: string;
      containers: any[];
      totalValue: string;
      totalCommission: string;
      totalPaid: string;
      netPayable: string;
      containerCount: number;
    }>;
  }>;
  summary: {
    totalContainers: number;
    totalKg: string;
    totalValue: string;
    totalCommissions: string;
    totalDirectCommissions: string;
    totalObCommissions: string;
    totalPayments: string;
    netPayable: string;
    totalOwed: string;
  };
}
