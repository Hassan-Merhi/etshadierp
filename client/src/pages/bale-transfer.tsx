import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";
import { useState } from "react";
import { format } from "date-fns";
import { X, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export default function BaleTransferPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<number | null>(null);
  const [selectedDestLocation, setSelectedDestLocation] = useState<number | null>(null);
  const [transferDate, setTransferDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [selectedBales, setSelectedBales] = useState<Array<any>>([]);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const { data: bales = [] } = useQuery<any[]>({
    queryKey: ["/api/bales-by-location", selectedSourceLocation],
    enabled: selectedSourceLocation !== null && selectedSourceLocation !== undefined,
  });

  const { data: transfers = [] } = useQuery<any[]>({
    queryKey: ["/api/bale-transfers"],
  });

  const createTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/bale-transfers", data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Bale transfer created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bale-transfers"] });
      setSelectedBales([]);
      setNotes("");
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateTransferMutation = useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      return apiRequest("PATCH", `/api/bale-transfers/${id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Bale transfer updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bale-transfers"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddBale = (bale: any) => {
    if (!selectedBales.find(b => b.id === bale.id)) {
      setSelectedBales([...selectedBales, { ...bale, quantity: 1 }]);
    }
  };

  const handleRemoveBale = (baleId: number) => {
    setSelectedBales(selectedBales.filter(b => b.id !== baleId));
  };

  const handleSubmit = () => {
    if (!selectedSourceLocation || !selectedDestLocation || selectedBales.length === 0) {
      toast({ title: "Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }

    createTransferMutation.mutate({
      sourceLocationId: selectedSourceLocation,
      destinationLocationId: selectedDestLocation,
      transferDate,
      notes,
      items: selectedBales.map(b => ({
        productionBaleId: b.id,
        quantity: b.quantity,
        weightKg: b.weightKg,
        costPerKg: b.costPerKg,
        totalCost: b.totalCost,
      })),
    });
  };

  const handleCompleteTransfer = (transferId: number) => {
    updateTransferMutation.mutate({
      id: transferId,
      status: "COMPLETED",
    });
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Bale Transfers" />

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6" data-testid="heading-new-transfer">New Transfer</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label data-testid="label-source-location">Source Location</Label>
              <Select value={selectedSourceLocation?.toString() || ""} onValueChange={(v) => setSelectedSourceLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-source-location">
                  <SelectValue placeholder="Select source location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-source-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label data-testid="label-dest-location">Destination Location</Label>
              <Select value={selectedDestLocation?.toString() || ""} onValueChange={(v) => setSelectedDestLocation(parseInt(v))}>
                <SelectTrigger data-testid="select-dest-location">
                  <SelectValue placeholder="Select destination location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-dest-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label data-testid="label-transfer-date">Transfer Date</Label>
            <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} data-testid="input-transfer-date" />
          </div>

          <div>
            <Label data-testid="label-notes">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" data-testid="input-notes" />
          </div>

          {selectedSourceLocation && (
            <div>
              <Label data-testid="label-available-bales">Available Bales</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto border rounded p-3">
                {bales.map((bale: any) => (
                  <div key={bale.id} className="flex justify-between items-center p-2 bg-gray-50 rounded" data-testid={`bale-item-${bale.id}`}>
                    <span data-testid={`text-bale-code-${bale.id}`}>{bale.baleCode} - {bale.category} ({bale.grade})</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddBale(bale)}
                      data-testid={`button-add-bale-${bale.id}`}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedBales.length > 0 && (
            <div>
              <Label data-testid="label-selected-bales">Selected Bales for Transfer</Label>
              <div className="space-y-2 border rounded p-3">
                {selectedBales.map((bale) => (
                  <div key={bale.id} className="flex justify-between items-center p-2 bg-blue-50 rounded" data-testid={`selected-bale-${bale.id}`}>
                    <div className="flex-1">
                      <p className="font-semibold" data-testid={`text-selected-code-${bale.id}`}>{bale.baleCode}</p>
                      <p className="text-sm text-gray-600" data-testid={`text-bale-details-${bale.id}`}>
                        {bale.category} ({bale.grade}) • {formatNumber(Number(bale.weightKg))} kg
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveBale(bale.id)}
                      data-testid={`button-remove-bale-${bale.id}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleSubmit} disabled={createTransferMutation.isPending} className="w-full" data-testid="button-submit-transfer">
            Create Transfer
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-6" data-testid="heading-recent-transfers">Recent Transfers</h2>
        <div className="space-y-4">
          {transfers.length === 0 ? (
            <p className="text-gray-500" data-testid="text-no-transfers">No transfers yet</p>
          ) : (
            transfers.map((transfer: any) => (
              <div key={transfer.id} className="border rounded p-4" data-testid={`transfer-card-${transfer.id}`}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold" data-testid={`text-transfer-id-${transfer.id}`}>Transfer #{transfer.id}</p>
                    <p className="text-sm text-gray-600" data-testid={`text-transfer-date-${transfer.id}`}>{transfer.transferDate}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded text-sm font-semibold ${
                      transfer.status === "COMPLETED" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                    }`}
                    data-testid={`badge-status-${transfer.id}`}
                  >
                    {transfer.status}
                  </span>
                </div>
                {transfer.status === "PENDING" && (
                  <Button
                    size="sm"
                    onClick={() => handleCompleteTransfer(transfer.id)}
                    disabled={updateTransferMutation.isPending}
                    data-testid={`button-complete-transfer-${transfer.id}`}
                  >
                    Complete Transfer
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
