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
import type { MixBatch } from "@shared/schema";

const formSchema = z.object({
  mixBatchId: z.string().min(1, "Please select a mix batch"),
  quantity: z.string().refine((val) => {
    const num = parseInt(val);
    return !isNaN(num) && num > 0 && num <= 100;
  }, "Quantity must be between 1 and 100"),
  targetWeight: z.string().refine((val) => {
    const num = parseFloat(val);
    return !isNaN(num) && num > 0 && num <= 500;
  }, "Weight must be between 1 and 500 kg"),
  category: z.string().min(1, "Category is required"),
  grade: z.string().min(1, "Grade is required"),
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

  const activeBatches = mixBatches?.filter(
    (b) => b.status === "IN_PROGRESS" || b.status === "PLANNING"
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      mixBatchId: "",
      quantity: "1",
      targetWeight: "25",
      category: "",
      grade: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const batch = activeBatches?.find(
        (b) => b.id.toString() === data.mixBatchId
      );
      if (!batch) throw new Error("Mix batch not found");

      const quantity = parseInt(data.quantity);
      const weightKg = parseFloat(data.targetWeight);
      const costPerKg = parseFloat(batch.costPerKg);
      const totalCost = (weightKg * costPerKg).toFixed(2);

      const bales = [];
      for (let i = 0; i < quantity; i++) {
        const barcodeResponse = await fetch("/api/production-bales/next-barcode");
        const { barcode } = await barcodeResponse.json();

        bales.push({
          mixBatchId: parseInt(data.mixBatchId),
          baleCode: barcode,
          barcodeValue: barcode,
          category: data.category,
          grade: data.grade,
          weightKg: weightKg.toString(),
          costPerKg: batch.costPerKg,
          totalCost,
          status: "LABEL_PRINTED",
          pressedAt: new Date().toISOString(),
        });
      }

      const response = await apiRequest("POST", "/api/production-bales/bulk", { bales });
      const result = await response.json();
      return result.bales;
    },
    onSuccess: (bales) => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      setCreatedBales(bales);
      setShowPrintPrompt(true);
      toast({
        title: "Success",
        description: `Created ${bales.length} bale(s) successfully`,
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

  const handlePrintLabels = () => {
    toast({
      title: "Print Labels",
      description: "Label printing feature coming soon",
    });
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

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number of Bales *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="1"
                          min="1"
                          max="100"
                          data-testid="input-quantity"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetWeight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Weight (kg) *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="25"
                          step="0.01"
                          min="1"
                          max="500"
                          data-testid="input-target-weight"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., Mixed Clothing"
                          data-testid="input-category"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grade *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="e.g., A, B, C"
                          data-testid="input-grade"
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
