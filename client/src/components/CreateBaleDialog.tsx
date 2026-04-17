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
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { isZebraMode, printRawZpl } from "@/lib/zebraPrint";
import { buildZplBatch } from "@/lib/zplBuilder";
import type { FactoryMixBatch, FactoryBaleProduct, Location } from "@shared/schema";

const formSchema = z.object({
  mixBatchId: z.string().min(1, "Please select a mix batch"),
  productId: z.string().min(1, "Please select a product"),
  locationId: z.string().min(1, "Please select a location"),
  pressDate: z.string().min(1, "Please select a date"),
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

const HMD_LOGO_BASE64 = 'data:image/png;base64,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';

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
        <div class="label-header">
          <div class="logo-area">
            <img class="hmd-logo" src="${HMD_LOGO_BASE64}" alt="HMD" />
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
          * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
          .label-header {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .logo-area {
            flex-shrink: 0;
          }
          .hmd-logo {
            height: 14mm;
            width: auto;
            object-fit: contain;
            display: block;
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
            body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            * { color: #000 !important; }
            .info-label, .info-value, .ref-barcode-number { -webkit-text-stroke: 0.3px #000; }
            .name-label-text { -webkit-text-stroke: 0.7px #000; text-shadow: 0 0 0.5px #000; }
            .ref-barcode-img { filter: contrast(3) brightness(0.9); image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast; }
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
            margin-top: 1mm;
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
          }
          .ref-barcode-img {
            width: 100%;
            height: 13mm;
            object-fit: fill;
          }
          .ref-barcode-number {
            font-size: 13pt;
            font-weight: 900;
            font-family: Arial, Helvetica, sans-serif;
            margin-top: 0.5mm;
            letter-spacing: 2px;
            -webkit-text-stroke: 0.5px #000;
          }
        </style>
      </head>
      <body>
        <div class="print-note">Set printer to BEST quality, max darkness. Disable "Headers and Footers" in print settings.</div>
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
      pressDate: new Date().toLocaleDateString("en-CA"),
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
        txDate: data.pressDate,
      };

      const response = await factoryApiRequest("POST", "/api/factory/bales/create-batch", baleData);
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
      if ((error as any)?._handledGlobally) return;
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

      const labelPrintResponse = await factoryApiRequest("POST", "/api/bale-label-prints", {
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

      if (isZebraMode()) {
        try {
          const zpl = buildZplBatch(labels, dualLabel);
          await printRawZpl(zpl);
          toast({ title: "Labels sent to Zebra printer" });
        } catch (err: any) {
          toast({ title: "Zebra print failed — falling back to browser", description: err.message, variant: "destructive" });
          const printWindow = window.open('', '_blank');
          if (printWindow) {
            printWindow.document.write(generateLabelHtml(labels, dualLabel));
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => printWindow.print(), 500);
          }
        }
      } else {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          toast({ title: "Error", description: "Please allow pop-ups to print labels", variant: "destructive" });
          return;
        }
        printWindow.document.write(generateLabelHtml(labels, dualLabel));
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
      }
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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

              <FormField
                control={form.control}
                name="pressDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pressing Date *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="date"
                        data-testid="input-press-date"
                      />
                    </FormControl>
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
