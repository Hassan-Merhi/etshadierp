import { useQuery } from "@tanstack/react-query";
import { VoucherData, BankAccount, LedgerAccount, Supplier, StockItem, Location } from "./VoucherEditHelpers";
import { AccountWithBalance } from "./VoucherAccountHelpers";

interface UseVoucherEditQueriesOptions {
  id: string | undefined;
  selectedCompanyId: number | undefined;
}

export function useVoucherEditQueries({ id, selectedCompanyId }: UseVoucherEditQueriesOptions) {
  const {
    data: voucher,
    isLoading: voucherLoading,
    error: voucherError,
  } = useQuery<VoucherData>({
    queryKey: [`/api/vouchers/${id}`],
    enabled: !!id,
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  // Voucher edit forms only require the lightweight identity fields exposed by
  // /api/stock-items/light. Reuse the same cache key as voucher creation screens
  // so opening edit/create flows does not download the ~634 KB full list twice.
  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items/light", selectedCompanyId],
    enabled: !!selectedCompanyId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: allAccountsData = [] } = useQuery<AccountWithBalance[]>({
    queryKey: ["/api/accounts/all", selectedCompanyId],
    enabled: !!selectedCompanyId,
  });

  return {
    voucher,
    voucherLoading,
    voucherError,
    bankAccounts,
    ledgerAccounts,
    suppliers,
    stockItems,
    locations,
    allAccountsData,
  };
}
