import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BankAccount, LedgerAccount, Supplier, Customer, Employee, FixedAsset, FactorySupplierBasic, StockItem, Location } from "./voucherTypes";
import type { CombinedAccount } from "@/components/AccountAutocomplete";
import type { Account } from "@/components/AccountSidebar";

interface UseVoucherQueriesProps {
  selectedCompany: { id: number; companyType?: string } | null;
  isFactoryCompany: boolean;
  isPropertiesCompany: boolean;
  voucherIdToEdit: number | null;
  accountPickersNeeded: boolean;
  activeTab: string;
  isPOS: boolean;
  posLocationId?: number | null;
}

export function useVoucherQueries({
  selectedCompany,
  isFactoryCompany,
  isPropertiesCompany,
  voucherIdToEdit,
  accountPickersNeeded,
  activeTab,
  isPOS,
  posLocationId,
}: UseVoucherQueriesProps) {
  const [liveAccountSearch, setLiveAccountSearch] = useState("");
  const [debouncedAccountSearch, setDebouncedAccountSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAccountSearch(liveAccountSearch), 300);
    return () => clearTimeout(timer);
  }, [liveAccountSearch]);

  const needsStockData = isPOS || activeTab === "transfer" || activeTab === "transferorder" || activeTab === "adjustment";

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany && !isPropertiesCompany,
    staleTime: 5 * 60 * 1000,
  });

  const { data: factorySuppliersList = [] } = useQuery<FactorySupplierBasic[]>({
    queryKey: ["/api/factory/suppliers", selectedCompany?.id],
    enabled: isFactoryCompany,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", selectedCompany?.id],
    enabled: accountPickersNeeded && !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items", selectedCompany?.id],
    enabled: needsStockData,
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: needsStockData,
  });

  const posLocation = isPOS && posLocationId ? locations.find((l) => l.id === posLocationId) : null;
  const posLocationName = posLocation?.name || "";

  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
    enabled: isPOS,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees", selectedCompany?.id],
  });

  const { data: fixedAssets = [] } = useQuery<FixedAsset[]>({
    queryKey: ["/api/fixed-assets", selectedCompany?.id],
  });

  const { data: supplierSearchResults = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany && !isPropertiesCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(
        `/api/suppliers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to search suppliers");
      return res.json();
    },
  });

  const { data: customerSearchResults = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", "live-search", debouncedAccountSearch, selectedCompany?.id],
    enabled: debouncedAccountSearch.length >= 2 && !!selectedCompany,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const res = await fetch(
        `/api/customers?search=${encodeURIComponent(debouncedAccountSearch)}&limit=50`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to search customers");
      return res.json();
    },
  });

  const { data: sidebarAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/voucher-sidebar", selectedCompany?.id],
  });

  const { data: voucherToEdit, isLoading: loadingVoucher } = useQuery({
    queryKey: ["/api/vouchers", voucherIdToEdit],
    enabled: !!voucherIdToEdit,
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${voucherIdToEdit}`);
      if (!res.ok) throw new Error("Failed to fetch voucher");
      return res.json();
    },
  });

  const allAccounts = useMemo<CombinedAccount[]>(() => {
    const accounts = [
      ...ledgerAccounts.map((a) => ({ type: "ledger" as const, id: a.id, name: a.name, code: a.code })),
      ...bankAccounts.map((a) => ({ type: "bank" as const, id: a.id, name: a.bankName, code: a.accountNumber })),
      ...suppliers.map((s) => ({ type: "supplier" as const, id: s.id, name: s.legalName, code: s.code })),
      ...supplierSearchResults
        .filter((s) => !suppliers.find((p) => p.id === s.id))
        .map((s) => ({ type: "supplier" as const, id: s.id, name: s.legalName, code: s.code })),
      ...employees.map((e) => ({
        type: "employee" as const,
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        code: e.code,
        openingBalance: e.openingBalance,
      })),
      ...fixedAssets.map((f) => ({
        type: "fixedAsset" as const,
        id: f.id,
        name: f.name,
        code: f.code,
        openingBalance: f.openingBalance,
      })),
      ...customers.map((c: any) => ({
        type: "customer" as const,
        id: c.id,
        name: c.legalName,
        code: c.code,
        openingBalance: c.openingBalance,
      })),
      ...customerSearchResults
        .filter((c: any) => !customers.find((p: any) => p.id === c.id))
        .map((c: any) => ({
          type: "customer" as const,
          id: c.id,
          name: c.legalName,
          code: c.code,
          openingBalance: c.openingBalance,
        })),
      ...factorySuppliersList.map((s) => ({
        type: "factorySupplier" as const,
        id: s.id,
        name: s.name,
        code: String(s.id),
      })),
    ];
    return accounts.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [ledgerAccounts, bankAccounts, suppliers, supplierSearchResults, employees, fixedAssets, customers, customerSearchResults, factorySuppliersList]);

  return {
    bankAccounts, ledgerAccounts, suppliers, customers, employees, fixedAssets,
    factorySuppliersList, stockItems, locations, posLocation, posLocationName,
    myLocations, sidebarAccounts, voucherToEdit, loadingVoucher,
    supplierSearchResults, customerSearchResults, allAccounts, needsStockData,
    liveAccountSearch, setLiveAccountSearch,
  };
}
