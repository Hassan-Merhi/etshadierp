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
import type { Location } from "@shared/schema";

interface OffloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containerId: number;
  containerNumber: string;
  totalBales: number;
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
  const [officeCharges, setOfficeCharges] = useState("0");
  const [transferCharges, setTransferCharges] = useState("0");
  const [transportFees, setTransportFees] = useState("0");

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const totalCharges =
    parseFloat(duties || "0") +
    parseFloat(officeCharges || "0") +
    parseFloat(transferCharges || "0") +
    parseFloat(transportFees || "0");

  const additionalCostPerBale = totalBales > 0 ? totalCharges / totalBales : 0;

  const offloadMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) {
        throw new Error("Please select a location");
      }

      const response = await apiRequest(
        "POST",
        `/api/containers/${containerId}/offload`,
        {
          locationId,
          duties,
          officeCharges,
          transferCharges,
          transportFees,
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Offload Container {containerNumber}</DialogTitle>
          <DialogDescription>
            Enter the offload charges and select a destination location. The additional cost per bale will be calculated and added to each item's rate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="duties">Duties</Label>
              <Input
                id="duties"
                type="number"
                step="0.01"
                min="0"
                value={duties}
                onChange={(e) => setDuties(e.target.value)}
                data-testid="input-duties"
              />
            </div>

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

            <div className="space-y-2">
              <Label htmlFor="transport-fees">Transport Fees</Label>
              <Input
                id="transport-fees"
                type="number"
                step="0.01"
                min="0"
                value={transportFees}
                onChange={(e) => setTransportFees(e.target.value)}
                data-testid="input-transport-fees"
              />
            </div>
          </div>

          <div className="space-y-2">
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
