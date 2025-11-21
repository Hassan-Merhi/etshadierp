import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { insertMixBatchSchema } from "@shared/schema";

const formSchema = insertMixBatchSchema.omit({
  companyId: true,
  createdBy: true,
}).extend({
  targetCategory: z.string().optional(),
  targetGrade: z.string().optional(),
});

interface ContainerSelection {
  containerId: number;
  containerNumber: string;
  weightKg: number;
  costPerKg: number;
  totalCost: number;
}

interface CreateMixBatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMixBatchDialog({
  open,
  onOpenChange,
}: CreateMixBatchDialogProps) {
  const { toast } = useToast();
  const [selectedContainers, setSelectedContainers] = useState<ContainerSelection[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string>("");
  const [weightInput, setWeightInput] = useState<string>("");
  const [costPerKgInput, setCostPerKgInput] = useState<string>("");

  const { data: containers } = useQuery<any[]>({
    queryKey: ["/api/containers"],
    enabled: open,
  });

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
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof formSchema>) => {
      // Prepare sources payload
      const sources = selectedContainers.map(selection => ({
        containerId: selection.containerId,
        weightKg: selection.weightKg.toString(),
        costPerKg: selection.costPerKg.toString(),
        totalCost: selection.totalCost.toString(),
      }));

      // Create batch with sources in one request
      const response = await fetch("/api/mix-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          sources, // Include sources in the payload
        }),
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
      setSelectedContainers([]);
      setSelectedContainerId("");
      setWeightInput("");
      setCostPerKgInput("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const availableContainers = containers?.filter(
    (c) =>
      c.status === "AVAILABLE" &&
      !selectedContainers.some((s) => s.containerId === c.id)
  );

  const handleContainerSelect = (containerId: string) => {
    setSelectedContainerId(containerId);
    
    // Auto-populate cost/kg from container if available
    const container = containers?.find((c) => c.id.toString() === containerId);
    if (container?.ratePerKg) {
      setCostPerKgInput(container.ratePerKg);
    }
  };

  const handleAddContainer = () => {
    if (!selectedContainerId || !weightInput || !costPerKgInput) {
      toast({
        title: "Missing information",
        description: "Please select a container and enter weight and cost/kg",
        variant: "destructive",
      });
      return;
    }

    const container = containers?.find(
      (c) => c.id.toString() === selectedContainerId
    );
    
    if (!container) return;

    const weight = parseFloat(weightInput);
    const costPerKg = parseFloat(costPerKgInput);
    
    if (isNaN(weight) || weight <= 0) {
      toast({
        title: "Invalid weight",
        description: "Please enter a valid weight greater than 0",
        variant: "destructive",
      });
      return;
    }

    if (isNaN(costPerKg) || costPerKg <= 0) {
      toast({
        title: "Invalid cost",
        description: "Please enter a valid cost per kg greater than 0",
        variant: "destructive",
      });
      return;
    }

    const totalCost = weight * costPerKg;

    const newSelection: ContainerSelection = {
      containerId: container.id,
      containerNumber: container.containerNumber,
      weightKg: weight,
      costPerKg: costPerKg,
      totalCost: totalCost,
    };

    const updated = [...selectedContainers, newSelection];
    setSelectedContainers(updated);
    setSelectedContainerId("");
    setWeightInput("");
    setCostPerKgInput("");

    // Recalculate totals
    calculateTotals(updated);
  };

  const handleRemoveContainer = (containerId: number) => {
    const updated = selectedContainers.filter(
      (s) => s.containerId !== containerId
    );
    setSelectedContainers(updated);
    calculateTotals(updated);
  };

  const calculateTotals = (selections: ContainerSelection[]) => {
    const totalWeight = selections.reduce((sum, s) => sum + s.weightKg, 0);
    const totalCost = selections.reduce((sum, s) => sum + s.totalCost, 0);
    const blendedCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

    form.setValue("totalPlannedWeight", totalWeight.toFixed(3));
    form.setValue("totalCost", totalCost.toFixed(2));
    form.setValue("costPerKg", blendedCostPerKg.toFixed(4));
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log("Form submitted with data:", data);
    console.log("Form errors:", form.formState.errors);
    console.log("Selected containers:", selectedContainers);
    
    if (selectedContainers.length === 0) {
      toast({
        title: "No containers selected",
        description: "Please add at least one container to the batch",
        variant: "destructive",
      });
      return;
    }

    createMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Mix Batch</DialogTitle>
          <DialogDescription>
            Select containers and specify how many kg to use from each. The system will calculate the blended cost per kg automatically.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="batchCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Batch Code *</FormLabel>
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
            </div>

            <div className="space-y-4">
              <h3 className="font-medium">Add Containers to Batch</h3>
              <div className="grid grid-cols-4 gap-2">
                <Select
                  value={selectedContainerId}
                  onValueChange={handleContainerSelect}
                >
                  <SelectTrigger className="col-span-1" data-testid="select-container">
                    <SelectValue placeholder="Select container" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableContainers?.map((container) => (
                      <SelectItem
                        key={container.id}
                        value={container.id.toString()}
                      >
                        {container.containerNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Input
                  type="number"
                  placeholder="Weight (kg)"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  step="0.001"
                  data-testid="input-container-weight"
                />
                
                <Input
                  type="number"
                  placeholder="Cost/kg ($)"
                  value={costPerKgInput}
                  onChange={(e) => setCostPerKgInput(e.target.value)}
                  step="0.01"
                  data-testid="input-cost-per-kg"
                />
                
                <Button
                  type="button"
                  onClick={handleAddContainer}
                  disabled={!selectedContainerId || !weightInput || !costPerKgInput}
                  data-testid="button-add-container"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>
              
              <p className="text-sm text-muted-foreground">
                Enter the weight (kg) you want to use from this container and the cost per kg (e.g., $0.36 or $0.44)
              </p>
            </div>

            {selectedContainers.length > 0 && (
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Container</TableHead>
                      <TableHead className="text-right">Weight (kg)</TableHead>
                      <TableHead className="text-right">Cost/kg</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedContainers.map((selection) => (
                      <TableRow key={selection.containerId}>
                        <TableCell className="font-medium">
                          {selection.containerNumber}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {selection.weightKg.toLocaleString(undefined, {
                            minimumFractionDigits: 3,
                            maximumFractionDigits: 3,
                          })}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${selection.costPerKg.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${selection.totalCost.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveContainer(selection.containerId)}
                            data-testid={`button-remove-${selection.containerId}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-md">
              <div>
                <p className="text-sm text-muted-foreground">Total Weight</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-total-weight">
                  {parseFloat(form.watch("totalPlannedWeight") || "0").toLocaleString()} kg
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Cost</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-total-cost">
                  ${parseFloat(form.watch("totalCost") || "0").toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Blended Cost/kg</p>
                <p className="text-2xl font-bold font-mono" data-testid="text-cost-per-kg">
                  ${parseFloat(form.watch("costPerKg") || "0").toFixed(4)}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  setSelectedContainers([]);
                  form.reset();
                }}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || selectedContainers.length === 0}
                onClick={(e) => {
                  console.log("Create Batch button clicked, containers:", selectedContainers.length);
                  console.log("Form values:", form.getValues());
                  console.log("Form errors:", form.formState.errors);
                }}
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
