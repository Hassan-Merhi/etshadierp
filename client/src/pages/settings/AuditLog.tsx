import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Search, RefreshCw, ChevronLeft, ChevronRight, X, ExternalLink, Building2, CalendarDays } from "lucide-react";
import {
  fmtDate,
  tableShortName,
  actionLabel,
  actionBadgeVariant,
  getRecordLabel,
  getDetailsSentence,
} from "./AuditLogUtils";
import { AuditLogDialog } from "./AuditLogDialog";

export { fmtDate, tableShortName, getRecordLabel, getDetailsSentence };

// ── Action filter options shown in the dropdown ───────────────────────────────

const ACTION_FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: "All Activity", value: "all" },
  { label: "Created", value: "create" },
  { label: "Edited", value: "update" },
  { label: "Deleted", value: "delete" },
  { label: "Restored", value: "restore" },
  { label: "Reversed / Voided", value: "reverse,void" },
  { label: "Recalculated / Repaired", value: "recalculate,repair" },
  { label: "Imports", value: "import" },
  { label: "Exports", value: "export" },
  { label: "Sent to WhatsApp / Email", value: "send_whatsapp,send_email" },
  { label: "Approvals / Cancellations", value: "approve,cancel" },
  { label: "Transfers / Adjustments", value: "transfer,adjust,offload" },
  { label: "Settings / Permissions", value: "settings_change,permission_change" },
  { label: "Updates & Deletes", value: "update,delete" },
];

// ── Grouping helpers ──────────────────────────────────────────────────────────

type CompanyGroup = {
  companyId: number | null;
  companyName: string;
  companyCode: string | null;
  logs: any[];
};

type DayGroup = {
  dateKey: string;   // "2026-07-20" — used as React key
  dateLabel: string; // "Sunday, July 20, 2026"
  companies: CompanyGroup[];
};

function groupLogsByDayAndCompany(logs: any[]): DayGroup[] {
  // Build an ordered map: dateKey → (companyKey → CompanyGroup)
  // Ordered maps preserve insertion order which follows the DESC sort from the API.
  const dayMap = new Map<string, Map<string, CompanyGroup>>();

  for (const log of logs) {
    // Extract local calendar date from the ISO timestamp so "Jul 20 02:16" and
    // "Jul 20 04:07" both land in the same Jul 20 bucket regardless of timezone.
    const d = new Date(log.createdAt);
    const dateKey = d.toLocaleDateString("en-CA"); // "2026-07-20" (ISO-format locale)

    if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map());
    const companyMap = dayMap.get(dateKey)!;

    const companyKey = log.companyId != null ? String(log.companyId) : "none";
    if (!companyMap.has(companyKey)) {
      companyMap.set(companyKey, {
        companyId: log.companyId ?? null,
        companyName: log.companyName || (log.companyId ? `Company #${log.companyId}` : "Unknown Company"),
        companyCode: log.companyCode || null,
        logs: [],
      });
    }
    companyMap.get(companyKey)!.logs.push(log);
  }

  return [...dayMap.entries()].map(([dateKey, companyMap]) => {
    // Build a human-readable date label from the date key itself (avoids timezone shift).
    const [year, month, day] = dateKey.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    const dateLabel = d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return {
      dateKey,
      dateLabel,
      companies: [...companyMap.values()],
    };
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface AuditLogProps {
  /** Initial action filter value. "all" = no action restriction. Default: "update,delete" */
  defaultActions?: string;
  /** "settings" = original compact view; "daybook" = full activity view. Default: "settings" */
  context?: "settings" | "daybook";
  /** Whether to show the Card heading. Default: false */
  showHeading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditLog({ defaultActions = "update,delete", context = "settings", showHeading = false }: AuditLogProps = {}) {
  const { toast } = useToast();

  const [filterAction, setFilterAction] = useState(defaultActions);
  const [filterModule, setFilterModule] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input ~350 ms so every keystroke doesn't fire a request.
  const handleSearchChange = useCallback((value: string) => {
    setFilterSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Reset to page 1 whenever any filter changes.
  useEffect(() => {
    setPage(1);
  }, [filterAction, filterModule, debouncedSearch, filterDateFrom, filterDateTo]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [
      "/api/audit-log",
      {
        action: filterAction === "all" ? "" : filterAction,
        module: filterModule,
        search: debouncedSearch,
        from: filterDateFrom,
        to: filterDateTo,
        page,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        action: filterAction === "all" ? "all" : filterAction,
        module: filterModule,
        search: debouncedSearch,
        from: filterDateFrom,
        to: filterDateTo,
        page: page.toString(),
        limit: "50",
      });
      const res = await apiRequest("GET", `/api/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
  });

  const auditLogs: any[] = data?.logs || [];
  const totalPages = data?.totalPages || 1;
  const total = data?.total ?? null;
  const knownModules = data?.knownModules || [];

  // Whether this page contains entries from more than one company.
  // When true, company sub-headers are shown inside each day group.
  const hasMultipleCompanies = useMemo(() => {
    const ids = new Set(auditLogs.map((l: any) => l.companyId));
    return ids.size > 1;
  }, [auditLogs]);

  // Grouped view — always used; gives us date separators even for single-company.
  const groupedDays = useMemo(() => groupLogsByDayAndCompany(auditLogs), [auditLogs]);

  const isDirty =
    filterAction !== defaultActions ||
    filterModule !== "" ||
    filterSearch !== "" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  const handleReset = () => {
    setFilterAction(defaultActions);
    setFilterModule("");
    setFilterSearch("");
    setDebouncedSearch("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search user, module, action, record…"
            value={filterSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>

        {/* Action filter */}
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Module filter */}
        <Select value={filterModule || "all"} onValueChange={(v) => setFilterModule(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {knownModules.map((m: string) => (
              <SelectItem key={m} value={m}>
                {tableShortName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range */}
        <Input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          className="h-8 w-36 text-sm"
          title="From date"
        />
        <Input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          className="h-8 w-36 text-sm"
          title="To date"
        />

        {/* Reset */}
        {isDirty && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={handleReset}
          >
            <X className="h-3 w-3 mr-1" /> Reset
          </Button>
        )}

        {/* Refresh */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetch()}
          disabled={isFetching}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Record count */}
      {total !== null && !isLoading && (
        <p className="text-xs text-muted-foreground">
          {total === 0 ? "No results" : `${total.toLocaleString()} record${total !== 1 ? "s" : ""}`}
          {totalPages > 1 ? ` — page ${page} of ${totalPages}` : ""}
        </p>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        (() => {
          const isPermissionError =
            (error as any)?.status === 403 ||
            String((error as any)?.message || "").toLowerCase().includes("access denied") ||
            String((error as any)?.message || "").toLowerCase().includes("permission") ||
            String((error as any)?.message || "").includes("403");
          return isPermissionError ? (
            <div className="flex flex-col items-center gap-3 p-8 text-muted-foreground border rounded-md bg-muted/20">
              <p className="text-sm font-medium">You do not have permission to view activity history.</p>
              <p className="text-xs">Contact your administrator to request access.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 p-6 text-destructive bg-destructive/10 rounded-md">
              <p className="text-sm font-medium">Error loading activity log.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          );
        })()
      ) : auditLogs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-md bg-muted/20">
          <p className="text-sm font-medium">No activity found</p>
          <p className="text-xs mt-1">Try adjusting the filters or date range.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px] whitespace-nowrap">Date & Time</TableHead>
                <TableHead className="w-[130px]">User</TableHead>
                <TableHead className="w-[110px]">Action</TableHead>
                <TableHead className="w-[140px]">Module</TableHead>
                <TableHead className="w-[160px]">Record</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedDays.map(({ dateKey, dateLabel, companies }) => (
                <Fragment key={`day-${dateKey}`}>
                  {/* ── Day separator ─────────────────────────────────────── */}
                  <TableRow
                    className="bg-muted/60 hover:bg-muted/60 pointer-events-none select-none"
                  >
                    <TableCell
                      colSpan={6}
                      className="py-2 px-4 font-semibold text-sm text-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {dateLabel}
                      </span>
                    </TableCell>
                  </TableRow>

                  {companies.map(({ companyId, companyName, companyCode, logs }) => (
                    <Fragment key={`cg-${dateKey}-${companyId}`}>
                      {/* ── Company sub-header (only when mixed companies) ── */}
                      {hasMultipleCompanies && (
                        <TableRow
                          className="bg-muted/25 hover:bg-muted/25 pointer-events-none select-none"
                        >
                          <TableCell
                            colSpan={6}
                            className="py-1.5 pl-10 pr-4 text-xs font-medium text-muted-foreground"
                          >
                            <span className="flex items-center gap-1.5">
                              <Building2 className="h-3 w-3 shrink-0" />
                              {companyName}
                              {companyCode && (
                                <span className="font-normal opacity-60">({companyCode})</span>
                              )}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}

                      {/* ── Log rows for this company on this day ─────────── */}
                      {logs.map((log: any) => (
                        <TableRow
                          key={log.id}
                          className="group cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => setSelectedLog(log)}
                        >
                          <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {fmtDate(log.createdAt)}
                          </TableCell>
                          <TableCell className="text-sm font-medium truncate max-w-[130px]">
                            {log.username || `User #${String(log.userId).slice(0, 8)}` || "Unknown"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={actionBadgeVariant(log.action)}
                              className="capitalize text-[10px] h-5 whitespace-nowrap"
                            >
                              {log.actionLabel || actionLabel(log.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {log.moduleLabel || tableShortName(log.tableName)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                            <span className="truncate block">{getRecordLabel(log)}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <span className="truncate max-w-[380px]">{getDetailsSentence(log)}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50" />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-sm font-medium px-4">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isFetching}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {selectedLog && <AuditLogDialog log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
