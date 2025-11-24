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
      const product = activeProducts?.find(
        (p) => p.id.toString() === data.productId
      );
      if (!product) throw new Error("Product not found");

      const baleData = {
        mixBatchId: parseInt(data.mixBatchId),
        productId: parseInt(data.productId),
        locationId: parseInt(data.locationId),
        quantity: data.quantity,
        weightPerBale: data.weightPerBale,
      };

      const response = await apiRequest("POST", "/api/production-bales/create-batch", baleData);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create bales");
      }

      const result = await response.json();
      return { bales: result.bales, product };
    },
    onSuccess: async ({ bales, product }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mix-batches"] });
      
      // Auto-print labels with unique barcodes
      await printBaleLabels(product, bales);
      
      toast({
        title: "Success",
        description: `Created ${bales.length} bale(s) and sent to printer`,
      });
      
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const printBaleLabels = async (product: BaleProduct, bales: any[]) => {
    try {
      // Create printable content with multiple labels (one per bale)
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({
          title: "Error",
          description: "Please allow pop-ups to print labels",
          variant: "destructive",
        });
        return;
      }

      // Generate HTML for all labels with unique barcodes
      let labelsHtml = '';
      for (const bale of bales) {
        // Get barcode image from backend
        const response = await apiRequest("POST", "/api/generate-barcode", {
          text: bale.barcodeValue,
        });
        
        if (!response.ok) {
          throw new Error("Failed to generate barcode");
        }
        
        const { dataUrl } = await response.json();

        labelsHtml += `
          <div class="label">
            <div class="barcode">
              <img src="${dataUrl}" alt="Barcode" />
            </div>
            <div class="barcode-text">${bale.barcodeValue}</div>
          </div>
        `;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>Print Barcode Labels - ${product.code}</title>
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
                width: 8cm;
              }
              .barcode {
                margin: 15px 0;
              }
              .barcode-text {
                font-size: 16px;
                font-weight: bold;
                font-family: monospace;
                margin-top: 10px;
                color: #000;
              }
            </style>
          </head>
          <body>
            ${labelsHtml}
          </body>
        </html>
      `);

      printWindow.document.close();
      printWindow.focus();
      
      // Auto-print after a short delay
      setTimeout(() => {
        printWindow.print();
      }, 250);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate barcode",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    form.reset();
    onOpenChange(false);
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
      </DialogContent>
    </Dialog>
  );
}
