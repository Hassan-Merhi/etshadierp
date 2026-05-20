import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Loader2, ArrowLeft, Truck, Plus, FileText, CreditCard } from "lucide-react";

function fmt2(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const prepaidSchema = z.object({
  prepaidDate: z.string().min(1, "Required"),
  chargeType: z.string().min(1, "Required"),
  agentName: z.string().optional(),
  amountPaidUsd: z.string().min(1, "Required"),
  bankAccountId: z.string().optional(),
  notes: z.string().optional(),
});
type PrepaidForm = z.infer<typeof prepaidSchema>;

const CHARGE_TYPES = ["duty", "freight", "agent", "transporter", "other"];

export default function SpContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPrepaidForm, setShowPrepaidForm] = useState(false);

  const { data: container, isLoading } = useQuery<any>({
    queryKey: ["/api/sp/containers", id],
    queryFn: () => fetch(`/api/sp/containers/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: statusData } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const prepaidForm = useForm<PrepaidForm>({
    resolver: zodResolver(prepaidSchema),
    defaultValues: {
      prepaidDate: new Date().toISOString().slice(0, 10),
      chargeType: "",
      agentName: "",
      amountPaidUsd: "",
      bankAccountId: "",
      notes: "",
    },
  });

  const prepaidMutation = useMutation({
    mutationFn: (data: PrepaidForm & { containerId: string }) => apiRequest("POST", "/api/sp/prepaid", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/containers", id] });
      toast({ title: "Prepaid charge recorded", description: "Dr Prepaid / Cr Bank voucher posted." });
      setShowPrepaidForm(false);
      prepaidForm.reset({ prepaidDate: new Date().toISOString().slice(0, 10), chargeType: "", agentName: "", amountPaidUsd: "", bankAccountId: "", notes: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!container) return <div className="text-muted-foreground text-sm">Container not found.</div>;

  const discountFactor = 1 - parseFloat(container.discountPct || "0") / 100;
  const totalBaseCost = (container.lines || []).reduce(
    (s: number, l: any) => s + parseFloat(l.qty || "0") * parseFloat(l.unitRateUsd || "0") * discountFactor,
    0
  );
  const totalPrepaid = (container.prepaid || []).reduce(
    (s: number, p: any) => s + parseFloat(p.amountPaidUsd || "0"),
    0
  );

  // Voucher preview for prepaid form
  const watchAmount = prepaidForm.watch("amountPaidUsd");
  const watchBank = prepaidForm.watch("bankAccountId");
  const previewAmount = parseFloat(watchAmount || "0");
  const prepaidAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_prepaid");
  const selectedBank = (statusData?.bankAccounts || []).find((b: any) => String(b.id) === watchBank);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sp/containers")} data-testid="button-sp-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{container.supplierName}</h1>
            {container.containerNumber && (
              <span className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{container.containerNumber}</span>
            )}
            <span className="text-sm text-muted-foreground font-mono">{container.invoiceNumber}</span>
            <Badge
              variant="outline"
              className={container.status === "offloaded"
                ? "text-green-600 border-green-600/40"
                : "text-blue-600 border-blue-600/40"}
            >
              {container.status === "offloaded" ? "Offloaded" : "Open / OTW"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {container.invoiceDate} · {fmt2(container.invoiceTotalUsd)}
            {parseFloat(container.discountPct || "0") > 0 && (
              <span className="ml-2 text-green-600">−{parseFloat(container.discountPct).toFixed(1)}% discount</span>
            )}
          </p>
        </div>
        {container.status === "open" && (
          <Button onClick={() => navigate(`/sp/offload/${id}`)} data-testid="button-sp-go-offload">
            <Truck className="h-4 w-4 mr-2" /> Offload
          </Button>
        )}
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Line Items</CardTitle>
          <CardDescription className="text-xs">
            Discounted base cost: {fmt2(totalBaseCost)}
            {parseFloat(container.discountPct || "0") > 0 && ` (after ${parseFloat(container.discountPct).toFixed(1)}% discount)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(container.lines || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines.</p>
          ) : (
            <div className="grid gap-0.5">
              <div className="grid grid-cols-4 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                <span>Article</span><span>Description</span>
                <span className="text-right">Qty</span><span className="text-right">Rate (discounted)</span>
              </div>
              {(container.lines || []).map((l: any) => {
                const discountedRate = parseFloat(l.unitRateUsd || "0") * discountFactor;
                return (
                  <div key={l.id} className="grid grid-cols-4 text-sm py-1 border-b border-border/30 last:border-0" data-testid={`row-sp-line-${l.id}`}>
                    <span className="font-mono text-xs">{l.articleCode}</span>
                    <span className="text-muted-foreground truncate text-xs">{l.description || "—"}</span>
                    <span className="text-right tabular-nums">{parseFloat(l.qty || "0").toFixed(2)}</span>
                    <span className="text-right tabular-nums text-xs">
                      {fmt2(discountedRate)}
                      {parseFloat(container.discountPct || "0") > 0 && (
                        <span className="text-muted-foreground ml-1">(was {fmt2(l.unitRateUsd)})</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prepaid Charges */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-sm">Prepaid Charges</CardTitle>
              <CardDescription className="text-xs">
                Total prepaid: {fmt2(totalPrepaid)} · Posts Dr Prepaid / Cr Bank
              </CardDescription>
            </div>
            {container.status === "open" && (
              <Button variant="outline" size="sm" onClick={() => setShowPrepaidForm(!showPrepaidForm)} data-testid="button-sp-add-prepaid">
                <Plus className="h-3.5 w-3.5 mr-1" /> {showPrepaidForm ? "Cancel" : "Add Prepaid"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {showPrepaidForm && (
            <Form {...prepaidForm}>
              <form
                onSubmit={prepaidForm.handleSubmit(d => prepaidMutation.mutate({ ...d, containerId: id! }))}
                className="space-y-4 p-4 border border-border rounded-md bg-muted/20"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Prepaid Entry</p>

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={prepaidForm.control} name="prepaidDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Payment Date</FormLabel>
                      <FormControl><Input type="date" className="h-8 text-xs" {...field} data-testid="input-sp-prepaid-date" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={prepaidForm.control} name="chargeType" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Charge Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-8 text-xs" data-testid="select-sp-prepaid-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CHARGE_TYPES.map(t => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={prepaidForm.control} name="agentName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Agent / Payee</FormLabel>
                      <FormControl><Input className="h-8 text-xs" placeholder="Name of payee" {...field} data-testid="input-sp-prepaid-agent" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={prepaidForm.control} name="amountPaidUsd" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Amount (USD)</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" className="h-8 text-xs" {...field} data-testid="input-sp-prepaid-amount" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={prepaidForm.control} name="bankAccountId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Credit Bank Account</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="h-8 text-xs" data-testid="select-sp-prepaid-bank">
                            <SelectValue placeholder="Select bank" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(statusData?.bankAccounts || []).map((b: any) => (
                            <SelectItem key={b.id} value={String(b.id)}>{b.bankName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={prepaidForm.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Notes</FormLabel>
                      <FormControl><Input className="h-8 text-xs" {...field} data-testid="input-sp-prepaid-notes" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                {/* Voucher Preview */}
                {previewAmount > 0 && (
                  <div className="rounded-md border border-border bg-background p-3 space-y-1.5">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Journal Preview</p>
                    </div>
                    <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium pb-1 border-b border-border/40">
                      <span className="col-span-2">Account</span>
                      <span className="text-right">Dr / Cr</span>
                    </div>
                    <div className="grid grid-cols-3 text-xs py-0.5">
                      <span className="col-span-2 font-medium flex items-center gap-1.5">
                        <CreditCard className="h-3 w-3 text-muted-foreground" />
                        {prepaidAcct?.name ?? "SP Prepaid Charges"} <Badge variant="secondary" className="text-xs ml-1">Dr</Badge>
                      </span>
                      <span className="text-right tabular-nums font-semibold">{fmt2(previewAmount)}</span>
                    </div>
                    <div className="grid grid-cols-3 text-xs py-0.5 text-muted-foreground">
                      <span className="col-span-2 pl-4">
                        {selectedBank ? selectedBank.bankName : (watchBank ? "Selected Bank" : "Bank Account (Cr)")}
                      </span>
                      <span className="text-right tabular-nums">{fmt2(previewAmount)}</span>
                    </div>
                  </div>
                )}

                <Separator />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPrepaidForm(false)}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={prepaidMutation.isPending} data-testid="button-sp-save-prepaid">
                    {prepaidMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    Save Prepaid
                  </Button>
                </div>
              </form>
            </Form>
          )}

          {(container.prepaid || []).length === 0 && !showPrepaidForm ? (
            <p className="text-sm text-muted-foreground">No prepaid charges yet.</p>
          ) : (
            <div className="grid gap-0.5">
              <div className="grid grid-cols-5 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                <span>Date</span>
                <span>Type</span>
                <span className="col-span-2">Agent / Payee</span>
                <span className="text-right">Amount</span>
              </div>
              {(container.prepaid || []).map((p: any) => (
                <div key={p.id} className="grid grid-cols-5 text-xs py-1.5 border-b border-border/30 last:border-0 items-center" data-testid={`row-sp-prepaid-${p.id}`}>
                  <span className="text-muted-foreground">{p.prepaidDate || p.createdAt?.slice(0, 10) || "—"}</span>
                  <Badge variant="secondary" className="text-xs w-fit">{p.chargeType}</Badge>
                  <span className="col-span-2 text-muted-foreground truncate">{p.agentName || "—"}</span>
                  <div className="text-right">
                    <span className="font-semibold tabular-nums">{fmt2(p.amountPaidUsd)}</span>
                    {parseFloat(p.amountUsedUsd || "0") > 0 && (
                      <div className="text-xs text-green-600">{fmt2(p.amountUsedUsd)} used</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offload Summary */}
      {container.offload && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Offload Summary</CardTitle>
            <CardDescription className="text-xs">{container.offload.offloadDate}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-muted-foreground text-xs">Total Qty</p><p className="font-semibold">{parseFloat(container.offload.totalQty || "0").toFixed(2)}</p></div>
              <div><p className="text-muted-foreground text-xs">Base Cost</p><p className="font-semibold">{fmt2(container.offload.totalBaseCostUsd)}</p></div>
              <div><p className="text-muted-foreground text-xs">Landed Cost</p><p className="font-semibold">{fmt2(container.offload.totalLandedCostUsd)}</p></div>
              <div><p className="text-muted-foreground text-xs">Final Cost</p><p className="font-semibold">{fmt2(container.offload.totalFinalCostUsd)}</p></div>
            </div>

            {(container.movements || []).length > 0 && (
              <div className="mt-3 grid gap-0.5">
                <div className="grid grid-cols-5 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                  <span>Article</span><span className="text-right">Qty In</span>
                  <span className="text-right">Remaining</span><span className="text-right">Base/u</span><span className="text-right">Final/u</span>
                </div>
                {(container.movements || []).map((m: any) => (
                  <div key={m.id} className="grid grid-cols-5 text-xs py-1 border-b border-border/30 last:border-0" data-testid={`row-sp-movement-${m.id}`}>
                    <span className="font-mono">{m.articleCode}</span>
                    <span className="text-right tabular-nums">{parseFloat(m.qtyIn || "0").toFixed(2)}</span>
                    <span className="text-right tabular-nums text-green-600">{parseFloat(m.qtyRemaining || "0").toFixed(2)}</span>
                    <span className="text-right tabular-nums">{fmt2(m.baseUnitCostUsd)}</span>
                    <span className="text-right tabular-nums">{fmt2(m.finalUnitCostUsd)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
