import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber, drCrClass } from "@/lib/formatNumber";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Plus, Search, Building2, Pencil } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { insertCustomerSchema, type Customer } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";

const formSchema = insertCustomerSchema.extend({
  legalName: z.string().min(1, "Legal name is required"),
});

export default function Customers() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statementCustomer, setStatementCustomer] = useState<(Customer & { balance: number; balanceSide: string }) | null>(null);

  // Fetch transactions when a customer is selected for statement
  // Works whether entries are stored by ledger_account_id or customer_id (post-migration)
  const { data: ledgerTxns = [], isLoading: txnsLoading } = useQuery<any[]>({
    queryKey: ["/api/customers", statementCustomer?.id, "transactions"],
    queryFn: () =>
      fetch(`/api/customers/${statementCustomer!.id}/transactions`)
        .then((r) => r.json()),
    enabled: !!statementCustomer?.id,
  });

  const { data: customers = [], isLoading } = useQuery<(Customer & { balance: number; balanceSide: string })[]>({
    queryKey: ["/api/customers/stats", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      companyId: selectedCompany?.id || 0,
      legalName: "",
      phone: "",
      openingBalance: "0",
      openingBalanceSide: "Dr",
    },
  });

  // Reset form when company changes
  useEffect(() => {
    if (selectedCompany?.id) {
      form.reset({
        companyId: selectedCompany.id,
        legalName: "",
        phone: "",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      });
    }
  }, [selectedCompany?.id, form]);

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      return await apiRequest("POST", "/api/customers", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Customer created successfully with ledger account",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
      setIsCreateOpen(false);
      form.reset({
        companyId: selectedCompany?.id || 0,
        legalName: "",
        phone: "",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema> & { id: number }) => {
      return await apiRequest("PUT", `/api/customers/${data.id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Customer updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts", selectedCompany?.id] });
      setIsEditOpen(false);
      setEditingCustomer(null);
      form.reset({
        companyId: selectedCompany?.id || 0,
        legalName: "",
        phone: "",
        openingBalance: "0",
        openingBalanceSide: "Dr",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    if (editingCustomer) {
      updateMutation.mutate({ ...data, id: editingCustomer.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEditClick = (customer: Customer) => {
    setEditingCustomer(customer);
    form.reset({
      companyId: customer.companyId,
      legalName: customer.legalName,
      phone: customer.phone || "",
      openingBalance: customer.openingBalance || "0",
      openingBalanceSide: (customer.openingBalanceSide === "Dr" || customer.openingBalanceSide === "Cr") ? customer.openingBalanceSide : "Dr",
    });
    setIsEditOpen(true);
  };

  const filteredCustomers = customers.filter((customer) => {
    const matchesSearch = (customer.legalName || "").toLowerCase().includes((searchQuery || "").toLowerCase());
    const hasBalance = (customer.balance || 0) !== 0;
    return matchesSearch && (hasBalance || !!searchQuery);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground text-sm sm:text-base">Manage customer accounts and receivables</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-customer">
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
                      <FormLabel>Legal Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="ABC Company Ltd." data-testid="input-legal-name" />
                      </FormControl>
                      <FormDescription>
                        Customer code will be auto-generated
                      </FormDescription>
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateOpen(false)}
                    data-testid="button-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    data-testid="button-submit-customer"
                  >
                    {createMutation.isPending ? "Creating..." : "Create Customer"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-customers"
          />
        </div>
      </div>

      <Card className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-muted z-10">Legal Name</TableHead>
              <TableHead className="text-right">Current Balance</TableHead>
              <TableHead>Balance Side</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {searchQuery ? "No customers found matching your search" : "No customers yet"}
                </TableCell>
              </TableRow>
            ) : (
              filteredCustomers.map((customer) => (
                <TableRow key={customer.id} data-testid={`row-customer-${customer.id}`}>
                  <TableCell className="sticky left-0 bg-background z-10">
                    <button
                      onClick={() => setStatementCustomer(customer)}
                      className="flex items-center gap-2 text-primary hover:underline cursor-pointer"
                      data-testid={`link-customer-statement-${customer.id}`}
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {customer.legalName}
                    </button>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatAmount(customer.balance || 0)}
                  </TableCell>
                  <TableCell className={`font-semibold text-sm ${drCrClass(customer.balanceSide || "Dr")}`}>{customer.balanceSide || "Dr"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(customer)}
                      data-testid={`button-edit-customer-${customer.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <div className="md:hidden space-y-3">
        {filteredCustomers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchQuery ? "No customers found matching your search" : "No customers yet"}
          </div>
        ) : (
          filteredCustomers.map((customer) => (
            <Card key={customer.id} data-testid={`row-customer-${customer.id}`}>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => setStatementCustomer(customer)}
                    className="flex items-center gap-2 text-primary hover:underline cursor-pointer text-sm font-medium"
                    data-testid={`link-customer-statement-${customer.id}`}
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {customer.legalName}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditClick(customer)}
                    data-testid={`button-edit-customer-${customer.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className={drCrClass(customer.balanceSide || "Dr")}>{customer.balanceSide || "Dr"}</Badge>
                  <span className="font-mono font-semibold">{formatAmount(customer.balance || 0)}</span>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Edit Customer Dialog */}
      <Dialog open={isEditOpen} onOpenChange={(open) => {
        setIsEditOpen(open);
        if (!open) {
          setEditingCustomer(null);
          form.reset({
            companyId: selectedCompany?.id || 0,
            legalName: "",
            phone: "",
            openingBalance: "0",
            openingBalanceSide: "Dr",
          });
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Customer</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="legalName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Legal Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="ABC Company Ltd." data-testid="input-edit-legal-name" />
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
                      <Input {...field} value={field.value || ""} placeholder="+1234567890" data-testid="input-edit-phone" />
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
                        <Input {...field} value={field.value || "0"} type="number" step="0.01" placeholder="0.00" data-testid="input-edit-opening-balance" />
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
                          <SelectTrigger data-testid="select-edit-balance-side">
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditOpen(false)}
                  data-testid="button-edit-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-submit-edit-customer"
                >
                  {updateMutation.isPending ? "Updating..." : "Update Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Customer Statement Dialog */}
      <Dialog open={!!statementCustomer} onOpenChange={(open) => !open && setStatementCustomer(null)}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {statementCustomer?.legalName}
            </DialogTitle>
            <div className="flex items-center gap-3 pt-1 text-sm text-muted-foreground">
              <span>Balance: <span className="font-mono font-semibold text-foreground">{formatAmount(statementCustomer?.balance || 0)}</span></span>
              <Badge variant="secondary" className={drCrClass(statementCustomer?.balanceSide || "Dr")}>
                {statementCustomer?.balanceSide || "Dr"}
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto mt-2">
            {txnsLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (() => {
              const sorted = [...ledgerTxns].sort((a, b) =>
                new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime()
              );
              const totalDr = sorted.reduce((s, t) => s + parseFloat(t.debitAmount || "0"), 0);
              const totalCr = sorted.reduce((s, t) => s + parseFloat(t.creditAmount || "0"), 0);
              const closingBalance = statementCustomer?.balance || 0;
              const openingBalance = closingBalance - totalDr + totalCr;

              let running = openingBalance;

              return sorted.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No transactions found</div>
              ) : (
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
                        <TableCell colSpan={1} className="italic">Opening Balance</TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right font-mono">{formatAmount(Math.abs(openingBalance))}</TableCell>
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
                            <span className={`text-xs font-semibold ml-1 ${drCrClass(running >= 0 ? "Dr" : "Cr")}`}>{running >= 0 ? "Dr" : "Cr"}</span>
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
                        <span className={`text-xs font-semibold ml-1 ${drCrClass(statementCustomer?.balanceSide || "Dr")}`}>{(statementCustomer?.balanceSide || "Dr")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                </Table>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
