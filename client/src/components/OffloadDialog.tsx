import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, X } from "lucide-react";
import type { Location } from "@shared/schema";

interface OffloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerId: number;
  containerNumber: string;
  totalBales: number;
}

interface AdditionalCharge {
  id: string;
  description: string;
  amount: string;
  supplierId: string;
}

export function OffloadDialog({
  open,
  onOpenChange,
  containerId,
  containerNumber,
  totalBales,
}: OffloadDialogProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [duties, setDuties] = useState("0");
  const [dutiesAccountId, setDutiesAccountId] = useState("");
  const [officeCharges, setOfficeCharges] = useState("0");
  const [transferCharges, setTransferCharges] = useState("0");
  const [transportFees, setTransportFees] = useState("0");
  const [transportAccountId, setTransportAccountId] = useState("");
  const [additionalCharges, setAdditionalCharges] = useState<AdditionalCharge[]>([]);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: suppliers = [] } = useQuery<any[]>({
    queryKey: ["/api/suppliers"],
  });

  const totalCharges =
    parseFloat(duties || "0") +
    parseFloat(officeCharges || "0") +
    parseFloat(transferCharges || "0") +
    parseFloat(transportFees || "0") +
    additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || "0"), 0);

  const additionalCostPerBale = totalBales > 0 ? totalCharges / totalBales : 0;

  const handleAddCharge = () => {
    setAdditionalCharges([
      ...additionalCharges,
      {
        id: Date.now().toString(),
        description: "",
        amount: "0",
        supplierId: "",
      },
    ]);
  };

  const handleRemoveCharge = (id: string) => {
    setAdditionalCharges(additionalCharges.filter((charge) => charge.id !== id));
  };

  const handleUpdateCharge = (id: string, field: keyof AdditionalCharge, value: string) => {
    setAdditionalCharges(
      additionalCharges.map((charge) =>
        charge.id === id ? { ...charge, [field]: value } : charge
      )
    );
  };

  const offloadMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) {
        throw new Error("Please select a location");
      }

      // Validate duties account if duties amount is set
      if (parseFloat(duties) > 0 && !dutiesAccountId) {
        throw new Error("Please select an account for duties");
      }

      // Validate transport account if transport fees are set
      if (parseFloat(transportFees) > 0 && !transportAccountId) {
        throw new Error("Please select an account for transport fees");
      }

      // Validate additional charges
      for (const charge of additionalCharges) {
        if (parseFloat(charge.amount) > 0) {
          if (!charge.description) {
            throw new Error("Please provide a description for all additional charges");
          }
          if (!charge.supplierId) {
            throw new Error("Please select an account for all additional charges");
          }
        }
      }

      const response = await apiRequest(
        "POST",
        `/api/containers/${containerId}/offload`,
        {
          locationId,
          duties: parseFloat(duties),
          dutiesAccountId: dutiesAccountId ? parseInt(dutiesAccountId) : null,
          officeCharges: parseFloat(officeCharges),
          transferCharges: parseFloat(transferCharges),
          transportFees: parseFloat(transportFees),
          transportAccountId: transportAccountId ? parseInt(transportAccountId) : null,
          additionalCharges: additionalCharges
            .filter((charge) => parseFloat(charge.amount) > 0)
            .map((charge) => ({
              description: charge.description,
              amount: parseFloat(charge.amount),
              supplierId: parseInt(charge.supplierId),
            })),
        }
      );
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/containers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/containers/${containerId}`] });
      toast({
        title: "Container offloaded successfully",
        description: `Container ${containerNumber} has been offloaded to the selected location.`,
      });
      onOpenChange(false);
      setLocation("/containers");
    },
    onError: (error: Error) => {
      toast({
        title: "Offload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    offloadMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Offload Container {containerNumber}</DialogTitle>
          <DialogDescription>
            Enter the offload charges, select accounts, and choose a destination location. The additional cost per bale will be calculated and added to each item's rate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Duties Section */}
          <div className="space-y-2">
            <Label>Duties</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={duties}
                onChange={(e) => setDuties(e.target.value)}
                data-testid="input-duties"
              />
              <Select
                value={dutiesAccountId}
                onValueChange={setDutiesAccountId}
                disabled={parseFloat(duties) === 0}
              >
                <SelectTrigger data-testid="select-duties-account">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier: any) => (
                    <SelectItem key={supplier.id} value={supplier.id.toString()}>
                      {supplier.legalName} ({supplier.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Office Charges */}
          <div className="space-y-2">
            <Label htmlFor="office-charges">Office Charges</Label>
            <Input
              id="office-charges"
              type="number"
              step="0.01"
              min="0"
              value={officeCharges}
              onChange={(e) => setOfficeCharges(e.target.value)}
              data-testid="input-office-charges"
            />
          </div>

          {/* Transfer Charges */}
          <div className="space-y-2">
            <Label htmlFor="transfer-charges">Transfer Charges</Label>
            <Input
              id="transfer-charges"
              type="number"
              step="0.01"
              min="0"
              value={transferCharges}
              onChange={(e) => setTransferCharges(e.target.value)}
              data-testid="input-transfer-charges"
            />
          </div>

          {/* Transport Fees Section */}
          <div className="space-y-2">
            <Label>Transport Fees</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Amount"
                value={transportFees}
                onChange={(e) => setTransportFees(e.target.value)}
                data-testid="input-transport-fees"
              />
              <Select
                value={transportAccountId}
                onValueChange={setTransportAccountId}
                disabled={parseFloat(transportFees) === 0}
              >
                <SelectTrigger data-testid="select-transport-account">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier: any) => (
                    <SelectItem key={supplier.id} value={supplier.id.toString()}>
                      {supplier.legalName} ({supplier.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Additional Charges Section */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
              <Label>Additional Charges (Optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCharge}
                className="gap-2"
                data-testid="button-add-charge"
              >
                <Plus className="h-4 w-4" />
                Add Charge
              </Button>
            </div>
            {additionalCharges.length > 0 && (
              <div className="space-y-2">
                {additionalCharges.map((charge) => (
                  <div key={charge.id} className="grid grid-cols-12 gap-2 items-start">
                    <Input
                      placeholder="Description"
                      value={charge.description}
                      onChange={(e) =>
                        handleUpdateCharge(charge.id, "description", e.target.value)
                      }
                      className="col-span-4"
                      data-testid={`input-charge-description-${charge.id}`}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Amount"
                      value={charge.amount}
                      onChange={(e) => handleUpdateCharge(charge.id, "amount", e.target.value)}
                      className="col-span-3"
                      data-testid={`input-charge-amount-${charge.id}`}
                    />
                    <div className="col-span-4">
                      <Select
                        value={charge.supplierId}
                        onValueChange={(value) =>
                          handleUpdateCharge(charge.id, "supplierId", value)
                        }
                      >
                        <SelectTrigger data-testid={`select-charge-account-${charge.id}`}>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers.map((supplier: any) => (
                            <SelectItem key={supplier.id} value={supplier.id.toString()}>
                              {supplier.legalName} ({supplier.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCharge(charge.id)}
                      className="col-span-1"
                      data-testid={`button-remove-charge-${charge.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Destination Location */}
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="location">Destination Location</Label>
            <Select
              value={locationId?.toString()}
              onValueChange={(value) => setLocationId(parseInt(value))}
            >
              <SelectTrigger data-testid="select-location">
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem
                    key={location.id}
                    value={location.id.toString()}
                    data-testid={`select-location-${location.id}`}
                  >
                    {location.name} ({location.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Calculation Summary */}
          <div className="rounded-md border p-4 space-y-2 bg-muted/50">
            <h4 className="font-semibold text-sm">Calculation Summary</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Charges:</span>
                <span className="font-medium" data-testid="text-total-charges">
                  ${totalCharges.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bales:</span>
                <span className="font-medium" data-testid="text-total-bales">
                  {totalBales.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between col-span-2 pt-2 border-t">
                <span className="text-muted-foreground">Additional Cost per Bale:</span>
                <span className="font-semibold" data-testid="text-cost-per-bale">
                  ${additionalCostPerBale.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={offloadMutation.isPending}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={offloadMutation.isPending || !locationId}
              data-testid="button-offload"
            >
              {offloadMutation.isPending ? "Offloading..." : "Offload Container"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
