import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { ArrowRight, Undo2, Building2, Zap, Trash2, Plus } from "lucide-react";

interface LedgerAccount {
  id: number;
  name: string;
  code: string;
  accountType: string;
}

interface Transfer {
  id: number;
  fromCompanyId: number;
  toCompanyId: number;
  fromCompanyName: string;
  toCompanyName: string;
  fromAccountName: string;
  toAccountName: string;
  amount: string;
  transferDate: string;
  description: string | null;
  createdAt: string;
}

interface AutoTransferConfig {
  id: number;
  companyId: number;
  module: string;
  destCompanyId: number;
  destLedgerAccountId: number;
  sourceCashAccountIds: number[];
  enabled: boolean;
  destCompanyName?: string | null;
  destAccountName?: string | null;
  sourceAccountNames?: { id: number; name: string }[];
}

const MODULE_LABELS: Record<string, string> = {
  PROPERTIES: "Properties Rentals",
  ERP: "ERP Rentals",
  FACTORY: "Factory Rentals",
};

const MODULE_PREFIXES: Record<string, string> = {
  PROPERTIES: "/api/properties/rental",
  ERP: "/api/erp/rental",
  FACTORY: "/api/factory/rental",
};

const MODULES = ["PROPERTIES", "ERP", "FACTORY"] as const;

export default function CompanyTransfer() {
  const { companies, currentCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();

  const today = new Date().toLocaleDateString("en-CA");

  const [toCompanyId, setToCompanyId] = useState<string>("");
  const [fromAccountId, setFromAccountId] = useState<string>("");
  const [toAccountId, setToAccountId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(today);
  const [description, setDescription] = useState("");
  const [undoTarget, setUndoTarget] = useState<Transfer | null>(null);

  // Auto-rule editor state (one "add" form at a time per module)
  const [addingModule, setAddingModule] = useState<string | null>(null);
  const [ruleDestCompanyId, setRuleDestCompanyId] = useState<string>("");
  const [ruleDestAccountId, setRuleDestAccountId] = useState<string>("");
  const [ruleCashAccountIds, setRuleCashAccountIds] = useState<number[]>([]);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [deleteConfirmRuleId, setDeleteConfirmRuleId] = useState<{ id: number; module: string } | null>(null);

  const fromCompanyId = currentCompany?.id;

  const otherCompanies = useMemo(
    () => companies.filter(c => c.id !== fromCompanyId),
    [companies, fromCompanyId],
  );

  // Accounts for current (from) company
  const { data: fromAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: [`/api/company-accounts/${fromCompanyId}`],
    enabled: !!fromCompanyId,
  });

  // Accounts for selected destination company (manual transfer)
  const { data: toAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: [`/api/company-accounts/${toCompanyId}`],
    enabled: !!toCompanyId,
  });

  // Accounts for rule destination company
  const { data: ruleDestAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: [`/api/company-accounts/${ruleDestCompanyId}`],
    enabled: !!ruleDestCompanyId,
  });

  // All transfers for current company
  const { data: transfers = [], isLoading } = useQuery<Transfer[]>({
    queryKey: ["/api/simple-company-transfers"],
  });

  // Auto-transfer configs — one query per module returning arrays (hooks cannot be in .map)
  const cfgProperties = useQuery<AutoTransferConfig[]>({
    queryKey: [`/api/properties/rental/auto-transfer-config`],
    enabled: !!fromCompanyId,
  });
  const cfgErp = useQuery<AutoTransferConfig[]>({
    queryKey: [`/api/erp/rental/auto-transfer-config`],
    enabled: !!fromCompanyId,
  });
  const cfgFactory = useQuery<AutoTransferConfig[]>({
    queryKey: [`/api/factory/rental/auto-transfer-config`],
    enabled: !!fromCompanyId,
  });
  const autoConfigQueries = [cfgProperties, cfgErp, cfgFactory];

  const transferMutation = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", "/api/simple-company-transfer", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simple-company-transfers"] });
      toast({ title: "Transfer complete", description: "Amount moved successfully." });
      setToCompanyId("");
      setFromAccountId("");
      setToAccountId("");
      setAmount("");
      setDescription("");
    },
    onError: (e: any) => {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/simple-company-transfer/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/simple-company-transfers"] });
      toast({ title: "Transfer reversed", description: "Both entries removed." });
      setUndoTarget(null);
    },
    onError: (e: any) => {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
      setUndoTarget(null);
    },
  });

  const saveRuleMutation = useMutation({
    mutationFn: ({ module, body }: { module: string; body: object }) => {
      const prefix = MODULE_PREFIXES[module];
      return apiRequest("POST", `${prefix}/auto-transfer-config`, body);
    },
    onSuccess: (_, { module }) => {
      const prefix = MODULE_PREFIXES[module];
      queryClient.invalidateQueries({ queryKey: [`${prefix}/auto-transfer-config`] });
      toast({ title: "Rule added", description: "Auto-transfer rule is now active." });
      setAddingModule(null);
      setRuleDestCompanyId("");
      setRuleDestAccountId("");
      setRuleCashAccountIds([]);
      setRuleEnabled(true);
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: ({ module, id }: { module: string; id: number }) => {
      const prefix = MODULE_PREFIXES[module];
      return apiRequest("DELETE", `${prefix}/auto-transfer-config/${id}`);
    },
    onSuccess: (_, { module }) => {
      const prefix = MODULE_PREFIXES[module];
      queryClient.invalidateQueries({ queryKey: [`${prefix}/auto-transfer-config`] });
      toast({ title: "Rule removed", description: "Auto-transfer rule deleted." });
      setDeleteConfirmRuleId(null);
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
      setDeleteConfirmRuleId(null);
    },
  });

  const handleSubmit = () => {
    if (!fromCompanyId || !toCompanyId || !fromAccountId || !toAccountId || !amount) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    transferMutation.mutate({
      fromCompanyId,
      toCompanyId: parseInt(toCompanyId),
      fromLedgerAccountId: parseInt(fromAccountId),
      toLedgerAccountId: parseInt(toAccountId),
      amount,
      transferDate,
      description: description || undefined,
    });
  };

  const openAddRule = (module: string) => {
    setAddingModule(module);
    setRuleDestCompanyId("");
    setRuleDestAccountId("");
    setRuleCashAccountIds([]);
    setRuleEnabled(true);
  };

  const toggleCashAccount = (id: number) => {
    setRuleCashAccountIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSaveRule = () => {
    if (!addingModule || !ruleDestCompanyId || !ruleDestAccountId) {
      toast({ title: "Missing fields", description: "Select destination company and account.", variant: "destructive" });
      return;
    }
    saveRuleMutation.mutate({
      module: addingModule,
      body: {
        destCompanyId: parseInt(ruleDestCompanyId),
        destLedgerAccountId: parseInt(ruleDestAccountId),
        sourceCashAccountIds: ruleCashAccountIds,
        enabled: ruleEnabled,
      },
    });
  };

  const accountOptions = (list: LedgerAccount[]) =>
    list.filter(a => a.code !== "TRANSFER-CLEARING");

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4 shrink-0">
        <h1 className="text-2xl font-bold">Company Transfer</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Move a balance from one company to another. The amount is removed from the source and added to the destination.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Manual Transfer Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              New Transfer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-4">
              <div className="space-y-2">
                <Label>From Company</Label>
                <div
                  className="flex items-center h-9 px-3 rounded-md border bg-muted/40 text-sm font-medium"
                  data-testid="text-from-company"
                >
                  {currentCompany?.name ?? "—"}
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground mb-0.5 hidden md:block" />
              <div className="space-y-2">
                <Label>To Company</Label>
                <Select value={toCompanyId} onValueChange={v => { setToCompanyId(v); setToAccountId(""); }} data-testid="select-to-company">
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination company" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherCompanies.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-4">
              <div className="space-y-2">
                <Label>From Account <span className="text-destructive">*</span></Label>
                <Select value={fromAccountId} onValueChange={setFromAccountId} data-testid="select-from-account">
                  <SelectTrigger>
                    <SelectValue placeholder="Account to deduct from" />
                  </SelectTrigger>
                  <SelectContent>
                    {accountOptions(fromAccounts).map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                        <span className="text-muted-foreground text-xs ml-1">({a.accountType})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden md:block w-5" />
              <div className="space-y-2">
                <Label>To Account <span className="text-destructive">*</span></Label>
                <Select value={toAccountId} onValueChange={setToAccountId} disabled={!toCompanyId} data-testid="select-to-account">
                  <SelectTrigger>
                    <SelectValue placeholder={toCompanyId ? "Account to receive into" : "Select company first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {accountOptions(toAccounts).map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                        <span className="text-muted-foreground text-xs ml-1">({a.accountType})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Amount <span className="text-destructive">*</span></Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  data-testid="input-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} data-testid="input-date" />
              </div>
              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Input placeholder="e.g. Cash to Kinshasa" value={description} onChange={e => setDescription(e.target.value)} data-testid="input-description" />
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={transferMutation.isPending} data-testid="button-submit-transfer">
              {transferMutation.isPending ? "Transferring…" : "Transfer"}
            </Button>
          </CardContent>
        </Card>

        {/* Auto-Transfer Rules */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              Automatic Transfer Rules
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              When a rental payment is recorded, all matching rules fire automatically. Add multiple rules per module to route different cash accounts to different destinations.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {MODULES.map((mod, idx) => {
              const rules = autoConfigQueries[idx].data ?? [];
              const isAdding = addingModule === mod;

              return (
                <div key={mod} className="rounded-md border p-3 space-y-2" data-testid={`rule-section-${mod}`}>
                  {/* Module header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{MODULE_LABELS[mod]}</span>
                      <Badge variant={rules.length > 0 ? "default" : "outline"} className="text-xs">
                        {rules.length === 0 ? "No rules" : `${rules.length} rule${rules.length > 1 ? "s" : ""}`}
                      </Badge>
                    </div>
                    {!isAdding && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAddRule(mod)}
                        data-testid={`button-add-rule-${mod}`}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />Add Rule
                      </Button>
                    )}
                    {isAdding && (
                      <Button size="sm" variant="ghost" onClick={() => setAddingModule(null)}>
                        Cancel
                      </Button>
                    )}
                  </div>

                  {/* Existing rules list */}
                  {rules.length > 0 && (
                    <div className="space-y-1.5">
                      {rules.map(rule => (
                        <div
                          key={rule.id}
                          className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
                          data-testid={`rule-item-${rule.id}`}
                        >
                          <div className="space-y-0.5 text-sm min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant={rule.enabled ? "default" : "secondary"} className="text-xs">
                                {rule.enabled ? "Active" : "Paused"}
                              </Badge>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-medium">{rule.destCompanyName ?? `Company #${rule.destCompanyId}`}</span>
                              {rule.destAccountName && (
                                <span className="text-muted-foreground">/ {rule.destAccountName}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Triggers on:{" "}
                              {(rule.sourceCashAccountIds ?? []).length > 0
                                ? (rule.sourceAccountNames ?? []).map(a => a.name).join(", ") || `${rule.sourceCashAccountIds.length} account(s)`
                                : <em>all cash accounts</em>}
                            </p>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteConfirmRuleId({ id: rule.id, module: mod })}
                            data-testid={`button-delete-rule-${rule.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add-rule form */}
                  {isAdding && (
                    <div className="space-y-3 pt-1 border-t mt-2">
                      <p className="text-xs font-medium text-muted-foreground pt-1">New rule</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Destination Company</Label>
                          <Select
                            value={ruleDestCompanyId}
                            onValueChange={v => { setRuleDestCompanyId(v); setRuleDestAccountId(""); }}
                            data-testid={`select-rule-dest-company-${mod}`}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select company" />
                            </SelectTrigger>
                            <SelectContent>
                              {otherCompanies.map(c => (
                                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Destination Account</Label>
                          <Select
                            value={ruleDestAccountId}
                            onValueChange={setRuleDestAccountId}
                            disabled={!ruleDestCompanyId}
                            data-testid={`select-rule-dest-account-${mod}`}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={ruleDestCompanyId ? "Select account" : "Select company first"} />
                            </SelectTrigger>
                            <SelectContent>
                              {accountOptions(ruleDestAccounts).map(a => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                  <span className="text-muted-foreground text-xs ml-1">({a.accountType})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Cash account filter */}
                      <div className="space-y-1.5">
                        <Label className="text-xs">
                          Trigger on cash accounts
                          <span className="text-muted-foreground font-normal ml-1">(leave all unchecked = every cash account)</span>
                        </Label>
                        <div className="rounded-md border p-2 flex flex-wrap gap-x-4 gap-y-1.5">
                          {accountOptions(fromAccounts).map(a => (
                            <label
                              key={a.id}
                              className="flex items-center gap-1.5 cursor-pointer text-sm select-none"
                              data-testid={`checkbox-cash-account-${a.id}`}
                            >
                              <input
                                type="checkbox"
                                checked={ruleCashAccountIds.includes(a.id)}
                                onChange={() => toggleCashAccount(a.id)}
                                className="accent-primary"
                              />
                              {a.name}
                            </label>
                          ))}
                          {accountOptions(fromAccounts).length === 0 && (
                            <span className="text-xs text-muted-foreground">No accounts found</span>
                          )}
                        </div>
                        {ruleCashAccountIds.length === 0 && (
                          <p className="text-xs text-muted-foreground">All cash accounts will trigger this rule.</p>
                        )}
                        {ruleCashAccountIds.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Only when payment uses:{" "}
                            <strong>{accountOptions(fromAccounts).filter(a => ruleCashAccountIds.includes(a.id)).map(a => a.name).join(", ")}</strong>
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Switch
                          checked={ruleEnabled}
                          onCheckedChange={setRuleEnabled}
                          data-testid={`switch-rule-enabled-${mod}`}
                        />
                        <Label className="text-sm">{ruleEnabled ? "Enabled" : "Paused"}</Label>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleSaveRule}
                        disabled={saveRuleMutation.isPending}
                        data-testid={`button-save-rule-${mod}`}
                      >
                        {saveRuleMutation.isPending ? "Saving…" : "Add Rule"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Transfer History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-sm text-muted-foreground p-4">Loading…</p>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No transfers yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>From Account</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>To Account</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Undo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map(t => (
                    <TableRow key={t.id} data-testid={`row-transfer-${t.id}`}>
                      <TableCell className="text-sm">{t.transferDate}</TableCell>
                      <TableCell className="font-medium text-sm">{t.fromCompanyName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.fromAccountName}</TableCell>
                      <TableCell className="font-medium text-sm">{t.toCompanyName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.toAccountName}</TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        {formatAmount(parseFloat(t.amount))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.description ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setUndoTarget(t)}
                          data-testid={`button-undo-${t.id}`}
                        >
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Undo transfer dialog */}
      <AlertDialog open={!!undoTarget} onOpenChange={open => { if (!open) setUndoTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reverse this transfer?</AlertDialogTitle>
            <AlertDialogDescription>
              {undoTarget && (
                <>
                  This will remove the <strong>{formatAmount(parseFloat(undoTarget.amount))}</strong> transfer
                  from <strong>{undoTarget.fromCompanyName}</strong> to <strong>{undoTarget.toCompanyName}</strong>{" "}
                  on <strong>{undoTarget.transferDate}</strong>.<br /><br />
                  Both entries will be deleted and the balances will return to what they were before.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => undoTarget && undoMutation.mutate(undoTarget.id)}
              data-testid="button-confirm-undo"
            >
              {undoMutation.isPending ? "Reversing…" : "Yes, Reverse It"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete rule confirmation */}
      <AlertDialog open={!!deleteConfirmRuleId} onOpenChange={open => { if (!open) setDeleteConfirmRuleId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this auto-transfer rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule will be deleted. Payments already processed are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteConfirmRuleId && deleteRuleMutation.mutate(deleteConfirmRuleId)}
              data-testid="button-confirm-delete-rule"
            >
              {deleteRuleMutation.isPending ? "Removing…" : "Remove Rule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
