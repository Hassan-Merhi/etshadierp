import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bell, CheckCircle, XCircle, ArrowRight, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface ICRequest {
  id: number;
  fromCompanyName: string;
  destCompanyName: string;
  destCompanyId: number;
  fromVoucherNumber: string;
  fromVoucherDate: string;
  amount: string;
  description: string | null;
  status: string;
  createdAt: string;
  approvedByUsername: string | null;
  approvedAt: string | null;
  dismissNote: string | null;
  linkDestLedgerAccountId: number;
  linkDestLedgerName: string;
  chosenAccountName: string | null;
  destVoucherId: number | null;
}

interface LedgerAccount {
  id: number;
  name: string;
  companyId: number;
}

function formatAmount(amount: string) {
  const n = parseFloat(amount);
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function IntercompanyBell() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [approveReq, setApproveReq] = useState<ICRequest | null>(null);
  const [dismissReq, setDismissReq] = useState<ICRequest | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [dismissNote, setDismissNote] = useState("");

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/intercompany-requests/pending-count"],
    queryFn: async () => {
      const r = await fetch("/api/intercompany-requests/pending-count", { credentials: "include" });
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: requests = [], isLoading } = useQuery<ICRequest[]>({
    queryKey: ["/api/intercompany-requests", "pending"],
    queryFn: async () => {
      const r = await fetch("/api/intercompany-requests?status=pending", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: open,
  });

  const { data: destAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", approveReq?.destCompanyId],
    queryFn: async () => {
      if (!approveReq?.destCompanyId) return [];
      const r = await fetch(`/api/ledger-accounts?companyId=${approveReq.destCompanyId}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!approveReq,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests"] });
    queryClient.invalidateQueries({ queryKey: ["/api/intercompany-requests/pending-count"] });
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, destLedgerAccountId }: { id: number; destLedgerAccountId: number }) =>
      apiRequest("POST", `/api/intercompany-requests/${id}/approve`, { destLedgerAccountId }),
    onSuccess: (data: any) => {
      toast({ title: "Approved", description: `Mirror voucher ${data.voucherNumber} created.` });
      invalidate();
      setApproveReq(null);
      setSelectedAccountId("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: ({ id, note }: { id: number; note: string }) =>
      apiRequest("POST", `/api/intercompany-requests/${id}/dismiss`, { note }),
    onSuccess: () => {
      toast({ title: "Dismissed" });
      invalidate();
      setDismissReq(null);
      setDismissNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const count = countData?.count ?? 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              title="Intercompany payment requests"
              data-testid="button-intercompany-bell"
            >
              <Bell className="h-4 w-4" />
            </Button>
            {count > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center pointer-events-none"
                data-testid="badge-ic-count"
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          className="w-96 p-0"
          data-testid="popover-ic-requests"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <p className="text-sm font-semibold">Intercompany Requests</p>
              <p className="text-xs text-muted-foreground">Pending cross-company payments</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={() => { setOpen(false); navigate("/intercompany-requests"); }}
              data-testid="button-ic-view-all"
            >
              View all
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>

          {/* Body */}
          <div className="max-h-[420px] overflow-y-auto">
            {isLoading ? (
              <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <CheckCircle className="h-6 w-6 text-emerald-500" />
                <p className="text-sm">All caught up — no pending requests</p>
              </div>
            ) : (
              <div className="divide-y">
                {requests.map(req => (
                  <div key={req.id} className="px-4 py-3 space-y-2" data-testid={`ic-request-${req.id}`}>
                    {/* Company flow + time */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium min-w-0">
                        <span className="truncate">{req.fromCompanyName}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{req.destCompanyName}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Amount + account */}
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-semibold">${formatAmount(req.amount)}</span>
                      <span className="text-muted-foreground text-xs truncate">CR: {req.linkDestLedgerName}</span>
                    </div>

                    {req.description && (
                      <p className="text-xs text-muted-foreground truncate">{req.description}</p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-0.5">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => { setApproveReq(req); setSelectedAccountId(""); }}
                        data-testid={`button-approve-${req.id}`}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => { setDismissReq(req); setDismissNote(""); }}
                        data-testid={`button-dismiss-${req.id}`}
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Approve Dialog */}
      <Dialog open={!!approveReq} onOpenChange={open => { if (!open) setApproveReq(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Payment Request</DialogTitle>
          </DialogHeader>
          {approveReq && (
            <div className="space-y-4 py-2">
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">From:</span> {approveReq.fromCompanyName}</p>
                <p><span className="text-muted-foreground">Amount:</span> ${formatAmount(approveReq.amount)}</p>
                <p><span className="text-muted-foreground">CR side:</span> {approveReq.linkDestLedgerName}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dest-account-select">Debit account (where money was received)</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger id="dest-account-select" data-testid="select-dest-account">
                    <SelectValue placeholder="Select account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {destAccounts
                      .filter(a => a.id !== approveReq.linkDestLedgerAccountId)
                      .map(a => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                A Receipt voucher will be created in <strong>{approveReq.destCompanyName}</strong>:
                DR selected account · CR {approveReq.linkDestLedgerName}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveReq(null)}>Cancel</Button>
            <Button
              onClick={() => approveReq && approveMutation.mutate({ id: approveReq.id, destLedgerAccountId: parseInt(selectedAccountId) })}
              disabled={!selectedAccountId || approveMutation.isPending}
              data-testid="button-confirm-approve"
            >
              {approveMutation.isPending ? "Approving…" : "Approve & Post"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismiss Dialog */}
      <Dialog open={!!dismissReq} onOpenChange={open => { if (!open) setDismissReq(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">This will mark the request as dismissed without posting a mirror voucher.</p>
            <div className="space-y-2">
              <Label htmlFor="dismiss-note">Note (optional)</Label>
              <Textarea
                id="dismiss-note"
                placeholder="Reason for dismissal…"
                value={dismissNote}
                onChange={e => setDismissNote(e.target.value)}
                data-testid="input-dismiss-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissReq(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => dismissReq && dismissMutation.mutate({ id: dismissReq.id, note: dismissNote })}
              disabled={dismissMutation.isPending}
              data-testid="button-confirm-dismiss"
            >
              {dismissMutation.isPending ? "Dismissing…" : "Dismiss"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
