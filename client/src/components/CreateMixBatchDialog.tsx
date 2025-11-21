import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { insertMixBatchSchema } from "@shared/schema";

const formSchema = insertMixBatchSchema.extend({
  targetCategory: z.string().optional(),
  targetGrade: z.string().optional(),
});

interface CreateMixBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMixBatchDialog({
  open,
  onOpenChange,
}: CreateMixBatchDialogProps) {
  const { toast } = useToast();

  const { data: user } = useQuery<{ username: string }>({
    queryKey: ["/api/auth/me"],
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      batchCode: "",
      targetCategory: "",
      targetGrade: "",
      totalPlannedWeight: "0",
      totalCost: "0",
      costPerKg: "0",
      status: "PLANNING",
      createdBy: user?.username || "unknown",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      const response = await fetch("/api/mix-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create batch");
      }
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mix-batches"] });
      toast({
        title: "Success",
        description: "Mix batch created successfully",
      });
      onOpenChange(false);
      form.reset();
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
    // Auto-calculate cost per kg
    const weight = parseFloat(data.totalPlannedWeight || "0");
    const cost = parseFloat(data.totalCost || "0");
    const costPerKg = weight > 0 ? (cost / weight).toFixed(2) : "0";

    createMutation.mutate({
      ...data,
      costPerKg,
      createdBy: user?.username || "unknown",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Mix Batch</DialogTitle>
          <DialogDescription>
            Create a new mix batch for bale production
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="batchCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Batch Code</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="MB-001"
                        data-testid="input-batch-code"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-batch-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="PLANNING">Planning</SelectItem>
                        <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                        <SelectItem value="COMPLETED">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Category (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., Mixed Clothing"
                        data-testid="input-target-category"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="targetGrade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Grade (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g., A, B, C"
                        data-testid="input-target-grade"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="totalPlannedWeight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Planned Weight (kg)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.001"
                        placeholder="1000"
                        data-testid="input-total-weight"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="totalCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total Cost ($)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        step="0.01"
                        placeholder="5000.00"
                        data-testid="input-total-cost"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="p-4 bg-muted rounded-md">
              <p className="text-sm text-muted-foreground mb-1">
                Calculated Cost per kg
              </p>
              <p className="text-2xl font-bold font-mono">
                $
                {(() => {
                  const weight = parseFloat(form.watch("totalPlannedWeight") || "0");
                  const cost = parseFloat(form.watch("totalCost") || "0");
                  return weight > 0 ? (cost / weight).toFixed(2) : "0.00";
                })()}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="button-submit"
              >
                {createMutation.isPending ? "Creating..." : "Create Batch"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
