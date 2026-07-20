import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { APIInventoryItem, Location } from "../pos-components/posTypes";

interface SpMovement {
  id: number;
  articleCode: string;
  description: string | null;
  stockItemId: number | null;
  locationId: number | null;
  qtyRemaining: string;
  finalUnitCostUsd: string;
}

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
    enabled: !!activeLocation && !isSpCompany,
  });

  // Supplier Partner companies sell from sp_stock_movements (FIFO lots), not the
  // normal inventory table. Group remaining qty by articleCode, same as the
  // former standalone SpPOS component, so the shared grid/picker gets the same
  // { code, name, stock, price, configuredPrice, stockItemId } shape.
  const { data: spStock = [], isLoading: spStockLoading } = useQuery<SpMovement[]>({
    queryKey: ["/api/sp/stock"],
    enabled: !!isSpCompany && !!activeLocation,
  });

  const inventory = useMemo(() => {
    if (isSpCompany) {
      const atLocation = (Array.isArray(spStock) ? spStock : []).filter(
        (m) => !activeLocation || m.locationId === activeLocation.id
      );
      // Key by stockItemId (the real item identity), not articleCode — two
      // distinct stock items could share a display code, and merging them
      // under one row would submit only one stockItemId at checkout.
      const map = new Map<number, { code: string; name: string; stock: number; price: number; configuredPrice: number; stockItemId: number }>();
      for (const m of atLocation) {
        const qty = parseFloat(m.qtyRemaining) || 0;
        if (qty <= 0 || m.stockItemId == null) continue;
        const key = m.stockItemId;
        const existing = map.get(key);
        if (existing) {
          existing.stock += qty;
        } else {
          const price = parseFloat(m.finalUnitCostUsd) || 0;
          map.set(key, {
            code: m.articleCode,
            name: m.description || m.articleCode,
            stock: qty,
            price,
            configuredPrice: price,
            stockItemId: m.stockItemId,
          });
        }
      }
      return Array.from(map.values());
    }
    return (Array.isArray(apiInventory) ? apiInventory : []).map((item) => ({
      code: (item.stockItemCode || "").trim(),
      name: (item.stockItemName || "Unknown Item").trim(),
      stock: parseFloat(item.quantity),
      price: parseFloat(item.lastSellingPrice || item.averageRate),
      configuredPrice: parseFloat(item.lastSellingPrice || "0"),
      stockItemId: item.stockItemId,
    }));
  }, [apiInventory, spStock, isSpCompany, activeLocation]);

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

  // Fallback: if the voucher loaded but has no salesItems (e.g. items were stored separately),
  // fetch from view-entries which always includes stock items for Sales type.
  const editVoucherHasSalesItems =
    editVoucher && Array.isArray(editVoucher.salesItems) && editVoucher.salesItems.length > 0;
  const { data: editVoucherViewEntries = [] } = useQuery<any[]>({
    queryKey:
      editVoucherId && editVoucher && !editVoucherHasSalesItems
        ? [`/api/vouchers/${editVoucherId}/view-entries`]
        : [],
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
    editVoucherViewEntries,
    stockInventory,
    stockInventoryLoading,
  };
}
