/**
 * Controller hook for the All Daybook (TransactionJournal) page.
 *
 * Owns the filter state, the cross-company transactions query and its
 * pagination, the per-row hide toggles, the hide-amounts preference, the
 * voucher detail queries, the per-entry balance fetch and the company switch
 * used by "open in Daybook". Views read this model and render only.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format, addDays } from "date-fns";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PeriodFilterValue } from "@/components/ui/period-filter";
import { usePaginatedFilterState } from "@/hooks/use-paginated-filter-state";
import { createTransactionJournalFilters, type TransactionJournalFilters } from "./filterState";
import type { CompanyOption, JournalResponse, VoucherDetail } from "./types";

export const JOURNAL_PAGE_LIMIT = 50;

export interface CompanySummary {
  name: string;
  count: number;
  usdDr: number;
  usdCr: number;
  cfaDr: number;
  cfaCr: number;
}

export function useTransactionJournalModel() {
  const [, setLocation] = useLocation();
  const { selectCompany, companies: contextCompanies } = useCompany();
  const { toast } = useToast();
  const { formatCashAmount } = useCurrencyContext();

  // ── Filter state ──
  const { filters: journalFilters, page, setPage, setFilter, resetFilters, hasActiveFilters } =
    usePaginatedFilterState<TransactionJournalFilters>({
      createInitialFilters: createTransactionJournalFilters,
      storageKey: "erp-transaction-journal-filters-v1",
    });
  const { periodFilter, selectedCos, voucherType, currency, optionalFilter, includeFactory, searchInput, search } = journalFilters;
  const setPeriodFilter = (value: PeriodFilterValue | ((current: PeriodFilterValue) => PeriodFilterValue)) => setFilter("periodFilter", value);
  const setSelectedCos = (value: number[] | ((current: number[]) => number[])) => setFilter("selectedCos", value);
  const setVoucherType = (value: string) => setFilter("voucherType", value);
  const setCurrency = (value: string) => setFilter("currency", value);
  const setOptionalFilter = (value: string) => setFilter("optionalFilter", value);
  const setIncludeFactory = (value: boolean | ((current: boolean) => boolean)) => setFilter("includeFactory", value);
  const setSearchInput = (value: string) => setFilter("searchInput", value);
  const setSearch = (value: string) => setFilter("search", value);
  const LIMIT = JOURNAL_PAGE_LIMIT;

  // ── Hide amounts toggle (local + user preference) ──
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const prefHidden = (myErpPages?.hiddenErpCostFields ?? []).includes("daybook_amounts");
  const [hideAmountsLocal, setHideAmountsLocal] = useState<boolean | null>(null);
  const hideAmounts = hideAmountsLocal !== null ? hideAmountsLocal : prefHidden;
  const toggleHideAmounts = () => setHideAmountsLocal((v) => !(v !== null ? v : prefHidden));

  // ── Hidden rows (per-row EyeOff, local state) ──
  const [hiddenRowIds, setHiddenRowIds] = useState<Set<number>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const toggleHideRow = (id: number) => {
    setHiddenRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearHiddenRows = () => {
    setHiddenRowIds(new Set());
    setShowHidden(false);
  };

  // ── Detail dialog ──
  const [detailId, setDetailId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [entryBalances, setEntryBalances] = useState<Record<number, string>>({});

  // ── Build query string (memoized to avoid spurious refetches) ──
  const queryParamsStr = useMemo(() => {
    const p = new URLSearchParams({
      ...(periodFilter.fromDate ? { startDate: periodFilter.fromDate } : {}),
      ...(periodFilter.toDate ? { endDate: periodFilter.toDate } : {}),
      voucherType,
      currency,
      optional: optionalFilter,
      includeFactory: String(includeFactory),
      page: String(page),
      limit: String(LIMIT),
      ...(search ? { search } : {}),
      ...(selectedCos.length ? { companyIds: selectedCos.join(",") } : {}),
    });
    return p.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- God Files extraction preserves pre-split behavior.
  }, [periodFilter, voucherType, currency, optionalFilter, includeFactory, page, search, selectedCos]);

  const { data, isLoading, isFetching, refetch } = useQuery<JournalResponse>({
    queryKey: ["/api/global/transactions", queryParamsStr],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions?${queryParamsStr}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transactions");
      return res.json();
    },
    // Keep old data visible while a background refresh or filter change is in flight —
    // this prevents the table from blanking out between fetches.
    placeholderData: (prev) => prev,
    // Silent background refresh every 30 seconds, just like Daybook.
    refetchInterval: 30_000,
  });

  const { data: voucherTypes } = useQuery<string[]>({
    queryKey: ["/api/global/transactions/voucher-types"],
  });

  const { data: detailData, isLoading: detailLoading } = useQuery<VoucherDetail>({
    queryKey: ["/api/global/transactions", detailId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions/${detailId}/detail`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!detailId,
  });

  const { data: viewEntriesRaw, isLoading: viewEntriesLoading } = useQuery<any>({
    queryKey: ["/api/global/transactions", detailId, "view-entries"],
    queryFn: async () => {
      const res = await fetch(`/api/global/transactions/${detailId}/view-entries`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!detailId && drawerOpen,
  });

  // Normalise view-entries response (may be array or { entries, purchaseOrder, items })
  const viewEntries: any[] = Array.isArray(viewEntriesRaw) ? viewEntriesRaw : (viewEntriesRaw?.entries ?? []);
  const viewPurchaseOrder: any | null = viewEntriesRaw?.purchaseOrder ?? null;
  const viewPurchaseItems: any[] = viewEntriesRaw?.items ?? [];

  const openDetail = (id: number) => {
    setEntryBalances({});
    setDetailId(id);
    setDrawerOpen(true);
  };

  // Fetch per-entry account balances for ledger entries when detail opens
  useEffect(() => {
    if (!drawerOpen || !detailData) return;
    const entries = detailData.entries.filter((e) => e.ledgerAccountId || e.customerId);
    if (entries.length === 0) return;
    let cancelled = false;
    (async () => {
      const results: Record<number, string> = {};
      await Promise.all(
        entries.map(async (e) => {
          try {
            let url: string | null = null;
            if (e.ledgerAccountId) {
              url = `/api/accounts/ledger/${e.ledgerAccountId}/balance`;
            } else if (e.customerId) {
              url = `/api/customers/${e.customerId}/balance`;
            }
            if (!url) return;
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) return;
            const data = await res.json();
            if (!cancelled) results[e.id] = data.balance?.toString() ?? "0";
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setEntryBalances(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, detailData]);

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- God Files extraction preserves pre-split behavior.
  }, [searchInput]);

  const clearSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  // ── Switch company and navigate ──
  const openInCompany = async (companyId: number, path: string) => {
    const company = contextCompanies.find((c) => c.id === companyId);
    if (company) {
      selectCompany(company);
      await new Promise((r) => setTimeout(r, 300));
    } else {
      try {
        await apiRequest("POST", "/api/auth/set-company", { companyId });
      } catch {
        toast({ title: "Could not switch company", variant: "destructive" });
        return;
      }
    }
    setDrawerOpen(false);
    setLocation(path);
  };

  const availableCompanies: CompanyOption[] = data?.companies || [];

  // ── Visible vouchers (filter hidden unless showHidden) ──
  const allVouchers = data?.vouchers || [];
  const visibleVouchers = showHidden ? allVouchers : allVouchers.filter((v) => !hiddenRowIds.has(v.id));

  // ── Keyboard date navigation: "-" = back 1 day, "Shift+=" = forward 1 day ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "textarea") return;
      if (tag === "input") {
        const inputType = (target as HTMLInputElement).type || "text";
        if (["text", "number", "email", "password", "search", "tel", "url"].includes(inputType)) return;
      }
      if (tag === "select") return;

      const dateFmt = "yyyy-MM-dd";
      if (hasAnyOpenDialog()) return;

      const isBack = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";

      if (isBack) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: prev.fromDate ? format(addDays(new Date(prev.fromDate), -1), dateFmt) : prev.fromDate,
          toDate: prev.toDate ? format(addDays(new Date(prev.toDate), -1), dateFmt) : prev.toDate,
          preset: "custom",
        }));
        setPage(1);
      } else if (isForward) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: prev.fromDate ? format(addDays(new Date(prev.fromDate), 1), dateFmt) : prev.fromDate,
          toDate: prev.toDate ? format(addDays(new Date(prev.toDate), 1), dateFmt) : prev.toDate,
          preset: "custom",
        }));
        setPage(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- God Files extraction preserves pre-split behavior.
  }, []);

  // ── Summary aggregation ──
  const summaryByCompany = (data?.summary || []).reduce<Record<number, CompanySummary>>((acc, row) => {
    if (!acc[row.companyId]) {
      acc[row.companyId] = { name: row.companyName, count: 0, usdDr: 0, usdCr: 0, cfaDr: 0, cfaCr: 0 };
    }
    const entry = acc[row.companyId];
    entry.count += Number(row.voucherCount);
    if (row.currency === "USD") {
      entry.usdDr += parseFloat(row.totalDebits || "0");
      entry.usdCr += parseFloat(row.totalCredits || "0");
    } else {
      entry.cfaDr += parseFloat(row.totalDebits || "0");
      entry.cfaCr += parseFloat(row.totalCredits || "0");
    }
    return acc;
  }, {});

  const totalVouchers = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;

  const toggleCompanySelection = (companyId: number) =>
    setSelectedCos((prev) => (prev.includes(companyId) ? prev.filter((x) => x !== companyId) : [...prev, companyId]));

  /** Filter setters that also reset pagination, as the inline handlers did. */
  const applyPeriodFilter = (value: PeriodFilterValue) => {
    setPeriodFilter(value);
    setPage(1);
  };
  const applyVoucherType = (value: string) => {
    setVoucherType(value);
    setPage(1);
  };
  const applyCurrency = (value: string) => {
    setCurrency(value);
    setPage(1);
  };
  const applyOptionalFilter = (value: string) => {
    setOptionalFilter(value);
    setPage(1);
  };
  const toggleIncludeFactory = () => {
    setIncludeFactory((v) => !v);
    setPage(1);
  };

  return {
    // formatting
    formatCashAmount,
    // filters
    journalFilters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    periodFilter,
    applyPeriodFilter,
    selectedCos,
    setSelectedCos,
    toggleCompanySelection,
    availableCompanies,
    voucherType,
    setVoucherType,
    applyVoucherType,
    currency,
    applyCurrency,
    optionalFilter,
    applyOptionalFilter,
    includeFactory,
    toggleIncludeFactory,
    searchInput,
    setSearchInput,
    search,
    handleSearch,
    clearSearch,
    voucherTypes,
    // data + paging
    isLoading,
    isFetching,
    refetch,
    allVouchers,
    visibleVouchers,
    summaryByCompany,
    totalVouchers,
    totalPages,
    page,
    setPage,
    limit: LIMIT,
    // row visibility
    hideAmounts,
    toggleHideAmounts,
    hiddenRowIds,
    toggleHideRow,
    clearHiddenRows,
    showHidden,
    setShowHidden,
    // detail dialog
    drawerOpen,
    setDrawerOpen,
    openDetail,
    detailData,
    detailLoading,
    viewEntries,
    viewEntriesLoading,
    viewPurchaseOrder,
    viewPurchaseItems,
    entryBalances,
    openInCompany,
  };
}

export type TransactionJournalModel = ReturnType<typeof useTransactionJournalModel>;
