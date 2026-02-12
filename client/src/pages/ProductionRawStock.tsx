import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Container, Package, Plus, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatNumber";

interface RawStockRow {
  id: number;
  companyId: number;
  containerId: number;
  receivedKg: string;
  usedKg: string;
  costPerKg: string;
  offloadedAt: string;
  containerNumber: string;
  supplierId: number;
  supplierName: string | null;
  remainingKg: string;
  valueRemaining: string;
}

interface ContainerOption {
  id: number;
  containerNumber: string;
  totalKg: string | null;
  ratePerKg: string | null;
}

export default function ProductionRawStock() {
  const [offloadDialogOpen, setOffloadDialogOpen] = useState(false);
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [receivedKg, setReceivedKg] = useState("");
  const [costPerKg, setCostPerKg] = useState("");
  const { toast } = useToast();

  const { data: rawStock, isLoading } = useQuery<RawStockRow[]>({
    queryKey: ["/api/factory/raw-stock"],
  });

  const { data: availableContainers } = useQuery<ContainerOption[]>({
    queryKey: ["/api/factory/raw-stock/available-containers"],
    enabled: offloadDialogOpen,
  });

  const offloadMutation = useMutation({
    mutationFn: async (data: { containerId: string; receivedKg: string; costPerKg: string }) => {
      const response = await apiRequest("POST", "/api/factory/raw-stock/offload", data);
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Failed to offload container");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/available-containers"] });
      toast({ title: "Success", description: "Container offloaded to production raw stock" });
      handleCloseDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleContainerSelect = (id: string) => {
    setSelectedContainerId(id);
    const container = availableContainers?.find((c) => c.id.toString() === id);
    setReceivedKg(container?.totalKg || "");
    setCostPerKg(container?.ratePerKg || "");
  };

  const handleOffload = () => {
    if (!selectedContainerId) {
      toast({ title: "Missing fields", description: "Please select a container", variant: "destructive" });
      return;
    }
    const container = availableContainers?.find((c) => c.id.toString() === selectedContainerId);
    const finalReceivedKg = receivedKg || container?.totalKg || "";
    const finalCostPerKg = costPerKg || container?.ratePerKg || "";
    if (!finalReceivedKg) {
      toast({ title: "Missing weight", description: "This container has no saved Total KG. Please enter the received weight to offload.", variant: "destructive" });
      return;
    }
    if (!finalCostPerKg) {
      toast({ title: "Missing cost", description: "This container has no saved Rate per KG. Please enter the cost per kg to offload.", variant: "destructive" });
      return;
    }
    offloadMutation.mutate({ containerId: selectedContainerId, receivedKg: finalReceivedKg, costPerKg: finalCostPerKg });
  };

  const handleCloseDialog = () => {
    setOffloadDialogOpen(false);
    setSelectedContainerId("");
    setReceivedKg("");
    setCostPerKg("");
  };

  const totalReceived = rawStock?.reduce((sum, r) => sum + parseFloat(r.receivedKg), 0) || 0;
  const totalUsed = rawStock?.reduce((sum, r) => sum + parseFloat(r.usedKg), 0) || 0;
  const totalRemaining = rawStock?.reduce((sum, r) => sum + parseFloat(r.remainingKg), 0) || 0;
  const totalValue = rawStock?.reduce((sum, r) => sum + parseFloat(r.valueRemaining), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Production Raw Stock</h1>
          <p className="text-muted-foreground mt-1">Container-led raw material tracking for production</p>
        </div>
        <Button onClick={() => setOffloadDialogOpen(true)} data-testid="button-offload-container">
          <ArrowDown className="h-4 w-4 mr-2" />
          Offload Container
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Received</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-received">
              {formatNumber(totalReceived)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Used</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-used">
              {formatNumber(totalUsed)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Remaining</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-remaining">
              {formatNumber(totalRemaining)} kg
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Value</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-value">
              ${formatNumber(totalValue)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw Stock by Container</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : rawStock && rawStock.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Received (kg)</TableHead>
                  <TableHead className="text-right">Used (kg)</TableHead>
                  <TableHead className="text-right">Remaining (kg)</TableHead>
                  <TableHead className="text-right">Cost/kg</TableHead>
                  <TableHead className="text-right">Value Remaining</TableHead>
                  <TableHead>Offloaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rawStock.map((row) => {
                  const remaining = parseFloat(row.remainingKg);
                  return (
                    <TableRow key={row.id} data-testid={`row-raw-stock-${row.id}`}>
                      <TableCell className="font-medium" data-testid={`text-container-${row.id}`}>
                        {row.containerNumber}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.supplierName || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(row.receivedKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(row.usedKg))}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        <Badge variant={remaining <= 0 ? "secondary" : "default"}>
                          {formatNumber(remaining)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(row.costPerKg).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(parseFloat(row.valueRemaining))}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(row.offloadedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Container className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No raw stock yet</h3>
              <p className="text-muted-foreground mt-2">
                Offload a container to start tracking production raw materials
              </p>
              <Button className="mt-4" onClick={() => setOffloadDialogOpen(true)}>
                <ArrowDown className="h-4 w-4 mr-2" />
                Offload First Container
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={offloadDialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offload Container to Production</DialogTitle>
            <DialogDescription>
              Select a container and specify the kg to offload into production raw stock
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Container</Label>
              <Select value={selectedContainerId} onValueChange={handleContainerSelect}>
                <SelectTrigger data-testid="select-offload-container">
                  <SelectValue placeholder="Select container to offload" />
                </SelectTrigger>
                <SelectContent>
                  {availableContainers?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.containerNumber} {c.totalKg ? `(${parseFloat(c.totalKg).toLocaleString()} kg)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Received Weight (kg)</Label>
              <Input
                type="number"
                value={receivedKg}
                onChange={(e) => setReceivedKg(e.target.value)}
                placeholder="e.g. 20000"
                step="0.001"
                data-testid="input-received-kg"
              />
              <p className="text-xs text-muted-foreground">Auto-filled from container. Edit only if actual differs.</p>
            </div>

            <div className="space-y-1">
              <Label>Cost per kg ($)</Label>
              <Input
                type="number"
                value={costPerKg}
                onChange={(e) => setCostPerKg(e.target.value)}
                placeholder="e.g. 1.85"
                step="0.0001"
                data-testid="input-cost-per-kg"
              />
              <p className="text-xs text-muted-foreground">Auto-filled from container. Edit only if actual differs.</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCloseDialog} data-testid="button-cancel-offload">
                Cancel
              </Button>
              <Button
                onClick={handleOffload}
                disabled={offloadMutation.isPending || !selectedContainerId}
                data-testid="button-confirm-offload"
              >
                {offloadMutation.isPending ? "Offloading..." : "Offload to Production"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
