import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { ArrowRightLeft, Plus, Check, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";

interface TransferRow {
  id: number;
  fromLocationId: number;
  toLocationId: number;
  transferDate: string;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  fromLocationName?: string;
  toLocationName?: string;
  itemCount?: number;
}

interface TransferDetail {
  id: number;
  fromLocationId: number;
  toLocationId: number;
  transferDate: string;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  fromLocationName?: string;
  toLocationName?: string;
  items: TransferItem[];
}

interface TransferItem {
  id: number;
  baleId: number;
  baleCode: string;
  productName: string | null;
  weightKg: string;
  costPerKg: string;
}

interface LocationOption {
  id: number;
  name: string;
  code: string;
}

interface BaleRow {
  bale: {
    id: number;
    baleCode: string;
    weightKg: string;
    costPerKg: string;
    status: string;
    locationId?: number | null;
  };
  product: {
    name: string;
    articleCode: string;
  } | null;
}

export default function BaleTransfers() {
  const { formatDisplayDate } = useDateFormat();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [destLocationId, setDestLocationId] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [notes, setNotes] = useState("");
  const [selectedBaleIds, setSelectedBaleIds] = useState<number[]>([]);
  const { toast } = useToast();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: transfers, isLoading } = useQuery<TransferRow[]>({
    queryKey: ["/api/bale-transfers"],
  });

  const { data: locations } = useQuery<LocationOption[]>({
    queryKey: ["/api/locations"],
  });

  const { data: allBales } = useQuery<BaleRow[]>({
    queryKey: ["/api/factory/bales"],
    enabled: dialogOpen,
  });

  const { data: transferDetail } = useQuery<TransferDetail>({
    queryKey: ["/api/bale-transfers", expandedId],
    enabled: expandedId !== null,
    queryFn: async () => {
      const res = await fetch(`/api/bale-transfers/${expandedId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch transfer detail");
      return res.json();
    },
  });

  const createTransfer = useMutation({
    mutationFn: async (data: {
      fromLocationId: number;
      toLocationId: number;
      transferDate: string;
      notes: string;
      baleIds: number[];
    }) => {
      const res = await modeApiRequest("POST", "/api/bale-transfers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bale-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Transfer created successfully" });
      handleCloseDialog();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error creating transfer", description: error.message, variant: "destructive" });
    },
  });

  const completeTransfer = useMutation({
    mutationFn: async (id: number) => {
      const res = await modeApiRequest("PATCH", `/api/bale-transfers/${id}/complete`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bale-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Transfer completed" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error completing transfer", description: error.message, variant: "destructive" });
    },
  });

  const deleteTransfer = useMutation({
    mutationFn: async (id: number) => {
      await modeApiRequest("DELETE", `/api/bale-transfers/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bale-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/bales"] });
      toast({ title: "Transfer deleted" });
      setDeleteConfirm(null);
      if (expandedId !== null) setExpandedId(null);
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error deleting transfer", description: error.message, variant: "destructive" });
      setDeleteConfirm(null);
    },
  });

  const availableBales = (allBales || []).filter((row) => {
    if (row.bale.status !== "FINALIZED") return false;
    if (sourceLocationId && row.bale.locationId != null) {
      return String(row.bale.locationId) === sourceLocationId;
    }
    return true;
  });

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSourceLocationId("");
    setDestLocationId("");
    setTransferDate(new Date().toLocaleDateString('en-CA'));
    setNotes("");
    setSelectedBaleIds([]);
  };

  const handleToggleBale = (baleId: number) => {
    setSelectedBaleIds((prev) =>
      prev.includes(baleId) ? prev.filter((id) => id !== baleId) : [...prev, baleId]
    );
  };

  const handleSelectAll = () => {
    if (selectedBaleIds.length === availableBales.length) {
      setSelectedBaleIds([]);
    } else {
      setSelectedBaleIds(availableBales.map((r) => r.bale.id));
    }
  };

  const handleSubmit = () => {
    if (!sourceLocationId) {
      toast({ title: "Select source location", variant: "destructive" });
      return;
    }
    if (!destLocationId) {
      toast({ title: "Select destination location", variant: "destructive" });
      return;
    }
    if (sourceLocationId === destLocationId) {
      toast({ title: "Source and destination must differ", variant: "destructive" });
      return;
    }
    if (!transferDate) {
      toast({ title: "Select transfer date", variant: "destructive" });
      return;
    }
    if (selectedBaleIds.length === 0) {
      toast({ title: "Select at least one bale", variant: "destructive" });
      return;
    }
    createTransfer.mutate({
      fromLocationId: parseInt(sourceLocationId),
      toLocationId: parseInt(destLocationId),
      transferDate,
      notes,
      baleIds: selectedBaleIds,
    });
  };

  const getLocationName = (id: number) => {
    const loc = locations?.find((l) => l.id === id);
    return loc?.name || `Location #${id}`;
  };

  const handleRowClick = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold" data-testid="text-page-title">Bale Transfers</h2>
          <Badge variant="secondary" data-testid="badge-transfer-count">
            {transfers?.length || 0} transfers
          </Badge>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-new-transfer">
          <Plus className="h-4 w-4 mr-2" />
          New Transfer
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {!transfers || transfers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ArrowRightLeft className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No transfers yet</p>
              <p className="text-xs mt-1">Create a new transfer to move bales between locations</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Transfer Date</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((transfer) => {
                    const isExpanded = expandedId === transfer.id;
                    return (
                      <>
                        <TableRow
                          key={transfer.id}
                          className="cursor-pointer"
                          onClick={() => handleRowClick(transfer.id)}
                          data-testid={`row-transfer-${transfer.id}`}
                        >
                          <TableCell className="w-8">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm" data-testid={`text-transfer-date-${transfer.id}`}>
                            {formatDisplayDate(transfer.transferDate)}
                          </TableCell>
                          <TableCell data-testid={`text-from-location-${transfer.id}`}>
                            {transfer.fromLocationName || getLocationName(transfer.fromLocationId)}
                          </TableCell>
                          <TableCell data-testid={`text-to-location-${transfer.id}`}>
                            {transfer.toLocationName || getLocationName(transfer.toLocationId)}
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-item-count-${transfer.id}`}>
                            {transfer.itemCount ?? "-"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={transfer.status === "COMPLETED" ? "default" : "secondary"}
                              data-testid={`badge-status-${transfer.id}`}
                            >
                              {transfer.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground" data-testid={`text-created-by-${transfer.id}`}>
                            {transfer.createdBy || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {transfer.status === "PENDING" && (
                                <>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => completeTransfer.mutate(transfer.id)}
                                    disabled={completeTransfer.isPending}
                                    data-testid={`button-complete-${transfer.id}`}
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setDeleteConfirm(transfer.id)}
                                    data-testid={`button-delete-${transfer.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`detail-${transfer.id}`}>
                            <TableCell colSpan={8} className="bg-muted/30 p-4">
                              {transferDetail && transferDetail.id === transfer.id ? (
                                transferDetail.items && transferDetail.items.length > 0 ? (
                                  <Table>
                                    <TableHeader className="sticky top-0 z-30 bg-background">
                                      <TableRow>
                                        <TableHead>Bale Code</TableHead>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                        <TableHead className="text-right">Cost/kg</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {(Array.isArray(transferDetail.items) ? transferDetail.items : []).map((item) => (
                                        <TableRow key={item.id} data-testid={`row-transfer-item-${item.id}`}>
                                          <TableCell className="font-mono text-xs">{item.baleCode}</TableCell>
                                          <TableCell>{item.productName || "-"}</TableCell>
                                          <TableCell className="text-right font-mono">{parseFloat(item.weightKg).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</TableCell>
                                          <TableCell className="text-right font-mono">{parseFloat(item.costPerKg).toFixed(4)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <p className="text-sm text-muted-foreground">No items in this transfer</p>
                                )
                              ) : (
                                <Skeleton className="h-20 w-full" />
                              )}
                              {transferDetail?.notes && (
                                <p className="text-sm text-muted-foreground mt-2">Notes: {transferDetail.notes}</p>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Bale Transfer</DialogTitle>
            <DialogDescription>
              Transfer bales from one location to another
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Location</Label>
                <Select value={sourceLocationId} onValueChange={(val) => { setSourceLocationId(val); setSelectedBaleIds([]); }}>
                  <SelectTrigger data-testid="select-source-location">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Destination Location</Label>
                <Select value={destLocationId} onValueChange={setDestLocationId}>
                  <SelectTrigger data-testid="select-dest-location">
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.filter((l) => String(l.id) !== sourceLocationId).map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Transfer Date</Label>
              <Input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                data-testid="input-transfer-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this transfer"
                rows={2}
                data-testid="input-transfer-notes"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Select Bales ({selectedBaleIds.length} selected)</Label>
                {availableBales.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleSelectAll} data-testid="button-select-all-bales">
                    {selectedBaleIds.length === availableBales.length ? "Deselect All" : "Select All"}
                  </Button>
                )}
              </div>
              {!sourceLocationId ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Select a source location to see available bales</p>
              ) : availableBales.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No finalized bales at this location</p>
              ) : (
                <div className="border rounded-md max-h-60 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Bale Code</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Weight (kg)</TableHead>
                        <TableHead className="text-right">Cost/kg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableBales.map((row) => (
                        <TableRow key={row.bale.id} data-testid={`row-bale-select-${row.bale.id}`}>
                          <TableCell>
                            <Checkbox
                              checked={selectedBaleIds.includes(row.bale.id)}
                              onCheckedChange={() => handleToggleBale(row.bale.id)}
                              data-testid={`checkbox-bale-${row.bale.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.bale.baleCode}</TableCell>
                          <TableCell>{row.product?.name || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{parseFloat(row.bale.weightKg).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-right font-mono">{parseFloat(row.bale.costPerKg).toFixed(4)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} data-testid="button-cancel-transfer">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createTransfer.isPending || selectedBaleIds.length === 0}
              data-testid="button-submit-transfer"
            >
              {createTransfer.isPending ? "Creating..." : "Create Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Transfer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this transfer? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteTransfer.mutate(deleteConfirm)}
              disabled={deleteTransfer.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteTransfer.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
