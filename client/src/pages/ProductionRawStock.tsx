import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Container, Package, Plus, ArrowDown, AlertTriangle, CheckCircle } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
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
  const [actualReceivedKg, setActualReceivedKg] = useState("");
  const [costPerKg, setCostPerKg] = useState("");
  const [commissionPersonName, setCommissionPersonName] = useState("");
  const [commissionType, setCommissionType] = useState<"PER_KG" | "FIXED">("PER_KG");
  const [commissionRate, setCommissionRate] = useState("");
  const { toast } = useToast();

  const { data: rawStock, isLoading } = useQuery<RawStockRow[]>({
    queryKey: ["/api/factory/raw-stock"],
  });

  const { data: availableContainers } = useQuery<ContainerOption[]>({
    queryKey: ["/api/factory/raw-stock/available-containers"],
    enabled: offloadDialogOpen,
  });

  const selectedContainer = useMemo(() => {
    return availableContainers?.find((c) => c.id.toString() === selectedContainerId);
  }, [availableContainers, selectedContainerId]);

  const declaredKg = parseFloat(selectedContainer?.totalKg || "0");
  const actualKg = parseFloat(actualReceivedKg || "0");
  const rate = parseFloat(costPerKg || "0");
  const differenceKg = declaredKg - actualKg;
  const totalPayable = actualKg * rate;
  const declaredTotal = declaredKg * rate;
  const costDifference = differenceKg * rate;
  const hasWeightDiff = actualKg > 0 && declaredKg > 0 && actualKg !== declaredKg;

  const commRateNum = parseFloat(commissionRate || "0");
  const commissionTotal = commissionType === "PER_KG"
    ? commRateNum * actualKg
    : commRateNum;

  const offloadMutation = useMutation({
    mutationFn: async (data: any) => {
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
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
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
    setActualReceivedKg(container?.totalKg || "");
    setCostPerKg(container?.ratePerKg || "");
  };

  const handleOffload = () => {
    if (!selectedContainerId) {
      toast({ title: "Missing fields", description: "Please select a container", variant: "destructive" });
      return;
    }
    if (!actualReceivedKg || parseFloat(actualReceivedKg) <= 0) {
      toast({ title: "Missing weight", description: "Please enter the actual received weight", variant: "destructive" });
      return;
    }
    if (!costPerKg || parseFloat(costPerKg) <= 0) {
      toast({ title: "Missing cost", description: "Please enter the cost per kg", variant: "destructive" });
      return;
    }

    const payload: any = {
      containerId: selectedContainerId,
      receivedKg: actualReceivedKg,
      costPerKg,
    };

    if (commissionPersonName.trim() && commRateNum > 0) {
      payload.commission = {
        personName: commissionPersonName.trim(),
        commissionType,
        commissionRate: commissionRate,
      };
    }

    offloadMutation.mutate(payload);
  };

  const handleCloseDialog = () => {
    setOffloadDialogOpen(false);
    setSelectedContainerId("");
    setActualReceivedKg("");
    setCostPerKg("");
    setCommissionPersonName("");
    setCommissionType("PER_KG");
    setCommissionRate("");
  };

  const totalReceived = rawStock?.reduce((sum, r) => sum + parseFloat(r.receivedKg), 0) || 0;
  const totalUsed = rawStock?.reduce((sum, r) => sum + parseFloat(r.usedKg), 0) || 0;
  const totalRemaining = rawStock?.reduce((sum, r) => sum + parseFloat(r.remainingKg), 0) || 0;
  const totalValue = rawStock?.reduce((sum, r) => sum + parseFloat(r.valueRemaining), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Offload Container to Production</DialogTitle>
            <DialogDescription>
              Enter the actual received weight and verify cost details
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
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

            {selectedContainer && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Declared Weight (kg)</Label>
                    <Input
                      value={selectedContainer.totalKg ? formatNumber(parseFloat(selectedContainer.totalKg)) : "N/A"}
                      disabled
                      className="font-mono bg-muted"
                      data-testid="input-declared-kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-xs">Declared Rate/kg ($)</Label>
                    <Input
                      value={selectedContainer.ratePerKg ? parseFloat(selectedContainer.ratePerKg).toFixed(4) : "N/A"}
                      disabled
                      className="font-mono bg-muted"
                      data-testid="input-declared-rate"
                    />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Actual Arrived KG</Label>
                    <Input
                      type="number"
                      value={actualReceivedKg}
                      onChange={(e) => setActualReceivedKg(e.target.value)}
                      placeholder="e.g. 19600"
                      step="0.001"
                      data-testid="input-actual-kg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Rate per KG ($)</Label>
                    <Input
                      type="number"
                      value={costPerKg}
                      onChange={(e) => setCostPerKg(e.target.value)}
                      placeholder="e.g. 1.85"
                      step="0.0001"
                      data-testid="input-cost-per-kg"
                    />
                  </div>
                </div>

                {hasWeightDiff && (
                  <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${differenceKg > 0 ? "text-amber-600 bg-amber-50 dark:bg-amber-950/20" : "text-blue-600 bg-blue-50 dark:bg-blue-950/20"}`} data-testid="text-weight-difference">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      Weight difference: <strong className="font-mono">{differenceKg > 0 ? "-" : "+"}{formatNumber(Math.abs(differenceKg))} kg</strong>
                      {rate > 0 && (
                        <> (cost difference: <strong className="font-mono">${formatNumber(Math.abs(costDifference))}</strong>)</>
                      )}
                    </span>
                  </div>
                )}

                <Separator />

                <div>
                  <Label className="text-sm font-semibold">Commission (optional)</Label>
                  <div className="space-y-3 mt-2">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-xs">Commission Person</Label>
                      <Input
                        value={commissionPersonName}
                        onChange={(e) => setCommissionPersonName(e.target.value)}
                        placeholder="Person name"
                        data-testid="input-commission-person"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">Commission Type</Label>
                        <Select value={commissionType} onValueChange={(v) => setCommissionType(v as "PER_KG" | "FIXED")}>
                          <SelectTrigger data-testid="select-commission-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PER_KG">Per KG</SelectItem>
                            <SelectItem value="FIXED">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-xs">
                          {commissionType === "PER_KG" ? "Rate per KG ($)" : "Fixed Amount ($)"}
                        </Label>
                        <Input
                          type="number"
                          value={commissionRate}
                          onChange={(e) => setCommissionRate(e.target.value)}
                          placeholder={commissionType === "PER_KG" ? "e.g. 0.05" : "e.g. 500"}
                          step="0.01"
                          data-testid="input-commission-rate"
                        />
                      </div>
                    </div>
                    {commissionPersonName && commRateNum > 0 && (
                      <div className="text-sm text-muted-foreground">
                        Commission Total: <span className="font-mono font-medium text-foreground">${formatNumber(commissionTotal)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="rounded-md border p-3 space-y-1.5 text-sm" data-testid="section-offload-summary">
                  <p className="font-semibold text-base mb-2">Offload Summary</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Declared</span>
                    <span className="font-mono">{formatNumber(declaredKg)} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Actual</span>
                    <span className={`font-mono font-medium ${hasWeightDiff ? "text-amber-600" : ""}`}>
                      {formatNumber(actualKg)} kg
                    </span>
                  </div>
                  {hasWeightDiff && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Difference</span>
                      <span className="font-mono text-amber-600">
                        {differenceKg > 0 ? "-" : "+"}{formatNumber(Math.abs(differenceKg))} kg
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate</span>
                    <span className="font-mono">${rate.toFixed(4)}/kg</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-medium">
                    <span>Total Payable</span>
                    <span className="font-mono text-base">${formatNumber(totalPayable)}</span>
                  </div>
                  {commissionPersonName && commRateNum > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Commission ({commissionPersonName})</span>
                      <span className="font-mono">${formatNumber(commissionTotal)}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleCloseDialog} data-testid="button-cancel-offload">
                Cancel
              </Button>
              <Button
                onClick={handleOffload}
                disabled={offloadMutation.isPending || !selectedContainerId}
                data-testid="button-confirm-offload"
              >
                {offloadMutation.isPending ? "Offloading..." : "Confirm Offload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
