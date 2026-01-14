import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { useCompany } from "@/contexts/CompanyContext";
import { Plus, Search, Building2, Pencil, ExternalLink, DollarSign } from "lucide-react";
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
  const [, navigate] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statementCustomer, setStatementCustomer] = useState<(Customer & { balance: number; balanceSide: string }) | null>(null);

  // Fetch customer sales/transactions when a customer is selected for statement
  const { data: customerSales = [], isLoading: salesLoading } = useQuery<any[]>({
    queryKey: [`/api/container-sales/customer/${statementCustomer?.id}`],
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

  const filteredCustomers = customers.filter((customer) =>
    (customer.legalName || "").toLowerCase().includes((searchQuery || "").toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground">Manage customer accounts and receivables</p>
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
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

      <Card className="overflow-x-auto">
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
                      <DollarSign className="h-3 w-3" />
                    </button>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${formatNumber(customer.balance || 0)}
                  </TableCell>
                  <TableCell>{customer.balanceSide || "Dr"}</TableCell>
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {statementCustomer?.legalName} - Statement
            </DialogTitle>
            <div className="flex items-center gap-4 pt-2 text-sm text-muted-foreground">
              <span>Current Balance: <span className="font-mono font-semibold text-foreground">${formatNumber(statementCustomer?.balance || 0)}</span></span>
              <Badge variant={statementCustomer?.balanceSide === "Cr" ? "default" : "secondary"}>
                {statementCustomer?.balanceSide || "Dr"}
              </Badge>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto mt-4">
            {salesLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : customerSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No transactions found for this customer
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Showing {customerSales.length} transaction{customerSales.length !== 1 ? "s" : ""}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...customerSales]
                      .sort((a: any, b: any) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime())
                      .map((sale: any, idx: number) => (
                        <TableRow key={sale.id}>
                          <TableCell className="font-mono text-sm">
                            {sale.saleDate ? format(new Date(sale.saleDate), "yyyy-MM-dd") : "-"}
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {sale.containerNumber || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {sale.invoiceNumber || "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${parseFloat(sale.totalAmount || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${parseFloat(sale.paidAmount || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant={sale.paymentStatus === "PAID" ? "default" : sale.paymentStatus === "PARTIAL" ? "secondary" : "outline"}>
                              {sale.paymentStatus || "PENDING"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>

                {/* Summary */}
                <div className="border-t pt-4 flex justify-between items-center">
                  <div className="text-sm text-muted-foreground">
                    Total: {customerSales.length} container sale{customerSales.length !== 1 ? "s" : ""}
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Outstanding: </span>
                    <span className="font-mono font-semibold text-lg">
                      ${formatNumber(statementCustomer?.balance || 0)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
