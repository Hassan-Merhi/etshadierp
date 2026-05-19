import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Plus, Trash2, Package, ChevronRight } from "lucide-react";

const lineSchema = z.object({
  articleCode: z.string().min(1, "Required"),
  description: z.string().optional(),
  qty: z.string().min(1, "Required"),
  unitRateUsd: z.string().min(1, "Required"),
});

const containerSchema = z.object({
  supplierName: z.string().min(1, "Required"),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1, "Required"),
  invoiceTotalUsd: z.string().min(1, "Required"),
  discountPct: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line item"),
});

type ContainerForm = z.infer<typeof containerSchema>;

function formatUsd(v: any) {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "$0.00" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SpContainers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: containers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sp/containers"],
  });

  const form = useForm<ContainerForm>({
    resolver: zodResolver(containerSchema),
    defaultValues: {
      supplierName: "",
      invoiceNumber: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      invoiceTotalUsd: "",
      discountPct: "0",
      notes: "",
      lines: [{ articleCode: "", description: "", qty: "", unitRateUsd: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });

  const createMutation = useMutation({
    mutationFn: (data: ContainerForm) => apiRequest("POST", "/api/sp/containers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sp/containers"] });
      toast({ title: "Container created" });
      setSheetOpen(false);
      form.reset();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
                    <span className="text-xs text-muted-foreground font-mono">{c.invoiceNumber}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.invoiceDate} · {c.totalQty || 0} units · {formatUsd(c.invoiceTotalUsd)}
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
        <SheetContent className="overflow-y-auto w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>New Container</SheetTitle>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(d => createMutation.mutate(d))} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="supplierName" render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Supplier Name</FormLabel>
                    <FormControl><Input {...field} data-testid="input-sp-supplier-name" /></FormControl>
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
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-sp-invoice-total" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="discountPct" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discount %</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-sp-discount-pct" /></FormControl>
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Line Items</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ articleCode: "", description: "", qty: "", unitRateUsd: "" })} data-testid="button-sp-add-line">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
                  </Button>
                </div>
                {fields.map((field, idx) => (
                  <div key={field.id} className="grid grid-cols-12 gap-1.5 items-end border border-border rounded-md p-2">
                    <div className="col-span-3">
                      <FormField control={form.control} name={`lines.${idx}.articleCode`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Article</FormLabel>
                          <FormControl><Input className="h-8 text-xs" {...field} data-testid={`input-sp-article-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-4">
                      <FormField control={form.control} name={`lines.${idx}.description`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Description</FormLabel>
                          <FormControl><Input className="h-8 text-xs" {...field} data-testid={`input-sp-desc-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-2">
                      <FormField control={form.control} name={`lines.${idx}.qty`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Qty</FormLabel>
                          <FormControl><Input type="number" step="0.01" className="h-8 text-xs" {...field} data-testid={`input-sp-qty-${idx}`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                    <div className="col-span-2">
                      <FormField control={form.control} name={`lines.${idx}.unitRateUsd`} render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Rate $</FormLabel>
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

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>Cancel</Button>
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
