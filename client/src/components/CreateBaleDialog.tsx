import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Barcode, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { MixBatch, BaleProduct, Location } from "@shared/schema";

const formSchema = z.object({
  mixBatchId: z.string().min(1, "Please select a mix batch"),
  productId: z.string().min(1, "Please select a product"),
  locationId: z.string().min(1, "Please select a location"),
  quantity: z.string().refine((val) => {
    const num = parseInt(val);
    return !isNaN(num) && num > 0 && num <= 1000;
  }, "Quantity must be between 1 and 1000"),
  weightPerBale: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0 && num <= 500;
  }, "Weight must be between 1 and 500 kg"),
});

interface CreateBaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBaleDialog({
  open,
  onOpenChange,
}: CreateBaleDialogProps) {
  const { toast } = useToast();
  const [createdBales, setCreatedBales] = useState<any[]>([]);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);

  const { data: mixBatches } = useQuery<MixBatch[]>({
    queryKey: ["/api/mix-batches"],
    enabled: open,
  });

  const { data: baleProducts } = useQuery<BaleProduct[]>({
    queryKey: ["/api/bale-products"],
    enabled: open,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const activeBatches = mixBatches?.filter(
    (b) => b.status === "IN_PROGRESS" || b.status === "PLANNING"
  );

  const activeProducts = baleProducts?.filter((p) => p.active);
  const activeLocations = locations?.filter((l) => l.active);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mixBatchId: "",
      productId: "",
      locationId: "",
      quantity: "100",
      weightPerBale: "25",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const batch = activeBatches?.find(
        (b) => b.id.toString() === data.mixBatchId
      );
      if (!batch) throw new Error("Mix batch not found");

      const product = activeProducts?.find(
        (p) => p.id.toString() === data.productId
      );
      if (!product) throw new Error("Product not found");

      const location = activeLocations?.find(
        (l) => l.id.toString() === data.locationId
      );
      if (!location) throw new Error("Location not found");

      const quantity = parseInt(data.quantity);
      const weightPerBale = parseFloat(data.weightPerBale);
      const totalWeight = weightPerBale * quantity;
      const costPerKg = parseFloat(batch.costPerKg);
      const totalCost = (totalWeight * costPerKg).toFixed(2);

      // Create ONE record with quantity, using product code as barcode
      const baleData = {
        mixBatchId: parseInt(data.mixBatchId),
        productId: parseInt(data.productId),
        locationId: parseInt(data.locationId),
        baleCode: product.code,
        barcodeValue: product.code,
        quantity: quantity,
        weightKg: totalWeight.toString(),
        costPerKg: batch.costPerKg,
        totalCost,
        status: "IN_STOCK",
        pressedAt: new Date().toISOString(),
      };

      const response = await apiRequest("POST", "/api/production-bales", baleData);
      const result = await response.json();
      return [result]; // Return as array for compatibility
    },
    onSuccess: (bales) => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      setCreatedBales(bales);
      setShowPrintPrompt(true);
      toast({
        title: "Success",
        description: `Created entry for ${bales[0].quantity} bale(s) successfully`,
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

  const handlePrintLabels = async () => {
    if (createdBales.length === 0) return;
    
    try {
      const bale = createdBales[0];
      const product = activeProducts?.find(p => p.id === bale.productId);
      
      if (!product) {
        toast({
          title: "Error",
          description: "Product information not found",
          variant: "destructive",
        });
        return;
      }

      // Generate barcode using bwip-js
      const bwipjs = await import('bwip-js');
      const canvas = document.createElement('canvas');
      
      bwipjs.toCanvas(canvas, {
        bcid: 'code128',
        text: product.code,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: 'center',
      });

      // Create printable content
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({
          title: "Error",
          description: "Please allow pop-ups to print labels",
          variant: "destructive",
        });
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>Print Barcode Label - ${product.code}</title>
            <style>
              @media print {
                @page { margin: 0; }
                body { margin: 1cm; }
              }
              body {
                font-family: Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 20px;
              }
              .label {
                border: 2px solid #000;
                padding: 20px;
                margin: 10px;
                text-align: center;
                page-break-after: always;
              }
              .product-name {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 10px;
              }
              .product-code {
                font-size: 24px;
                font-weight: bold;
                margin-bottom: 15px;
                font-family: monospace;
              }
              .barcode {
                margin: 15px 0;
              }
              .quantity {
                font-size: 16px;
                margin-top: 10px;
                font-weight: bold;
              }
            </style>
          </head>
          <body>
            <div class="label">
              <div class="product-name">${product.name}</div>
              <div class="product-code">${product.code}</div>
              <div class="barcode">
                <img src="${canvas.toDataURL()}" alt="Barcode" />
              </div>
              <div class="quantity">Quantity: ${bale.quantity} bales</div>
            </div>
          </body>
        </html>
      `);

      printWindow.document.close();
      printWindow.focus();
      
      // Auto-print after a short delay
      setTimeout(() => {
        printWindow.print();
      }, 250);

      toast({
        title: "Print Ready",
        description: "Label is ready to print",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate barcode",
        variant: "destructive",
      });
    }
    
    handleClose();
  };

  const handleContinue = () => {
    setCreatedBales([]);
    setShowPrintPrompt(false);
    form.reset();
  };

  const handleClose = () => {
    onOpenChange(false);
    setCreatedBales([]);
    setShowPrintPrompt(false);
    form.reset();
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Production Bales</DialogTitle>
          <DialogDescription>
            Select a mix batch and specify how many bales to create
          </DialogDescription>
        </DialogHeader>

        {showPrintPrompt ? (
          <div className="space-y-6">
            <div className="bg-muted p-4 rounded-md">
              <h3 className="font-semibold mb-2">
                Created {createdBales.length} bale(s)
              </h3>
              <div className="space-y-1">
                {createdBales.slice(0, 5).map((bale: any) => (
                  <div key={bale.id} className="flex items-center gap-2 text-sm font-mono">
                    <Barcode className="h-4 w-4" />
                    {bale.barcodeValue}
                  </div>
                ))}
                {createdBales.length > 5 && (
                  <p className="text-sm text-muted-foreground">
                    ...and {createdBales.length - 5} more
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleContinue}
                data-testid="button-continue"
              >
                Create More Bales
              </Button>
              <Button
                type="button"
                onClick={handlePrintLabels}
                data-testid="button-print-labels"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print Labels
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="mixBatchId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mix Batch *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-mix-batch">
                          <SelectValue placeholder="Select mix batch" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeBatches?.map((batch) => (
                          <SelectItem
                            key={batch.id}
                            value={batch.id.toString()}
                          >
                            {batch.batchCode} - {parseFloat(batch.totalPlannedWeight).toLocaleString()} kg @ ${parseFloat(batch.costPerKg).toFixed(4)}/kg
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
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Type *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-product">
                          <SelectValue placeholder="Select product type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeProducts?.map((product) => (
                          <SelectItem
                            key={product.id}
                            value={product.id.toString()}
                          >
                            {product.code} - {product.name}
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
                name="locationId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warehouse Location *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-location">
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeLocations?.map((location) => (
                          <SelectItem
                            key={location.id}
                            value={location.id.toString()}
                          >
                            {location.code} - {location.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity (Number of Bales) *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="100"
                          min="1"
                          max="1000"
                          data-testid="input-quantity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="weightPerBale"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight per Bale (kg) *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="25"
                          step="0.01"
                          min="1"
                          max="500"
                          data-testid="input-weight-per-bale"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending ? "Creating..." : "Create Bales"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
