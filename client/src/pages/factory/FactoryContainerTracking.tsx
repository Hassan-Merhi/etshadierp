import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ExternalLink, Link2, Link2Off, Check, X, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatNumber } from "@/lib/formatNumber";

interface TrackingRow {
  id: number;
  customerOrderId: number;
  invoiceNumber: string | null;
  clientName: string | null;
  containerNumber: string | null;
  status: string;
  eta: string | null;
  grandTotal: string | null;
  trackingLink: string | null;
}

const LIST_KEY = "/api/factory/shipping-container-rows";

const STATUS_LABEL: Record<string, string> = {
  LOADING: "Loading",
  PENDING_VERIFICATION: "Pending",
  VERIFIED: "Verified",
  FINALIZED: "Finalized",
  DRAFT: "Draft",
  CANCELLED: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  LOADING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PENDING_VERIFICATION: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  VERIFIED: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  FINALIZED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  DRAFT: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const plain = d.slice(0, 10);
  const [y, m, day] = plain.split("-");
  if (!y || !m || !day) return "—";
  return `${day}/${m}/${y.slice(2)}`;
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s.startsWith("http") ? s : `https://${s}`);
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(s: string): string {
  if (!s) return s;
  return s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;
}

interface LinkCellProps {
  row: TrackingRow;
  onSave: (id: number, link: string | null) => void;
  isSaving: boolean;
}

function LinkCell({ row, onSave, isSaving }: LinkCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.trackingLink ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(row.trackingLink ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setEditing(false);
    setDraft(row.trackingLink ?? "");
  }

  function save() {
    const trimmed = draft.trim();
    onSave(row.id, trimmed || null);
    setEditing(false);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 min-w-[220px]">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Paste tracking URL…"
          className="h-7 text-xs"
          data-testid={`input-tracking-link-${row.id}`}
        />
        <Button size="icon" variant="ghost" onClick={save} disabled={isSaving} data-testid={`button-save-link-${row.id}`}>
          <Check className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button size="icon" variant="ghost" onClick={cancel} data-testid={`button-cancel-link-${row.id}`}>
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  if (row.trackingLink) {
    const url = normalizeUrl(row.trackingLink);
    return (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              data-testid={`link-tracking-open-${row.id}`}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[160px] truncate">{row.trackingLink}</span>
            </a>
          </TooltipTrigger>
          <TooltipContent side="top">{url}</TooltipContent>
        </Tooltip>
        <Button size="icon" variant="ghost" onClick={startEdit} data-testid={`button-edit-link-${row.id}`}>
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={startEdit}
      className="text-muted-foreground text-xs h-7 gap-1"
      data-testid={`button-add-link-${row.id}`}
    >
      <Link2Off className="h-3.5 w-3.5" />
      Add link
    </Button>
  );
}

export default function FactoryContainerTracking() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const { data: allRows = [], isLoading } = useQuery<TrackingRow[]>({
    queryKey: [LIST_KEY],
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, link }: { id: number; link: string | null }) =>
      apiRequest("PATCH", `/api/factory/shipping-container-rows/${id}`, { trackingLink: link }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save tracking link", description: err.message, variant: "destructive" });
    },
    onSettled: () => setSavingId(null),
  });

  function handleSave(id: number, link: string | null) {
    setSavingId(id);
    saveMutation.mutate({ id, link });
  }

  const withContainerNum = allRows.filter((r) => !!r.containerNumber?.trim());
  const displayed = showAll
    ? withContainerNum
    : withContainerNum.filter((r) => r.status !== "CANCELLED");

  const filtered = search.trim()
    ? displayed.filter((r) => {
        const q = search.toLowerCase();
        return (
          r.containerNumber?.toLowerCase().includes(q) ||
          r.clientName?.toLowerCase().includes(q) ||
          r.invoiceNumber?.toLowerCase().includes(q)
        );
      })
    : displayed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search container, customer, invoice…"
            className="pl-8"
            data-testid="input-tracking-search"
          />
        </div>
        <Button
          size="sm"
          variant={showAll ? "secondary" : "outline"}
          onClick={() => setShowAll((v) => !v)}
          data-testid="button-tracking-show-all"
        >
          {showAll ? "Hiding cancelled" : "Show all"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {filtered.length} container{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <ExternalLink className="h-10 w-10 opacity-30" />
          <p className="text-sm">
            {withContainerNum.length === 0
              ? "No finalized containers with a container number yet"
              : "No containers match your search"}
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead className="whitespace-nowrap">Container #</TableHead>
                <TableHead className="whitespace-nowrap">Customer</TableHead>
                <TableHead className="whitespace-nowrap">Invoice</TableHead>
                <TableHead className="whitespace-nowrap text-right">Cost (USD)</TableHead>
                <TableHead className="whitespace-nowrap">ETA</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap min-w-[200px]">Tracking</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row, idx) => (
                <TableRow key={row.id} data-testid={`row-container-tracking-${row.id}`}>
                  <TableCell className="text-center text-muted-foreground text-sm">
                    {idx + 1}
                  </TableCell>
                  <TableCell className="font-mono font-medium text-sm whitespace-nowrap" data-testid={`text-container-num-${row.id}`}>
                    {row.containerNumber}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm" data-testid={`text-customer-${row.id}`}>
                    {row.clientName ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground" data-testid={`text-invoice-${row.id}`}>
                    {row.invoiceNumber ?? "—"}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-sm tabular-nums" data-testid={`text-cost-${row.id}`}>
                    {row.grandTotal
                      ? `$${formatNumber(parseFloat(row.grandTotal), 2)}`
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm" data-testid={`text-eta-${row.id}`}>
                    {fmtDate(row.eta)}
                  </TableCell>
                  <TableCell data-testid={`text-status-${row.id}`}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </TableCell>
                  <TableCell data-testid={`cell-tracking-${row.id}`}>
                    <LinkCell
                      row={row}
                      onSave={handleSave}
                      isSaving={savingId === row.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
