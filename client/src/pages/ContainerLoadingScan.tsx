import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { useState, useRef, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useLocation } from "wouter";
import { ScanLine, Trash2, Package, MapPin, Play, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Customer {
  id: number;
  legalName: string;
}

interface Location {
  id: number;
  name: string;
  code?: string;
}

interface Proforma {
  id: number;
  customerId: number;
  name: string;
  isActive: boolean;
}

interface OrderBale {
  id: number;
  baleId: number;
  baleReference: string;
  articleCode: string;
  baleName: string;
  weight: string;
  priceUsed: string;
}

interface OrderDetail {
  id: number;
  customerId: number;
  companyId: number;
  orderDate: string;
  status: string;
  totalQtyBales: number;
  bales: OrderBale[];
}

export default function ContainerLoadingScan() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [orderDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanFlash, setScanFlash] = useState<"success" | "error" | null>(null);
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scannerRef = useRef<HTMLInputElement>(null);

  const customerId = selectedCustomerId ? parseInt(selectedCustomerId) : null;

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/factory/customers", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !!selectedCompany?.id,
  });

  const { data: proformas = [] } = useQuery<Proforma[]>({
    queryKey: [`/api/factory/customer-proformas?customerId=${customerId}`, customerId],
    enabled: !!customerId,
  });

  const activeProforma = proformas.find((p) => p.isActive) || null;

  const { data: orderDetail } = useQuery<OrderDetail>({
    queryKey: ["/api/factory/customer-orders", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/customer-orders/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch order");
      return res.json();
    },
    enabled: !!orderId,
  });

  const createOrderMutation = useMutation({
    mutationFn: async (data: { customerId: number; proformaIdUsed: number | null; locationId: number; orderDate: string }) => {
      const res = await modeApiRequest("POST", "/api/factory/customer-orders-loading", data);
      return await res.json();
    },
    onSuccess: (data: any) => {
      setOrderId(data.id);
      toast({ title: "Loading order created", description: "You can now start scanning bales" });
      setTimeout(() => scannerRef.current?.focus(), 100);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addBaleMutation = useMutation({
    mutationFn: async (data: { scanCode: string; locationId: number }) => {
      const res = await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/bales`, data);
      return await res.json();
    },
    onSuccess: () => {
      setScanFlash("success");
      setTimeout(() => setScanFlash(null), 500);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      setScanCode("");
      scannerRef.current?.focus();
    },
    onError: (error: Error) => {
      setScanFlash("error");
      setTimeout(() => setScanFlash(null), 500);
      toast({ title: "Scan Error", description: error.message, variant: "destructive" });
      setScanCode("");
      scannerRef.current?.focus();
    },
  });

  const removeBaleMutation = useMutation({
    mutationFn: async (baleId: number) => {
      await modeApiRequest("DELETE", `/api/factory/customer-orders/${orderId}/bales/${baleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/customer-orders", orderId] });
      toast({ title: "Bale removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      await modeApiRequest("POST", `/api/factory/customer-orders/${orderId}/finalize-loading`);
    },
    onSuccess: () => {
      toast({ title: "Loading finalized", description: "Loading has been sent for office verification" });
      setShowFinalizeDialog(false);
      navigate("/factory/sales/pending-invoices");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setShowFinalizeDialog(false);
    },
  });

  const handleStartLoading = useCallback(() => {
    if (!customerId || !selectedLocationId) return;
    createOrderMutation.mutate({
      customerId,
      proformaIdUsed: activeProforma?.id || null,
      locationId: parseInt(selectedLocationId),
      orderDate,
    });
  }, [customerId, selectedLocationId, activeProforma, orderDate, createOrderMutation]);

  const handleScan = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !scanCode.trim() || !orderId || !selectedLocationId) return;
    e.preventDefault();
    addBaleMutation.mutate({ scanCode: scanCode.trim(), locationId: parseInt(selectedLocationId) });
  }, [scanCode, orderId, selectedLocationId, addBaleMutation]);

  const toggleGroup = useCallback((articleCode: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(articleCode)) {
        next.delete(articleCode);
      } else {
        next.add(articleCode);
      }
      return next;
    });
  }, []);

  const bales = orderDetail?.bales || [];

  const groupedBales = bales.reduce<Record<string, { articleCode: string; baleName: string; bales: OrderBale[]; totalWeight: number }>>((acc, bale) => {
    const key = bale.articleCode;
    if (!acc[key]) {
      acc[key] = {
        articleCode: bale.articleCode,
        baleName: bale.baleName,
        bales: [],
        totalWeight: 0,
      };
    }
    acc[key].bales.push(bale);
    acc[key].totalWeight += parseFloat(bale.weight || "0");
    return acc;
  }, {});

  const totalWeight = bales.reduce((sum, b) => sum + parseFloat(b.weight || "0"), 0);

  const scanInputClass = scanFlash === "success"
    ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-950 transition-all"
    : scanFlash === "error"
    ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-950 transition-all"
    : "";

  return (
    <div className="flex flex-col h-full p-4 lg:p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Container Loading</h1>
          <p className="text-muted-foreground text-sm">Floor loader bale scanning</p>
        </div>
        {orderId && (
          <Badge variant="secondary" data-testid="badge-loading-order">
            Loading #{orderId}
          </Badge>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
        <div className="lg:w-[60%] flex flex-col min-h-0">
          <Card className="flex-1 flex flex-col min-h-0 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-semibold text-lg" data-testid="text-bales-header">Scanned Bales</h2>
              <Badge variant="secondary" data-testid="badge-bale-count">{bales.length} bales</Badge>
            </div>

            <div className="flex-1 overflow-y-auto">
              {Object.keys(groupedBales).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="text-no-bales">
                  <Package className="h-12 w-12 mb-3 opacity-40" />
                  <p>No bales scanned yet</p>
                  <p className="text-sm mt-1">
                    {!orderId ? "Set up the loading order first, then scan bales" : "Scan bales using the scanner below"}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.values(groupedBales).map((group) => (
                    <div key={group.articleCode} data-testid={`group-article-${group.articleCode}`}>
                      <button
                        type="button"
                        className="w-full flex flex-wrap items-center justify-between gap-2 mb-1 px-1 cursor-pointer rounded-md p-2 hover-elevate"
                        onClick={() => toggleGroup(group.articleCode)}
                        data-testid={`button-toggle-group-${group.articleCode}`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" data-testid={`badge-article-${group.articleCode}`}>{group.articleCode}</Badge>
                          <span className="text-sm font-medium">{group.baleName}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>Qty: {group.bales.length}</span>
                          <span>Wt: {group.totalWeight.toFixed(2)} kg</span>
                        </div>
                      </button>
                      {expandedGroups.has(group.articleCode) && (
                        <Table>
                          <TableBody>
                            {group.bales.map((bale) => (
                              <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                                <TableCell className="font-mono text-sm" data-testid={`text-bale-ref-${bale.id}`}>
                                  {bale.baleReference}
                                </TableCell>
                                <TableCell className="text-sm">{bale.baleName}</TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">
                                  {parseFloat(bale.weight || "0").toFixed(2)} kg
                                </TableCell>
                                <TableCell className="w-[40px]">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeBaleMutation.mutate(bale.id)}
                                    disabled={removeBaleMutation.isPending}
                                    data-testid={`button-remove-bale-${bale.id}`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {orderId && (
              <div className="border-t pt-3 mt-3">
                <label className="text-sm font-medium mb-1 block">
                  <ScanLine className="inline h-4 w-4 mr-1" />
                  Scan Bale
                </label>
                <Input
                  ref={scannerRef}
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={handleScan}
                  placeholder="Scan or type bale code..."
                  disabled={!orderId || !selectedLocationId || addBaleMutation.isPending}
                  className={`text-lg h-12 font-mono ${scanInputClass}`}
                  autoFocus
                  data-testid="input-scan-code"
                />
              </div>
            )}
          </Card>
        </div>

        <div className="lg:w-[40%] flex flex-col gap-4">
          <Card className="p-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Customer</label>
              <Select
                value={selectedCustomerId}
                onValueChange={setSelectedCustomerId}
                disabled={!!orderId}
              >
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-customer-option-${c.id}`}>
                      {c.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                <MapPin className="inline h-3 w-3 mr-1" />
                Loading Location
              </label>
              <Select
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
                disabled={!!orderId}
              >
                <SelectTrigger data-testid="select-location">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`select-location-option-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {customerId && activeProforma && (
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600 text-white no-default-hover-elevate no-default-active-elevate" data-testid="badge-active-proforma">
                  {activeProforma.name}
                </Badge>
                <span className="text-sm text-muted-foreground">Active proforma</span>
              </div>
            )}

            {customerId && !activeProforma && proformas.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-no-proforma">
                No active proforma found. Loading will proceed without price references.
              </p>
            )}

            {!orderId && (
              <Button
                className="w-full"
                onClick={handleStartLoading}
                disabled={!customerId || !selectedLocationId || createOrderMutation.isPending}
                data-testid="button-start-loading"
              >
                <Play className="mr-2 h-4 w-4" />
                {createOrderMutation.isPending ? "Creating..." : "Start Loading"}
              </Button>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold text-sm">Order Summary</h3>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>Total Bales</span>
              <span className="font-mono" data-testid="text-total-bales">{bales.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>Total Weight</span>
              <span className="font-mono" data-testid="text-total-weight">{totalWeight.toFixed(2)} kg</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>Article Groups</span>
              <span className="font-mono" data-testid="text-article-groups">{Object.keys(groupedBales).length}</span>
            </div>
          </Card>

          <Button
            className="w-full"
            size="lg"
            onClick={() => setShowFinalizeDialog(true)}
            disabled={!orderId || bales.length === 0 || finalizeMutation.isPending}
            data-testid="button-finalize-loading"
          >
            <CheckCircle className="mr-2 h-5 w-5" />
            Finalize Loading
          </Button>
        </div>
      </div>

      <Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Finalize Loading</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will mark the loading as complete and send it for office verification.
            </p>
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>Total Bales:</span>
                <span className="font-mono font-semibold" data-testid="text-dialog-total-bales">{bales.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>Total Weight:</span>
                <span className="font-mono font-semibold" data-testid="text-dialog-total-weight">{totalWeight.toFixed(2)} kg</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowFinalizeDialog(false)}
                data-testid="button-cancel-finalize"
              >
                Cancel
              </Button>
              <Button
                onClick={() => finalizeMutation.mutate()}
                disabled={finalizeMutation.isPending}
                data-testid="button-confirm-finalize"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {finalizeMutation.isPending ? "Finalizing..." : "Confirm Finalize"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
