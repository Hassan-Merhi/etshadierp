import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Package, DollarSign, FileText, Truck, Trash2, HandCoins, Calendar, User, RotateCcw, Edit, Download, Printer } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { OffloadDialog } from "@/components/OffloadDialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import type { Supplier, Customer, ContainerSale } from "@shared/schema";

interface ContainerDetailData {
  container: any;
  pos: any[];
  charges: any[];
}

const saleFormSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  commission: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Commission must be non-negative"),
  commissionAccountId: z.string().optional(),
  saleDate: z.string().min(1, "Sale date is required"),
});

export default function ContainerDetail() {
  const params = useParams();
  const containerId = params.id;
  const [showOffloadDialog, setShowOffloadDialog] = useState(false);
  const [showSellDialog, setShowSellDialog] = useState(false);
  const { toast } = useToast();
  const [_location, setLocation] = useLocation();
  const { selectedCompany } = useCompany();
  const { formatAmount } = useCurrencyContext();
  const companyId = selectedCompany?.id;
  const printRef = useRef<HTMLDivElement>(null);
  
  // Check for auto-print query parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('print') === 'true') {
      // Remove the print param from URL to prevent re-printing on refresh
      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);
      // Trigger print after a short delay to allow content to load
      setTimeout(() => {
        handlePrint();
      }, 1000);
    }
  }, []);

  const { data: containerData, isLoading } = useQuery<ContainerDetailData>({
    queryKey: [`/api/containers/${containerId}`],
    enabled: !!containerId,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", companyId],
    enabled: !!companyId,
  });

  const { data: allLedgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", companyId],
    enabled: !!companyId,
  });

  // Filter for income accounts only for commission dropdown
  const incomeAccounts = allLedgerAccounts.filter((account) => account.accountType === "Income");

  const { data: containerSales = [] } = useQuery<ContainerSale[]>({
    queryKey: ["/api/container-sales", companyId],
    enabled: !!companyId,
  });

  const containerSale = containerSales.find((sale: ContainerSale) => sale.containerId === parseInt(containerId!));

  const handleExportContainer = async () => {
    try {
      const response = await fetch(`/api/containers/${containerId}/export`);
      const data = await response.json();
      
      // Download as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `container_${data.container.containerNumber}_export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: "Export successful", description: "Container data downloaded as JSON" });
    } catch (error: any) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    }
  };



  // Determine the back URL based on container status
  const backUrl = containerData?.container?.status === "SOLD" ? "/sold-containers" : "/containers";

  const form = useForm<z.infer<typeof saleFormSchema>>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: {
      customerId: "",
      commission: "0.00",
      commissionAccountId: "",
      saleDate: new Date().toISOString().split('T')[0],
    },
  });

  // Delete PO mutation
  const deletePOMutation = useMutation({
    mutationFn: async (poId: number) => {
      await apiRequest("DELETE", `/api/purchase-orders/${poId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      toast({
        title: "Purchase Order Deleted",
        description: "The purchase order and associated data have been removed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete purchase order",
        variant: "destructive",
      });
    },
  });

  // Delete Container mutation
  const deleteContainerMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/containers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      toast({
        title: "Container Deleted",
        description: "The container and all associated data have been removed",
      });
      setLocation("/containers");
    },
    onError: (error: any) => {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete container",
        variant: "destructive",
      });
    },
  });

  // Reverse Offload mutation
  const reverseOffloadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/containers/${id}/reverse-offload`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({
        title: "Offload Reversed",
        description: "Container status restored to IN_TRANSIT",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reverse Failed",
        description: error.message || "Failed to reverse offload",
        variant: "destructive",
      });
    },
  });

  // Sell Container mutation
  const sellContainerMutation = useMutation({
    mutationFn: async (data: z.infer<typeof saleFormSchema>) => {
      const containerCost = parseFloat(containerData?.container.grandTotal || "0");
      const commission = parseFloat(data.commission);
      const totalAmount = containerCost + commission;

      await apiRequest("POST", "/api/container-sales", {
        containerId: parseInt(containerId!),
        customerId: parseInt(data.customerId),
        saleDate: data.saleDate,
        containerCost: containerCost.toString(),
        commission: data.commission,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : undefined,
        totalAmount: totalAmount.toString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/container-sales", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/active", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/containers/sold", selectedCompany?.id] });
      toast({
        title: "Container Sold",
        description: "Container sale has been recorded successfully",
      });
      setShowSellDialog(false);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Sale Failed",
        description: error.message || "Failed to record container sale",
        variant: "destructive",
      });
    },
  });

  const handleDeletePO = (poId: number, poNumber: string) => {
    if (confirm(`Are you sure you want to delete PO ${poNumber}? This will also delete all line items, the voucher, and remove the container if this is the last PO.`)) {
      deletePOMutation.mutate(poId);
    }
  };

  const handleDeleteContainer = () => {
    if (confirm(`Are you sure you want to delete container ${containerData?.container.containerNumber}? This will delete all purchase orders, line items, charges, vouchers, and the container itself. This action cannot be undone.`)) {
      deleteContainerMutation.mutate(parseInt(containerId!));
    }
  };

  const handleSellSubmit = (data: z.infer<typeof saleFormSchema>) => {
    sellContainerMutation.mutate(data);
  };

  const handlePrint = () => {
    window.print();
  };

  const saleCustomer = customers.find((c) => c.id === containerSale?.customerId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!containerData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Container not found</h2>
        <Link href={backUrl}>
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Containers
          </Button>
        </Link>
      </div>
    );
  }

  const { container, pos, charges } = containerData;
  const supplier = suppliers.find((s: any) => s.id === container.supplierId);

  const itemsTotal = parseFloat(container.itemsTotal || "0");
  const chargesTotal = parseFloat(container.chargesTotal || "0");
  const grandTotal = parseFloat(container.grandTotal || "0");
  
  // Calculate total bales from all line items
  const totalBales = pos.reduce((total: number, po: any) => {
    return total + po.items.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.quantity || "0");
    }, 0);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href={backUrl}>
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold" data-testid="text-container-number">
            Container {container.containerNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            Imported on {new Date(container.importDate).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={container.status === "OTW" ? "default" : "secondary"} data-testid="badge-status">
          {container.status}
        </Badge>
        {!containerSale && (
          <Button
            onClick={() => setShowSellDialog(true)}
            className="gap-2"
            data-testid="button-sell-container"
          >
            <HandCoins className="w-4 h-4" />
            Sell Container
          </Button>
        )}
        {container.status !== "OFFLOADED" && (
          <Button
            onClick={() => setShowOffloadDialog(true)}
            className="gap-2"
            data-testid="button-offload-container"
          >
            <Truck className="w-4 h-4" />
            Offload Container
          </Button>
        )}
        {container.status === "OFFLOADED" && (
          <>
            <Button
              onClick={() => setShowOffloadDialog(true)}
              variant="outline"
              className="gap-2"
              data-testid="button-edit-offload"
            >
              <Edit className="w-4 h-4" />
              Edit Offload
            </Button>
            <Button
              onClick={() => {
                if (confirm("Reverse offload? This will delete inventory and vouchers created during offload.")) {
                  reverseOffloadMutation.mutate(parseInt(containerId!));
                }
              }}
              variant="outline"
              disabled={reverseOffloadMutation.isPending}
              className="gap-2"
              data-testid="button-reverse-offload"
            >
              <RotateCcw className="w-4 h-4" />
              Reverse Offload
            </Button>
          </>
        )}
        <Button
          variant="outline"
          onClick={handlePrint}
          className="gap-2 print:hidden"
          data-testid="button-print-container"
        >
          <Printer className="w-4 h-4" />
          Print
        </Button>
        <Button
          variant="outline"
          onClick={handleExportContainer}
          className="gap-2"
          data-testid="button-export-container"
        >
          <Download className="w-4 h-4" />
          Export
        </Button>
        <Button
          variant="destructive"
          onClick={handleDeleteContainer}
          disabled={deleteContainerMutation.isPending}
          className="gap-2"
          data-testid="button-delete-container"
        >
          <Trash2 className="w-4 h-4" />
          Delete Container
        </Button>
      </div>

      {containerSale && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-green-600" />
              Container Sold
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sold to</p>
                <p className="font-semibold" data-testid="text-sale-customer">
                  {saleCustomer?.legalName || "Unknown Customer"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sale Date</p>
                <p className="font-semibold" data-testid="text-sale-date">
                  {new Date(containerSale.saleDate).toLocaleDateString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Sale Price</p>
                <p className="font-semibold" data-testid="text-sale-price">
                  {formatAmount(containerSale.containerCost)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Commission</p>
                <p className="font-semibold" data-testid="text-sale-commission">
                  {formatAmount(containerSale.commission)}
                </p>
              </div>
            </div>
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-xl font-bold" data-testid="text-sale-total">
                {formatAmount(containerSale.totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supplier</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold" data-testid="text-supplier">
              {supplier ? supplier.legalName : "Unknown"}
            </div>
            {supplier && (
              <p className="text-xs text-muted-foreground">{supplier.code}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Total</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-items-total">
              {formatAmount(itemsTotal)}
            </div>
            <p className="text-xs text-muted-foreground">
              {pos.reduce((sum: number, po: any) => sum + po.items.length, 0)} items in {pos.length} PO(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Grand Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-grand-total">
              {formatAmount(grandTotal)}
            </div>
            <p className="text-xs text-muted-foreground">
              Including {formatAmount(Math.abs(chargesTotal))} in charges
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders & Items</CardTitle>
        </CardHeader>
        <CardContent>
          {pos.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No purchase orders found</p>
          ) : (
            <div className="space-y-6">
              {pos.map((po: any) => (
                <div key={po.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold" data-testid={`text-po-${po.poNumber}`}>
                      PO: {po.poNumber}
                    </h3>
                    <div className="flex items-center gap-4">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Currency: </span>
                        <span className="font-medium">{po.currency}</span>
                        <span className="text-muted-foreground ml-4">Total: </span>
                        <span className="font-semibold">{formatAmount(po.itemsTotal)}</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation(`/purchase-orders/${po.id}/edit`)}
                        data-testid={`button-edit-po-${po.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeletePO(po.id, po.poNumber)}
                        disabled={deletePOMutation.isPending}
                        data-testid={`button-delete-po-${po.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item Name</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Line Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {po.items.map((item: any) => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="font-medium">{item.itemName}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">{formatAmount(item.rate)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatAmount(item.lineTotal)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {charges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extra Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Charge Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.map((charge: any) => (
                    <TableRow key={charge.id} data-testid={`row-charge-${(charge.chargeType || "").toLowerCase().replace(/\s/g, "-")}`}>
                      <TableCell className="font-medium">{charge.chargeType}</TableCell>
                      <TableCell className={`text-right font-semibold ${parseFloat(charge.amount) < 0 ? "text-red-500" : ""}`}>
                        {formatAmount(charge.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-bold">Total Charges</TableCell>
                    <TableCell className="text-right font-bold">
                      {formatAmount(chargesTotal)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items Total:</span>
              <span className="font-semibold">{formatAmount(itemsTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Charges Total:</span>
              <span className="font-semibold">{formatAmount(chargesTotal)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-lg font-bold">Grand Total:</span>
              <span className="text-lg font-bold">{formatAmount(grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <OffloadDialog
        open={showOffloadDialog}
        onOpenChange={setShowOffloadDialog}
        containerId={parseInt(containerId!)}
        containerNumber={container.containerNumber}
        totalBales={totalBales}
      />

      <Dialog open={showSellDialog} onOpenChange={setShowSellDialog}>
        <DialogContent data-testid="dialog-sell-container">
          <DialogHeader>
            <DialogTitle>Sell Container</DialogTitle>
            <DialogDescription>
              Record the sale of container {container.containerNumber} to a customer.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSellSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-customer">
                          <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id.toString()}>
                            {customer.legalName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="saleDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sale Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-sale-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md border p-4 bg-muted/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">Container Cost</span>
                  <span className="text-lg font-bold">{formatAmount(grandTotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Full balance will be charged to customer
                </p>
              </div>

              <FormField
                control={form.control}
                name="commission"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-commission"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="commissionAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission Account (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-commission-account">
                          <SelectValue placeholder="Default commission account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {incomeAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id.toString()}>
                            {account.name} ({account.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to use default commission revenue account
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowSellDialog(false)}
                  data-testid="button-cancel-sale"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={sellContainerMutation.isPending}
                  data-testid="button-submit-sale"
                >
                  {sellContainerMutation.isPending ? "Processing..." : "Record Sale"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
