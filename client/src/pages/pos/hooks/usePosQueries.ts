import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { APIInventoryItem, Location } from "../pos-components/posTypes";
import { buildPosInventory, type SpMovement } from "./posInventory";

interface PosQueriesParams {
  posUser: any;
  activeLocation: Location | null;
  isCreditSale: boolean;
  editVoucherId?: string;
  showPrintDialog: boolean;
  showStockPrompt: boolean;
  /** Supplier Partner companies source their sellable stock from sp_stock_movements, not the normal inventory table. */
  isSpCompany?: boolean;
}

export function usePosQueries({
  posUser,
  activeLocation,
  isCreditSale,
  editVoucherId,
  showPrintDialog,
  showStockPrompt,
  isSpCompany,
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
    // Supplier Partner offloads and migration keep the normal location inventory
    // synchronized with sp_stock_movements. Fetching it here gives the shared POS
    // the authoritative per-location item IDs, names and quantities instead of
    // silently hiding stock when an older SP movement has a missing/stale location.
    enabled: !!activeLocation,
  });

  // Supplier Partner companies still need the SP lots for final-cost/FIFO data.
  // Scope the cache by location so switching locations (or companies, whose
  // location IDs are globally unique) cannot reuse a stale empty stock response.
  const {
    data: spStock = [],
    isLoading: spStockLoading,
    error: spStockError,
  } = useQuery<SpMovement[]>({
    queryKey: activeLocation ? ["/api/sp/stock", activeLocation.id] : [],
    queryFn: async () => {
      const res = await fetch("/api/sp/stock", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to load Supplier Partner stock");
      }
      return res.json();
    },
    enabled: !!isSpCompany && !!activeLocation,
  });

  const inventory = useMemo(
    () => buildPosInventory(apiInventory, spStock, !!isSpCompany, activeLocation ? Number(activeLocation.id) : null),
    [apiInventory, spStock, isSpCompany, activeLocation]
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
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc) => acc.accountType === "Cash"),
    [allLedgerAccounts]
  );
  const customerAccounts = useMemo(
    () => (Array.isArray(allLedgerAccounts) ? allLedgerAccounts : []).filter((acc) => acc.accountType === "Asset"),
    [allLedgerAccounts]
  );

  const { data: drafts = [], refetch: refetchDrafts } = useQuery<any[]>({
    queryKey: activeLocation ? [`/api/pos/drafts?locationId=${activeLocation.id}`] : [],
    enabled: !!activeLocation,
  });

  const { data: currentShift } = useQuery<any>({
    queryKey: posUser && activeLocation ? ["/api/pos/shifts/current", { locationId: activeLocation.id }] : [],
    queryFn: async () => {
      if (!activeLocation) return null;
      const res = await fetch(`/api/pos/shifts/current?locationId=${activeLocation.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!posUser && !!activeLocation,
    refetchInterval: 60_000,
  });

  const { data: authUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });

  const { data: lastSoldPrices = {} } = useQuery<Record<number, string>>({
    queryKey: activeLocation ? ["/api/pos/last-sold-prices", { locationId: activeLocation.id }] : [],
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
    enabled: isCreditSale && authUser?.canAccessCustomers === true,
  });

  const { data: editVoucher, isLoading: editVoucherLoading } = useQuery<any>({
    queryKey: editVoucherId ? [`/api/vouchers/${editVoucherId}`] : [],
    enabled: !!editVoucherId,
  });

  // Fallback: if the voucher loaded but has no salesItems (e.g. items were stored separately),
  // fetch from view-entries which always includes stock items for Sales type.
  const editVoucherHasSalesItems =
    editVoucher && Array.isArray(editVoucher.salesItems) && editVoucher.salesItems.length > 0;
  const { data: editVoucherViewEntries = [] } = useQuery<any[]>({
    queryKey:
      editVoucherId && editVoucher && !editVoucherHasSalesItems ? [`/api/vouchers/${editVoucherId}/view-entries`] : [],
    enabled: !!editVoucherId && !!editVoucher && !editVoucherHasSalesItems,
    staleTime: 60_000,
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
    inventoryLoading: isSpCompany ? inventoryLoading || spStockLoading : inventoryLoading,
    inventoryError: isSpCompany ? inventoryError || spStockError : inventoryError,
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
    editVoucherViewEntries,
    stockInventory,
    stockInventoryLoading,
  };
}
