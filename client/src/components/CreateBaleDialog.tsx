import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Barcode, Printer, ToggleLeft } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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

function generateLabelHtml(labels: Array<{
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
}>, dualLabel: boolean) {
  let labelsHtml = '';
  for (const label of labels) {
    if (dualLabel) {
      labelsHtml += `
        <div class="page-container">
          <div class="label">
            <div class="label-top">
              <div class="logo-section">
                <div class="logo-text">HMD</div>
                <div class="logo-subtitle">INTERNATIONAL GROUP</div>
              </div>
              <div class="info-section">
                <div class="info-row"><span class="info-label">PIECES:</span> <span class="info-value">${label.pieces}</span></div>
                <div class="info-row"><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
                <div class="info-row"><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${label.approxWeightKg} KGS</span></div>
              </div>
            </div>
            <div class="barcode-section">
              <div class="barcode-label">REFERENCE</div>
              <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Reference Barcode" />
              <div class="barcode-text">${label.referenceNumber}</div>
            </div>
            <div class="barcode-section">
              <div class="barcode-label">ARTICLE</div>
              <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
              <div class="barcode-text">${label.productName}</div>
            </div>
          </div>
          <div class="label label-rotated">
            <div class="name-label-content">
              <div class="name-label-title">${label.productName}</div>
              <div class="name-label-code">${label.articleCode}</div>
              <div class="barcode-section">
                <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      labelsHtml += `
        <div class="label">
          <div class="label-top">
            <div class="logo-section">
              <div class="logo-text">HMD</div>
              <div class="logo-subtitle">INTERNATIONAL GROUP</div>
            </div>
            <div class="info-section">
              <div class="info-row"><span class="info-label">PIECES:</span> <span class="info-value">${label.pieces}</span></div>
              <div class="info-row"><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
              <div class="info-row"><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${label.approxWeightKg} KGS</span></div>
            </div>
          </div>
          <div class="barcode-section">
            <div class="barcode-label">REFERENCE</div>
            <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="Reference Barcode" />
            <div class="barcode-text">${label.referenceNumber}</div>
          </div>
          <div class="barcode-section">
            <div class="barcode-label">ARTICLE</div>
            <img class="barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
            <div class="barcode-text">${label.productName}</div>
          </div>
        </div>
      `;
    }
  }

  const pageHeight = dualLabel ? '100mm' : '50mm';

  return `
    <html>
      <head>
        <title>Print Bale Labels</title>
        <style>
          @page {
            size: 76.2mm ${pageHeight};
            margin: 0;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            padding: 0;
          }
          .page-container {
            width: 76.2mm;
            height: 100mm;
            page-break-after: always;
            overflow: hidden;
          }
          .page-container:last-child {
            page-break-after: auto;
          }
          .label {
            width: 76.2mm;
            height: 50mm;
            padding: 2mm 3mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
          }
          .label:not(.label-rotated):last-child {
            page-break-after: auto;
          }
          .label:not(.label-rotated) {
            page-break-after: always;
          }
          .page-container .label {
            page-break-after: auto;
          }
          .label-rotated {
            transform: rotate(180deg);
            justify-content: center;
            align-items: center;
          }
          .name-label-content {
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2mm;
            width: 100%;
          }
          .name-label-title {
            font-size: 14pt;
            font-weight: 900;
            color: #000;
            text-transform: uppercase;
            letter-spacing: 1px;
            line-height: 1.2;
          }
          .name-label-code {
            font-size: 10pt;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            color: #333;
          }
          .label-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1mm;
          }
          .logo-section {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
          }
          .logo-text {
            font-size: 14pt;
            font-weight: 900;
            letter-spacing: 2px;
            color: #000;
            line-height: 1;
          }
          .logo-subtitle {
            font-size: 5pt;
            font-weight: 600;
            letter-spacing: 1px;
            color: #333;
            margin-top: 0.5mm;
          }
          .info-section {
            text-align: right;
            font-size: 6.5pt;
            line-height: 1.4;
          }
          .info-label {
            font-weight: 700;
          }
          .info-value {
            font-weight: 400;
          }
          .barcode-section {
            text-align: center;
            margin-bottom: 0.5mm;
          }
          .barcode-label {
            font-size: 5pt;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #555;
            margin-bottom: 0.5mm;
          }
          .barcode-img {
            width: 58mm;
            height: 10mm;
            object-fit: contain;
          }
          .barcode-text {
            font-size: 7pt;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            margin-top: 0.3mm;
            color: #000;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
      </body>
    </html>
  `;
}

export function CreateBaleDialog({
  open,
  onOpenChange,
}: CreateBaleDialogProps) {
  const { toast } = useToast();
  const [dualLabel, setDualLabel] = useState(true);

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
      return { bales: result.bales, product, weightPerBale: data.weightPerBale };
    },
    onSuccess: async ({ bales, product, weightPerBale }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/mix-batches"] });

      await printBaleLabels(product, bales, weightPerBale);

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

  const printBaleLabels = async (product: BaleProduct, bales: any[], weightPerBale: string) => {
    try {
      const articleCode = product.articleCode || product.code;

      const labelPrintResponse = await apiRequest("POST", "/api/bale-label-prints", {
        bales: bales.map((bale: any) => ({
          productionBaleId: bale.id,
          productId: product.id,
          articleCode,
          pieces: 1,
          approxWeightKg: weightPerBale,
        })),
      });

      if (!labelPrintResponse.ok) {
        const err = await labelPrintResponse.json();
        throw new Error(err.message || "Failed to create label print records");
      }

      const { labelPrints } = await labelPrintResponse.json();

      const labels = labelPrints.map((lp: any) => ({
        referenceNumber: lp.referenceNumber,
        articleCode: lp.articleCode,
        pieces: lp.pieces,
        approxWeightKg: lp.approxWeightKg,
        productName: product.name,
      }));

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({
          title: "Error",
          description: "Please allow pop-ups to print labels",
          variant: "destructive",
        });
        return;
      }

      printWindow.document.write(generateLabelHtml(labels, dualLabel));
      printWindow.document.close();
      printWindow.focus();

      setTimeout(() => {
        printWindow.print();
      }, 500);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate labels",
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
                            {product.code} - {product.name} {product.articleCode ? `(${product.articleCode})` : ''}
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

              <div className="flex items-center gap-3 rounded-md border p-3">
                <Switch
                  id="dual-label-toggle"
                  checked={dualLabel}
                  onCheckedChange={setDualLabel}
                  data-testid="switch-dual-label"
                />
                <Label htmlFor="dual-label-toggle" className="flex flex-col gap-0.5 cursor-pointer">
                  <span className="text-sm font-medium">Print dual labels (full + name)</span>
                  <span className="text-xs text-muted-foreground">
                    {dualLabel ? "Prints two labels per bale: full HMD label on top, rotated name label on bottom" : "Prints single full HMD label per bale"}
                  </span>
                </Label>
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
