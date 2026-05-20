import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Trash2, Package, ChevronRight, ClipboardPaste, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const lineSchema = z.object({
  articleCode: z.string().min(1, "Required"),
  description: z.string().optional(),
  qty: z.string().min(1, "Required"),
  unitRateUsd: z.string().min(1, "Required"),
});

const containerSchema = z.object({
  supplierName: z.string().min(1, "Required"),
  containerNumber: z.string().optional(),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1, "Required"),
  invoiceTotalUsd: z.string().min(1, "Required"),
  discountPct: z.string().optional(),
  freightEstimateUsd: z.string().optional(),
  notes: z.string().optional(),
  otwAccountId: z.string().optional(),
  otwClearingAccountId: z.string().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line item"),
});

type ContainerForm = z.infer<typeof containerSchema>;

function fmt2(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmt4(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.0000" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

export default function SpContainers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const { data: containers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/containers"],
  });

  const { data: statusData } = useQuery<any>({
    queryKey: ["/api/sp/setup/status"],
  });

  const { data: allAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/accounts"],
  });

  const { data: aliases = [] } = useQuery<any[]>({ queryKey: ["/api/sp/aliases"] });
  const aliasMap = new Map((aliases as any[]).map((a: any) => [a.alias_code, a]));

  const form = useForm<ContainerForm>({
    resolver: zodResolver(containerSchema),
    defaultValues: {
      supplierName: "",
      containerNumber: "",
      invoiceNumber: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      invoiceTotalUsd: "",
      discountPct: "0",
      freightEstimateUsd: "0",
      notes: "",
      otwAccountId: "",
      otwClearingAccountId: "",
      lines: [{ articleCode: "", description: "", qty: "", unitRateUsd: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const watchLines = form.watch("lines");
  const watchDiscountPct = form.watch("discountPct");
  const watchInvoiceTotal = form.watch("invoiceTotalUsd");
  const watchFreight = form.watch("freightEstimateUsd");
  const watchOtwAccountId = form.watch("otwAccountId");
  const watchOtwClearingAccountId = form.watch("otwClearingAccountId");

  const previewDiscountFactor = 1 - parseFloat(watchDiscountPct || "0") / 100;
  const previewTotalQty = watchLines.reduce((s: number, l: any) => s + parseFloat(l.qty || "0"), 0);
  const previewFreightEst = parseFloat(watchFreight || "0");
  const previewFreightPerUnit = previewTotalQty > 0 ? previewFreightEst / previewTotalQty : 0;
  const previewInvoiceTotal = parseFloat(watchInvoiceTotal || "0");

  // Default OTW / OTW-CLR account names from setup
  const defaultOtwAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_goods_otw");
  const defaultOtwClrAcct = (statusData?.spAccounts || []).find((a: any) => a.subType === "sp_otw_clearing");

  // Resolve selected accounts for voucher preview
  const selectedOtwAcct = watchOtwAccountId
    ? (allAccounts as any[]).find((a: any) => String(a.id) === watchOtwAccountId)
    : null;
  const selectedOtwClrAcct = watchOtwClearingAccountId
    ? (allAccounts as any[]).find((a: any) => String(a.id) === watchOtwClearingAccountId)
    : null;
  const previewOtwName = selectedOtwAcct?.name ?? defaultOtwAcct?.name ?? "Goods OTW";
  const previewOtwClrName = selectedOtwClrAcct?.name ?? defaultOtwClrAcct?.name ?? "Goods OTW Clearing";

  function parsePasteLines() {
    const parsed = pasteText.trim().split("\n").map(row => {
      const cols = row.split(/[\t,]/).map(c => c.trim());
      return {
        articleCode: cols[0] ?? "",
        description: cols[1] ?? "",
        qty: cols[2] ?? "",
        unitRateUsd: cols[3] ?? "",
      };
    }).filter(l => l.articleCode);
    if (parsed.length === 0) return;
    parsed.forEach(l => append(l));
    setPasteText("");
    setPasteOpen(false);
  }

  const createMutation = useMutation({
    mutationFn: (data: ContainerForm) => apiRequest("POST", "/api/sp/containers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/containers"] });
      toast({ title: "Container created", description: "Goods OTW voucher posted." });
      setSheetOpen(false);
      form.reset();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const hasLines = watchLines.some((l: any) => l.articleCode);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Containers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Supplier invoice containers and Goods OTW tracking</p>
        </div>
        <Button onClick={() => setSheetOpen(true)} data-testid="button-sp-new-container">
          <Plus className="h-4 w-4 mr-2" /> New Container
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : containers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">No containers yet. Create one to start tracking a supplier shipment.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {containers.map((c: any) => (
            <Card
              key={c.id}
              className="cursor-pointer hover-elevate"
              onClick={() => navigate(`/sp/containers/${c.id}`)}
              data-testid={`card-sp-container-${c.id}`}
            >
              <CardContent className="flex items-center justify-between py-4 flex-wrap gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{c.supplierName}</span>
                    {c.containerNumber && (
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{c.containerNumber}</span>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">{c.invoiceNumber}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.invoiceDate} · {c.totalQty || 0} units · {fmt2(c.invoiceTotalUsd)}
                    {parseFloat(c.discountPct || "0") > 0 && (
                      <span className="ml-2 text-green-600">−{parseFloat(c.discountPct).toFixed(1)}% disc</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{(c.lines || []).length} line{(c.lines || []).length !== 1 ? "s" : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={c.status === "offloaded"
                      ? "text-green-600 border-green-600/40"
                      : "text-blue-600 border-blue-600/40"}
                    data-testid={`badge-sp-container-status-${c.id}`}
                  >
                    {c.status === "offloaded" ? "Offloaded" : "Open / OTW"}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>New Container</SheetTitle>
            <SheetDescription>
              Creates a Goods OTW Journal voucher: Dr Goods OTW / Cr Goods OTW Clearing
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-5 mt-4">

              {/* ── Supplier & Header ── */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supplier & Header</p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="supplierName" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Supplier Name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-sp-supplier-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="containerNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Container No. <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl><Input placeholder="e.g. ABCD1234567" {...field} data-testid="input-sp-container-number" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Number</FormLabel>
                      <FormControl><Input {...field} data-testid="input-sp-invoice-number" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="invoiceDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Date</FormLabel>
                      <FormControl><Input type="date" {...field} data-testid="input-sp-invoice-date" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="invoiceTotalUsd" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Total (USD)</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-sp-invoice-total" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="discountPct" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discount %</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-sp-discount-pct" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="freightEstimateUsd" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Freight Estimate (USD)</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-sp-freight-estimate" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Input {...field} data-testid="input-sp-notes" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              {/* ── Voucher Accounts ── */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voucher Accounts <span className="text-muted-foreground font-normal normal-case">(optional — defaults to SP setup accounts)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="otwAccountId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Goods OTW Account <Badge variant="secondary" className="ml-1 text-xs">Dr</Badge></FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="text-xs" data-testid="select-sp-otw-account">
                            <SelectValue placeholder={defaultOtwAcct?.name ?? "Default (SP Goods OTW)"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">Default ({defaultOtwAcct?.name ?? "SP Goods OTW"})</SelectItem>
                          {(allAccounts as any[]).map((a: any) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="otwClearingAccountId" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">OTW Clearing Account <Badge variant="secondary" className="ml-1 text-xs">Cr</Badge></FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="text-xs" data-testid="select-sp-otw-clearing-account">
                            <SelectValue placeholder={defaultOtwClrAcct?.name ?? "Default (SP OTW Clearing)"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">Default ({defaultOtwClrAcct?.name ?? "SP OTW Clearing"})</SelectItem>
                          {(allAccounts as any[]).map((a: any) => (
                            <SelectItem key={a.id} value={String(a.id)}>
                              {a.code} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              <Separator />

              {/* ── Line Items ── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line Items</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPasteOpen(true)} data-testid="button-sp-paste-lines">
                      <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => append({ articleCode: "", description: "", qty: "", unitRateUsd: "" })} data-testid="button-sp-add-line">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
                    </Button>
                  </div>
                </div>
                {/* Column headers */}
                <div className="grid grid-cols-12 gap-1.5 px-2 pb-0.5">
                  <span className="col-span-3 text-xs text-muted-foreground">Article Code</span>
                  <span className="col-span-4 text-xs text-muted-foreground">Description</span>
                  <span className="col-span-2 text-xs text-muted-foreground">Qty</span>
                  <span className="col-span-2 text-xs text-muted-foreground">Rate (USD)</span>
                  <span className="col-span-1" />
                </div>
                {fields.map((field, idx) => (
                  <div key={field.id} className="grid grid-cols-12 gap-1.5 items-center border border-border rounded-md p-2" data-testid={`row-sp-line-${idx}`}>
                    <div className="col-span-3">
                      <FormField control={form.control} name={`lines.${idx}.articleCode`} render={({ field }) => (
                        <FormItem>
                          <FormControl><Input className="h-8 text-xs font-mono" {...field} data-testid={`input-sp-article-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-4">
                      <FormField control={form.control} name={`lines.${idx}.description`} render={({ field }) => (
                        <FormItem>
                          <FormControl><Input className="h-8 text-xs" {...field} data-testid={`input-sp-desc-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-2">
                      <FormField control={form.control} name={`lines.${idx}.qty`} render={({ field }) => (
                        <FormItem>
                          <FormControl><Input type="number" step="0.01" className="h-8 text-xs" {...field} data-testid={`input-sp-qty-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-2">
                      <FormField control={form.control} name={`lines.${idx}.unitRateUsd`} render={({ field }) => (
                        <FormItem>
                          <FormControl><Input type="number" step="0.0001" className="h-8 text-xs" {...field} data-testid={`input-sp-rate-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)} disabled={fields.length === 1} data-testid={`button-sp-remove-line-${idx}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {form.formState.errors.lines?.root && (
                  <p className="text-xs text-destructive">{form.formState.errors.lines.root.message}</p>
                )}
              </div>

              {/* ── Cost Preview ── */}
              {hasLines && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost Preview</p>
                    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <div className="grid gap-0.5">
                        <div className="grid grid-cols-6 text-xs font-medium text-muted-foreground pb-1 border-b border-border/40">
                          <span className="col-span-2">Article</span>
                          <span className="text-right">Base/u</span>
                          <span className="text-right">Disc/u</span>
                          <span className="text-right">Freight/u</span>
                          <span className="text-center">Alias</span>
                        </div>
                        {watchLines.filter((l: any) => l.articleCode).map((l: any, idx: number) => {
                          const unitRate = parseFloat(l.unitRateUsd || "0");
                          const discU = unitRate * previewDiscountFactor;
                          const finalU = discU + previewFreightPerUnit;
                          const mapped = aliasMap.has(l.articleCode);
                          return (
                            <div key={idx} className="grid grid-cols-6 text-xs py-1 border-b border-border/20 last:border-0">
                              <span className="col-span-2 font-mono truncate">{l.articleCode}</span>
                              <span className="text-right tabular-nums text-muted-foreground">{fmt4(unitRate)}</span>
                              <span className="text-right tabular-nums">{fmt4(discU)}</span>
                              <span className="text-right tabular-nums text-orange-600">{fmt4(previewFreightPerUnit)}</span>
                              <span className="flex justify-center">
                                {mapped
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                                  : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {(aliases as any[]).length > 0 && watchLines.some((l: any) => l.articleCode && !aliasMap.has(l.articleCode)) && (
                        <p className="text-xs text-amber-600 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Some articles have no alias mapping — FIFO tracked by article code only.
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground pt-1 border-t border-border/30 flex justify-between flex-wrap gap-1">
                        <span>Total qty: <strong>{previewTotalQty.toFixed(2)}</strong></span>
                        <span>Discount: <strong>{parseFloat(watchDiscountPct || "0").toFixed(1)}%</strong></span>
                        <span>Freight/unit: <strong>{fmt4(previewFreightPerUnit)}</strong></span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ── Voucher Preview ── */}
              {previewInvoiceTotal > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Will Post — Goods OTW Journal</p>
                    </div>
                    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
                      <div className="grid grid-cols-3 text-xs text-muted-foreground font-medium pb-1 border-b border-border/40">
                        <span className="col-span-2">Account</span>
                        <span className="text-right">Dr / Cr</span>
                      </div>
                      <div className="grid grid-cols-3 text-xs py-0.5">
                        <span className="col-span-2 font-medium flex items-center gap-1.5">
                          {previewOtwName}
                          <Badge variant="secondary" className="text-xs">Dr</Badge>
                        </span>
                        <span className="text-right tabular-nums font-semibold">{fmt2(previewInvoiceTotal)}</span>
                      </div>
                      <div className="grid grid-cols-3 text-xs text-muted-foreground py-0.5">
                        <span className="col-span-2 pl-4">{previewOtwClrName} (Cr)</span>
                        <span className="text-right tabular-nums">{fmt2(previewInvoiceTotal)}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Paste Lines</DialogTitle>
                    <DialogDescription>
                      Paste tab-separated or comma-separated data. Format per row:
                      <br /><strong>ArticleCode, Description, Qty, UnitRate</strong>
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    placeholder={"RICE-25KG\tPremium Rice 25kg bag\t100\t12.50\nWHEAT-50KG\tWheat flour 50kg\t60\t18.00"}
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    data-testid="textarea-sp-paste"
                  />
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPasteOpen(false)}>Cancel</Button>
                    <Button onClick={parsePasteLines} disabled={!pasteText.trim()} data-testid="button-sp-paste-confirm">
                      Import Lines
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setSheetOpen(false); form.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-sp-create-container">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Container
                </Button>
              </div>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
