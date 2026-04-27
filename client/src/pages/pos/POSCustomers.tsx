import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Users, Printer, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { drCrClass } from "@/lib/formatNumber";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReactToPrint } from "react-to-print";
import { format } from "date-fns";
import { z } from "zod";

interface POSCustomer {
  id: number;
  legalName: string;
  phone: string | null;
  balance: number;
  balanceSide: string;
}

const formSchema = z.object({
  legalName: z.string().min(1, "Customer name is required"),
  phone: z.string().optional(),
  openingBalance: z.string().optional(),
  openingBalanceSide: z.enum(["Dr", "Cr"]).default("Dr"),
});

type FormData = z.infer<typeof formSchema>;

export default function POSCustomers() {
  const { toast } = useToast();
  const { formatCashAmount, formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statementCustomer, setStatementCustomer] = useState<POSCustomer | null>(null);

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Statement_${statementCustomer?.legalName?.replace(/\s+/g, "_") ?? "Customer"}`,
  });

  const { data: customers = [], isLoading } = useQuery<POSCustomer[]>({
    queryKey: ["/api/pos/customers"],
  });

  // Fetch transactions when a customer is selected
  const { data: ledgerTxns = [], isLoading: txnsLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", statementCustomer?.id, "transactions"],
    queryFn: () =>
      fetch(`/api/customers/${statementCustomer!.id}/transactions`).then((r) => r.json()),
    enabled: !!statementCustomer?.id,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      legalName: "",
      phone: "",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await apiRequest("POST", "/api/pos/customers", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Customer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/customers"] });
      setIsCreateOpen(false);
      form.reset({ legalName: "", phone: "", openingBalance: "0", openingBalanceSide: "Dr" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => createMutation.mutate(data);

  const filteredCustomers = customers.filter((customer) =>
    (customer.legalName || "").toLowerCase().includes((searchQuery || "").toLowerCase())
  );

  const totalCustomers = customers.length;
  const totalReceivables = customers
    .filter(c => c.balanceSide === "Dr")
    .reduce((sum, c) => sum + (c.balance || 0), 0);

  // Compute statement rows
  const sorted = [...ledgerTxns].sort(
    (a, b) => new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime()
  );
  const totalDr = sorted.reduce((s, t) => s + parseFloat(t.debitAmount || "0"), 0);
  const totalCr = sorted.reduce((s, t) => s + parseFloat(t.creditAmount || "0"), 0);
  const closingBalance = statementCustomer?.balance || 0;
  const openingBalance = closingBalance - totalDr + totalCr;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      <PageHeader title="Customers" subtitle="Manage customer accounts" />

      <div className="grid grid-cols-2 gap-2 md:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-16" />
            ) : (
              <div className="text-xl md:text-2xl font-semibold" data-testid="text-total-customers">
                {totalCustomers}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 pb-1 md:p-6 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Total Receivables</CardTitle>
            <Users className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {isLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <div className="text-lg md:text-2xl font-semibold" data-testid="text-total-receivables">
                {formatCashAmount(totalReceivables)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Customer List</CardTitle>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-customer">
                <Plus className="mr-2 h-4 w-4" />
                New Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Customer</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <FormField
                    control={form.control}
                    name="legalName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer Name *</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Enter customer name" data-testid="input-legal-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="+1234567890" data-testid="input-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="openingBalance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Opening Balance</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value || "0"} type="number" step="0.01" placeholder="0.00" data-testid="input-opening-balance" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="openingBalanceSide"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Balance Side</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "Dr"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-balance-side">
                                <SelectValue placeholder="Select side" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Dr">Dr (Debit)</SelectItem>
                              <SelectItem value="Cr">Cr (Credit)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel">
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-customer">
                      {createMutation.isPending ? "Creating..." : "Create Customer"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-customers"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">{searchQuery ? "No customers found" : "No customers yet"}</p>
              <p className="text-sm mt-1">{searchQuery ? "Try a different search term" : "Create your first customer to get started"}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Customer Name</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Phone</TableHead>
                    <TableHead className="text-xs text-right">Balance</TableHead>
                    <TableHead className="text-xs">Side</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomers.map((customer) => (
                    <TableRow
                      key={customer.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => setStatementCustomer(customer)}
                      data-testid={`row-customer-${customer.id}`}
                    >
                      <TableCell className="font-medium text-sm">
                        <span className="underline decoration-dotted underline-offset-2">
                          {customer.legalName}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm hidden sm:table-cell text-muted-foreground">
                        {customer.phone || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCashAmount(customer.balance || 0)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={drCrClass(customer.balanceSide || "Dr")}
                          data-testid={`badge-balance-side-${customer.id}`}
                        >
                          {customer.balanceSide || "Dr"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Statement Dialog */}
      <Dialog open={!!statementCustomer} onOpenChange={(open) => !open && setStatementCustomer(null)}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <DialogTitle className="text-lg">{statementCustomer?.legalName}</DialogTitle>
                <div className="flex items-center gap-3 pt-1 text-sm text-muted-foreground">
                  <span>
                    Balance:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {formatCashAmount(statementCustomer?.balance || 0)}
                    </span>
                  </span>
                  <Badge
                    variant="secondary"
                    className={drCrClass(statementCustomer?.balanceSide || "Dr")}
                  >
                    {statementCustomer?.balanceSide || "Dr"}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePrint()}
                  className="gap-2"
                  data-testid="button-print-statement"
                >
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePrint()}
                  className="gap-2"
                  data-testid="button-save-pdf-statement"
                >
                  <FileDown className="h-4 w-4" />
                  Save PDF
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto mt-2">
            {txnsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No transactions found</div>
            ) : (() => {
              let running = openingBalance;
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openingBalance !== 0 && (
                      <TableRow className="text-muted-foreground text-sm">
                        <TableCell>—</TableCell>
                        <TableCell className="italic">Opening Balance</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right font-mono">
                          {formatAmount(Math.abs(openingBalance))}
                        </TableCell>
                      </TableRow>
                    )}
                    {sorted.map((t, i) => {
                      const dr = parseFloat(t.debitAmount || "0");
                      const cr = parseFloat(t.creditAmount || "0");
                      running = running + dr - cr;
                      return (
                        <TableRow key={t.entryId ?? i}>
                          <TableCell className="font-mono text-sm whitespace-nowrap">
                            {t.voucherDate ? format(new Date(t.voucherDate), "yyyy-MM-dd") : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                            {t.narration || t.voucherDescription || t.voucherType || "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {dr > 0 ? formatAmount(dr) : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {cr > 0 ? formatAmount(cr) : ""}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium">
                            {formatAmount(Math.abs(running))}
                            <span className={`text-xs font-semibold ml-1 ${drCrClass(running >= 0 ? "Dr" : "Cr")}`}>
                              {running >= 0 ? "Dr" : "Cr"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableHeader className="border-t-2">
                    <TableRow className="font-semibold">
                      <TableHead colSpan={2}>Total</TableHead>
                      <TableHead className="text-right font-mono text-foreground">{formatAmount(totalDr)}</TableHead>
                      <TableHead className="text-right font-mono text-foreground">{formatAmount(totalCr)}</TableHead>
                      <TableHead className="text-right font-mono text-foreground">
                        {formatAmount(Math.abs(closingBalance))}
                        <span className={`text-xs font-semibold ml-1 ${drCrClass(statementCustomer?.balanceSide || "Dr")}`}>
                          {statementCustomer?.balanceSide || "Dr"}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                </Table>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden print template */}
      <div style={{ position: "fixed", top: "-9999px", left: "-9999px", visibility: "hidden", pointerEvents: "none" }}>
        <div ref={printRef} style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "10pt", padding: "20px", backgroundColor: "white", color: "black" }}>
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              body { font-family: Arial, Helvetica, sans-serif !important; }
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #ccc; padding: 4px 8px; font-size: 9pt; }
              th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
              .text-right { text-align: right; }
            }
          `}} />
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <div style={{ fontSize: "14pt", fontWeight: "900" }}>Customer Statement</div>
            <div style={{ fontSize: "10pt", color: "#555" }}>{selectedCompany?.name}</div>
            <div style={{ fontSize: "9pt", color: "#777", marginTop: "2px" }}>
              Printed: {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </div>
          <div style={{ marginBottom: "10px", padding: "8px", border: "1px solid #ddd", borderRadius: "4px" }}>
            <strong>{statementCustomer?.legalName}</strong>
            {statementCustomer?.phone && <span style={{ marginLeft: "12px", color: "#555" }}>{statementCustomer.phone}</span>}
            <span style={{ float: "right" }}>
              Balance: <strong>{formatCashAmount(statementCustomer?.balance || 0)}</strong>{" "}
              <strong>{statementCustomer?.balanceSide || "Dr"}</strong>
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="text-right" style={{ textAlign: "right" }}>Debit</th>
                <th className="text-right" style={{ textAlign: "right" }}>Credit</th>
                <th className="text-right" style={{ textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {openingBalance !== 0 && (
                <tr style={{ color: "#777" }}>
                  <td>—</td>
                  <td><em>Opening Balance</em></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: "right" }}>{formatAmount(Math.abs(openingBalance))}</td>
                </tr>
              )}
              {(() => {
                let r = openingBalance;
                return sorted.map((t, i) => {
                  const dr = parseFloat(t.debitAmount || "0");
                  const cr = parseFloat(t.creditAmount || "0");
                  r = r + dr - cr;
                  return (
                    <tr key={i}>
                      <td>{t.voucherDate ? format(new Date(t.voucherDate), "yyyy-MM-dd") : "—"}</td>
                      <td>{t.narration || t.voucherDescription || t.voucherType || "—"}</td>
                      <td style={{ textAlign: "right" }}>{dr > 0 ? formatAmount(dr) : ""}</td>
                      <td style={{ textAlign: "right" }}>{cr > 0 ? formatAmount(cr) : ""}</td>
                      <td style={{ textAlign: "right" }}>
                        {formatAmount(Math.abs(r))} {r >= 0 ? "Dr" : "Cr"}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: "bold", borderTop: "2px solid #333" }}>
                <td colSpan={2}>Total</td>
                <td style={{ textAlign: "right" }}>{formatAmount(totalDr)}</td>
                <td style={{ textAlign: "right" }}>{formatAmount(totalCr)}</td>
                <td style={{ textAlign: "right" }}>
                  {formatAmount(Math.abs(closingBalance))} {statementCustomer?.balanceSide || "Dr"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
