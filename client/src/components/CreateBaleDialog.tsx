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
import type { FactoryMixBatch, FactoryBaleProduct, Location } from "@shared/schema";

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

function formatLabelNum(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? n.toFixed(0) : parseFloat(n.toFixed(3)).toString();
}

function generateFullLabelHtml(label: {
  referenceNumber: string;
  articleCode: string;
  pieces: number;
  approxWeightKg: string;
  productName: string;
}) {
  return `
    <div class="label">
      <div class="label-content">
        <div class="label-top">
          <div class="logo-section">
            <img class="logo-img" src="/hmd-logo.jpeg" alt="HMD" />
          </div>
          <div class="info-section">
            <div class="info-row"><span class="info-label">PIECES:</span> <span class="info-value">${formatLabelNum(label.pieces)}</span></div>
            <div class="info-row"><span class="info-label">ARTICLE:</span> <span class="info-value">${label.articleCode}</span></div>
            <div class="info-row"><span class="info-label">APRX WEIGHT:</span> <span class="info-value">${formatLabelNum(label.approxWeightKg)} KGS</span></div>
          </div>
        </div>
        <div class="ref-barcode-section">
          <img class="ref-barcode-img" src="/api/barcode/${encodeURIComponent(label.referenceNumber)}" alt="REF Barcode" />
          <div class="ref-barcode-number">${label.referenceNumber}</div>
        </div>
        <div class="article-barcode-section">
          <img class="article-barcode-img" src="/api/barcode/${encodeURIComponent(label.articleCode)}" alt="Article Barcode" />
        </div>
        <div class="product-name-section">
          <div class="product-name-text">${label.productName}</div>
        </div>
      </div>
    </div>`;
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
    const fullLabel = generateFullLabelHtml(label);

    if (dualLabel) {
      labelsHtml += `
        <div class="page-container">
          ${fullLabel}
          <div class="label name-label">
            <div class="name-label-content">
              <div class="name-label-text">${label.productName}</div>
            </div>
          </div>
        </div>`;
    } else {
      labelsHtml += `
        <div class="single-page">
          ${fullLabel}
        </div>`;
    }
  }

  const pageSize = dualLabel ? 'size: 3in 3.94in;' : 'size: 3in 1.97in;';

  return `
    <html>
      <head>
        <title></title>
        <style>
          @page {
            ${pageSize}
            margin: 0;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            margin: 0;
            padding: 0;
          }
          .page-container {
            width: 3in;
            height: 3.94in;
            page-break-after: always;
            page-break-inside: avoid;
            break-inside: avoid;
            overflow: hidden;
          }
          .page-container:last-child {
            page-break-after: auto;
          }
          .single-page {
            width: 3in;
            height: 1.97in;
            page-break-after: always;
            page-break-inside: avoid;
            break-inside: avoid;
            overflow: hidden;
          }
          .single-page:last-child {
            page-break-after: auto;
          }
          .label {
            width: 3in;
            height: 1.97in;
            padding: 2mm 3mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
            position: relative;
            background: #fff;
          }
          .label-content {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: 100%;
          }
          .name-label {
            justify-content: center;
            align-items: center;
          }
          .name-label-content {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100%;
            gap: 1mm;
          }
          .name-barcode-img {
            width: 60mm;
            height: 12mm;
            object-fit: contain;
          }
          .name-label-text {
            font-size: 16pt;
            font-weight: 900;
            color: #000;
            text-align: center;
            line-height: 1.15;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
            overflow: hidden;
            max-width: 100%;
            display: block;
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
          .logo-img {
            height: 10mm;
            width: auto;
            object-fit: contain;
          }
          .print-note {
            text-align: center;
            font-size: 9pt;
            color: #666;
            padding: 4px;
            background: #fffbe6;
            border-bottom: 1px solid #eee;
          }
          @media print {
            .print-note { display: none !important; }
            header, .print-header, .page-header { display: none !important; }
            body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; filter: contrast(10); }
          }
          .info-section {
            text-align: right;
            font-size: 9pt;
            line-height: 1.5;
          }
          .info-label {
            font-weight: 900;
          }
          .info-value {
            font-weight: 900;
          }
          .ref-barcode-section {
            text-align: center;
            margin-top: 0.5mm;
          }
          .ref-barcode-img {
            width: 60mm;
            height: 10mm;
            object-fit: contain;
          }
          .ref-barcode-number {
            font-size: 6pt;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            margin-top: 0.2mm;
            letter-spacing: 1px;
          }
          .article-barcode-section {
            text-align: center;
            margin-top: 0.3mm;
          }
          .article-barcode-img {
            width: 45mm;
            height: 7mm;
            object-fit: contain;
          }
          .product-name-section {
            text-align: center;
            margin-top: 0.3mm;
            border-top: 0.3mm dashed #ccc;
            padding-top: 0.5mm;
          }
          .product-name-text {
            font-size: 11pt;
            font-weight: 900;
            font-family: Arial, Helvetica, sans-serif;
            color: #000;
            text-transform: uppercase;
            word-break: break-word;
          }
        </style>
      </head>
      <body>
        <div class="print-note">Laser print - max darkness. Disable "Headers and Footers" in print settings.</div>
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

  const { data: mixBatches } = useQuery<FactoryMixBatch[]>({
    queryKey: ["/api/factory/mix-batches"],
    enabled: open,
  });

  const { data: baleProducts } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
    enabled: open,
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  const activeBatches = mixBatches?.filter(
    (b) => b.status === "ACTIVE"
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

      const response = await apiRequest("POST", "/api/factory/bales/create-batch", baleData);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create bales");
      }

      const result = await response.json();
      return { bales: result.bales, product, weightPerBale: data.weightPerBale };
    },
    onSuccess: async ({ bales, product, weightPerBale }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });

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

  const printBaleLabels = async (product: FactoryBaleProduct, bales: any[], weightPerBale: string) => {
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
                            {batch.batchCode} - {parseFloat(batch.totalWeightKg).toLocaleString()} kg @ ${parseFloat(batch.costPerKg).toFixed(4)}/kg
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
                            {product.articleCode || product.code} - {product.name}
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
                  <span className="text-sm font-medium">Print name label too</span>
                  <span className="text-xs text-muted-foreground">
                    {dualLabel ? "Two stickers per bale: full HMD label + name label with barcode" : "Single full HMD label per bale"}
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
