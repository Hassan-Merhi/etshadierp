import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { APIInventoryItem, Location } from "../pos-components/posTypes";

interface PosQueriesParams {
  posUser: any;
  activeLocation: Location | null;
  isCreditSale: boolean;
  editVoucherId?: string;
  showPrintDialog: boolean;
  showStockPrompt: boolean;
}

export function usePosQueries({
  posUser,
  activeLocation,
  isCreditSale,
  editVoucherId,
  showPrintDialog,
  showStockPrompt,
}: PosQueriesParams) {
  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const { data: allLocations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
  });

  const { data: companySettings } = useQuery<any>({
    queryKey: ["/api/company-settings"],
    enabled: !!posUser,
  });

  const {
    data: apiInventory = [],
    isLoading: inventoryLoading,
    error: inventoryError,
  } = useQuery<APIInventoryItem[]>({
    queryKey: activeLocation ? [`/api/locations/${activeLocation.id}/inventory`] : [],
    enabled: !!activeLocation,
  });

  const inventory = useMemo(
    () =>
      (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
        code: (item.stockItemCode || "").trim(),
        name: (item.stockItemName || "Unknown Item").trim(),
        stock: parseFloat(item.quantity),
        price: parseFloat(item.lastSellingPrice || item.averageRate),
        configuredPrice: parseFloat(item.lastSellingPrice || "0"),
        stockItemId: item.stockItemId,
      })),
    [apiInventory]
  );

  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!activeLocation,
  });

  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: !!activeLocation,
  });

  const cashLedgerAccounts = useMemo(
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Cash"),
    [allLedgerAccounts]
  );
  const customerAccounts = useMemo(
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc: any) => acc.accountType === "Asset"),
    [allLedgerAccounts]
  );

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts?locationId=${activeLocation.id}`] : [],
    enabled: !!activeLocation,
  });

  const { data: currentShift } = useQuery<any>({
    queryKey: posUser && activeLocation ? ["/api/pos/shifts/current", { locationId: activeLocation.id }] : [],
    enabled: !!posUser && !!activeLocation,
    refetchInterval: 60_000,
  });

  const { data: authUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const { data: lastSoldPrices = {} } = useQuery<Record<number, string>>({
    queryKey: activeLocation ? [`/api/pos/last-sold-prices`, { locationId: activeLocation.id }] : [],
    queryFn: async () => {
      if (!activeLocation) return {};
      const res = await fetch(`/api/pos/last-sold-prices?locationId=${activeLocation.id}`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!activeLocation,
    staleTime: 60_000,
  });

  const { data: posCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/customers"],
    enabled: isCreditSale,
  });

  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  // Stock inventory — prefetch when invoice or stock dialog is open
  const printLocationId = activeLocation?.id ?? (editVoucher as any)?.locationId ?? null;
  const { data: stockInventory = [], isLoading: stockInventoryLoading } = useQuery<any[]>({
    queryKey: printLocationId ? [`/api/locations/${printLocationId}/inventory`] : [],
    enabled: (showPrintDialog || showStockPrompt) && !!printLocationId,
  });

  return {
    posAssignedLocations,
    posLocationsLoading,
    allLocations,
    companySettings,
    apiInventory,
    inventoryLoading,
    inventoryError,
    inventory,
    bankAccounts,
    allLedgerAccounts,
    cashLedgerAccounts,
    customerAccounts,
    drafts,
    refetchDrafts,
    currentShift,
    authUser,
    lastSoldPrices,
    posCustomers,
    editVoucher,
    editVoucherLoading,
    stockInventory,
    stockInventoryLoading,
  };
}
