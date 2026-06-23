import { useState, useEffect, useRef } from "react";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { Search, RefreshCw, ChevronLeft, ChevronRight, Loader2, X, ExternalLink } from "lucide-react";
import { fmtDate, tableShortName, getRecordLabel, getDetailsSentence } from "./AuditLogUtils";
import { AuditLogDialog } from "./AuditLogDialog";

export { fmtDate, tableShortName, getRecordLabel, getDetailsSentence };

export function AuditLog() {
  const { toast } = useToast();
  const { appMode } = useAppMode();
  const { isOnline } = useConnectivity();
  const [filterAction, setFilterAction] = useState("update,delete");
  const [filterModule, setFilterModule] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [
      "/api/audit-log",
      {
        action: filterAction,
        module: filterModule,
        search: filterSearch,
        from: filterDateFrom,
        to: filterDateTo,
        page,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        action: filterAction,
        module: filterModule,
        search: filterSearch,
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

  const auditLogs = data?.logs || [];
  const totalPages = data?.totalPages || 1;
  const knownModules = data?.knownModules || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID or details..."
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="h-8 w-36 text-sm">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="update,delete">Updates & Deletes</SelectItem>
            <SelectItem value="create">Creates only</SelectItem>
            <SelectItem value="update">Update only</SelectItem>
            <SelectItem value="delete">Delete only</SelectItem>
          </SelectContent>
        </Select>
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
        <Input
          type="date"
          value={filterDateFrom}
          onChange={(e) => setFilterDateFrom(e.target.value)}
          className="h-8 w-36 text-sm"
        />
        <Input
          type="date"
          value={filterDateTo}
          onChange={(e) => setFilterDateTo(e.target.value)}
          className="h-8 w-36 text-sm"
        />
        {(filterAction !== "update,delete" || filterModule || filterSearch || filterDateFrom || filterDateTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => {
              setFilterAction("update,delete");
              setFilterModule("");
              setFilterSearch("");
              setFilterDateFrom("");
              setFilterDateTo("");
            }}
          >
            <X className="h-3 w-3 mr-1" /> Reset
          </Button>
        )}
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="p-4 text-destructive bg-destructive/10 rounded-md">Error loading audit logs.</div>
      ) : auditLogs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-md bg-muted/20">
          No edit logs found. Changes will appear here when records are modified.
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Date & Time</TableHead>
                <TableHead className="w-[150px]">User</TableHead>
                <TableHead className="w-[100px]">Action</TableHead>
                <TableHead className="w-[150px]">Module</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log: any) => (
                <TableRow
                  key={log.id}
                  className="group cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedLog(log)}
                >
                  <TableCell className="text-xs font-mono text-muted-foreground">{fmtDate(log.createdAt)}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {log.username || `User #${log.userId?.slice(0, 8)}` || "Unknown"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        log.action === "delete" ? "destructive" : log.action === "create" ? "default" : "secondary"
                      }
                      className="capitalize text-[10px] h-5"
                    >
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{tableShortName(log.tableName)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[400px]">{getDetailsSentence(log)}</span>
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-sm font-medium px-4">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {selectedLog && <AuditLogDialog log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
