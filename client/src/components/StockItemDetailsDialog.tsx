import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Save, X, Package } from "lucide-react";
import { format } from "date-fns";

interface StockItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockItemId: number;
  stockItemName: string;
}

interface StockItem {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  uom: string;
  stockGroupId: number | null;
  active: boolean;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

interface Transaction {
  id: number;
  type: "transfer" | "adjustment";
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  quantity: string;
  rate: string;
  totalAmount: string;
  stockItemId: number;
  notes: string | null;
}

export function StockItemDetailsDialog({
  open,
  onOpenChange,
  stockItemId,
  stockItemName,
}: StockItemDetailsDialogProps) {
  const { toast } = useToast();
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedCode, setEditedCode] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedBarcode, setEditedBarcode] = useState("");
  const [editedUom, setEditedUom] = useState("");
  const [editedStockGroupId, setEditedStockGroupId] = useState<number | null>(null);
  
  const [editingTransaction, setEditingTransaction] = useState<number | null>(null);
  const [editedStockItemId, setEditedStockItemId] = useState<number | null>(null);
  const [editedQuantity, setEditedQuantity] = useState("");
  const [editedRate, setEditedRate] = useState("");

  // Fetch stock item details
  const { data: stockItem, isLoading: loadingItem } = useQuery<StockItem>({
    queryKey: [`/api/stock-items/${stockItemId}`],
    enabled: open,
  });

  // Fetch stock groups
  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
    enabled: open,
  });

  // Fetch all stock items for the transaction editor dropdown
  const { data: allStockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
    enabled: open && editingTransaction !== null,
  });

  // Fetch transactions
  const { data: transactions = [], isLoading: loadingTransactions } = useQuery<Transaction[]>({
    queryKey: [`/api/stock-items/${stockItemId}/transactions`],
    enabled: open,
  });

  // Update stock item mutation
  const updateItemMutation = useMutation({
    mutationFn: async (updates: Partial<StockItem>) => {
      const response = await apiRequest("PATCH", `/api/stock-items/${stockItemId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      setIsEditingDetails(false);
      toast({
        title: "Stock Item Updated",
        description: "Stock item details updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update stock item",
        variant: "destructive",
      });
    },
  });

  // Update transaction mutation
  const updateTransactionMutation = useMutation({
    mutationFn: async ({ id, type, updates }: { id: number; type: string; updates: any }) => {
      const endpoint = type === "transfer" 
        ? `/api/stock-transfer-items/${id}`
        : `/api/stock-adjustment-items/${id}`;
      const response = await apiRequest("PATCH", endpoint, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}/transactions`] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      setEditingTransaction(null);
      toast({
        title: "Transaction Updated",
        description: "Transaction updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update transaction",
        variant: "destructive",
      });
    },
  });

  const handleEditDetails = () => {
    if (stockItem) {
      setEditedCode(stockItem.code);
      setEditedName(stockItem.name);
      setEditedBarcode(stockItem.barcode || "");
      setEditedUom(stockItem.uom);
      setEditedStockGroupId(stockItem.stockGroupId);
      setIsEditingDetails(true);
    }
  };

  const handleSaveDetails = () => {
    // Validate required fields
    if (!editedCode || editedCode.trim() === "") {
      toast({
        title: "Validation Error",
        description: "Code is required",
        variant: "destructive",
      });
      return;
    }
    if (!editedName || editedName.trim() === "") {
      toast({
        title: "Validation Error",
        description: "Name is required",
        variant: "destructive",
      });
      return;
    }
    if (!editedUom || editedUom.trim() === "") {
      toast({
        title: "Validation Error",
        description: "Unit of measure is required",
        variant: "destructive",
      });
      return;
    }

    const updates: Partial<StockItem> = {
      code: editedCode.trim(),
      name: editedName.trim(),
      barcode: editedBarcode?.trim() || null,
      uom: editedUom.trim(),
      stockGroupId: editedStockGroupId,
    };
    updateItemMutation.mutate(updates);
  };

  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction.id);
    setEditedStockItemId(transaction.stockItemId);
    setEditedQuantity(transaction.quantity);
    setEditedRate(transaction.rate);
  };

  const handleSaveTransaction = (transaction: Transaction) => {
    // Validate required fields
    if (!editedStockItemId) {
      toast({
        title: "Validation Error",
        description: "Stock item is required",
        variant: "destructive",
      });
      return;
    }
    if (!editedQuantity || editedQuantity.trim() === "" || isNaN(parseFloat(editedQuantity))) {
      toast({
        title: "Validation Error",
        description: "Valid quantity is required",
        variant: "destructive",
      });
      return;
    }
    if (!editedRate || editedRate.trim() === "" || isNaN(parseFloat(editedRate))) {
      toast({
        title: "Validation Error",
        description: "Valid rate is required",
        variant: "destructive",
      });
      return;
    }

    const updates: any = {};
    
    if (editedStockItemId !== transaction.stockItemId) {
      updates.stockItemId = editedStockItemId;
    }
    if (editedQuantity !== transaction.quantity) {
      updates.quantity = editedQuantity;
    }
    if (editedRate !== transaction.rate) {
      updates.rate = editedRate;
    }

    updateTransactionMutation.mutate({
      id: transaction.id,
      type: transaction.type,
      updates,
    });
  };

  const handleCancelTransactionEdit = () => {
    setEditingTransaction(null);
    setEditedStockItemId(null);
    setEditedQuantity("");
    setEditedRate("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {stockItemName}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details" data-testid="tab-details">
              Item Details
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="tab-transactions">
              Voucher History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 mt-4">
            {loadingItem ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">Loading...</p>
              </div>
            ) : stockItem ? (
              <div className="space-y-4">
                <div className="flex justify-end">
                  {!isEditingDetails ? (
                    <Button
                      onClick={handleEditDetails}
                      variant="outline"
                      size="sm"
                      data-testid="button-edit-details"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveDetails}
                        size="sm"
                        disabled={updateItemMutation.isPending}
                        data-testid="button-save-details"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </Button>
                      <Button
                        onClick={() => setIsEditingDetails(false)}
                        variant="outline"
                        size="sm"
                        disabled={updateItemMutation.isPending}
                        data-testid="button-cancel-details"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Code</Label>
                    {isEditingDetails ? (
                      <Input
                        id="code"
                        value={editedCode}
                        onChange={(e) => setEditedCode(e.target.value)}
                        data-testid="input-code"
                      />
                    ) : (
                      <p className="text-sm font-mono p-2 bg-muted rounded" data-testid="text-code">
                        {stockItem.code}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    {isEditingDetails ? (
                      <Input
                        id="name"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        data-testid="input-name"
                      />
                    ) : (
                      <p className="text-sm p-2 bg-muted rounded" data-testid="text-name">
                        {stockItem.name}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="barcode">Barcode</Label>
                    {isEditingDetails ? (
                      <Input
                        id="barcode"
                        value={editedBarcode}
                        onChange={(e) => setEditedBarcode(e.target.value)}
                        data-testid="input-barcode"
                      />
                    ) : (
                      <p className="text-sm font-mono p-2 bg-muted rounded" data-testid="text-barcode">
                        {stockItem.barcode || "-"}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="uom">Unit of Measure</Label>
                    {isEditingDetails ? (
                      <Input
                        id="uom"
                        value={editedUom}
                        onChange={(e) => setEditedUom(e.target.value)}
                        data-testid="input-uom"
                      />
                    ) : (
                      <p className="text-sm p-2 bg-muted rounded" data-testid="text-uom">
                        {stockItem.uom}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 col-span-2">
                    <Label htmlFor="stockGroup">Stock Group</Label>
                    {isEditingDetails ? (
                      <Select
                        value={editedStockGroupId?.toString() || ""}
                        onValueChange={(value) => setEditedStockGroupId(value ? parseInt(value) : null)}
                      >
                        <SelectTrigger data-testid="select-stock-group">
                          <SelectValue placeholder="Select stock group" />
                        </SelectTrigger>
                        <SelectContent>
                          {stockGroups.map((group) => (
                            <SelectItem key={group.id} value={group.id.toString()}>
                              {group.code} - {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm p-2 bg-muted rounded" data-testid="text-stock-group">
                        {stockGroups.find((g) => g.id === stockItem.stockGroupId)?.name || "Uncategorized"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="transactions" className="mt-4">
            {loadingTransactions ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">Loading transactions...</p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-muted-foreground">No transactions found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {transactions.map((transaction) => {
                  const isEditing = editingTransaction === transaction.id;
                  return (
                    <div
                      key={transaction.id}
                      className="border rounded-lg p-4 space-y-3"
                      data-testid={`transaction-${transaction.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {transaction.voucherNumber} ({transaction.type === "transfer" ? "Transfer" : "Adjustment"})
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {transaction.voucherDate ? format(new Date(transaction.voucherDate), "dd MMM yyyy") : "-"}
                          </p>
                          {transaction.notes && (
                            <p className="text-xs text-muted-foreground italic">{transaction.notes}</p>
                          )}
                        </div>
                        {!isEditing && (
                          <Button
                            onClick={() => handleEditTransaction(transaction)}
                            variant="outline"
                            size="sm"
                            data-testid={`button-edit-transaction-${transaction.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-2 col-span-3">
                            <Label>Stock Item</Label>
                            <Select
                              value={editedStockItemId?.toString() || ""}
                              onValueChange={(value) => setEditedStockItemId(parseInt(value))}
                            >
                              <SelectTrigger data-testid="select-transaction-stock-item">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {allStockItems.map((item) => (
                                  <SelectItem key={item.id} value={item.id.toString()}>
                                    {item.code} - {item.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label>Quantity</Label>
                            <Input
                              type="number"
                              step="0.001"
                              value={editedQuantity}
                              onChange={(e) => setEditedQuantity(e.target.value)}
                              data-testid="input-transaction-quantity"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Rate</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={editedRate}
                              onChange={(e) => setEditedRate(e.target.value)}
                              data-testid="input-transaction-rate"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Amount</Label>
                            <Input
                              value={(parseFloat(editedQuantity || "0") * parseFloat(editedRate || "0")).toFixed(2)}
                              disabled
                              className="bg-muted"
                              data-testid="input-transaction-amount"
                            />
                          </div>

                          <div className="col-span-3 flex gap-2 justify-end">
                            <Button
                              onClick={() => handleSaveTransaction(transaction)}
                              size="sm"
                              disabled={updateTransactionMutation.isPending}
                              data-testid={`button-save-transaction-${transaction.id}`}
                            >
                              <Save className="h-4 w-4 mr-2" />
                              Save
                            </Button>
                            <Button
                              onClick={handleCancelTransactionEdit}
                              variant="outline"
                              size="sm"
                              disabled={updateTransactionMutation.isPending}
                              data-testid={`button-cancel-transaction-${transaction.id}`}
                            >
                              <X className="h-4 w-4 mr-2" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Quantity</p>
                            <p className="font-mono font-medium">{parseFloat(transaction.quantity).toFixed(3)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Rate</p>
                            <p className="font-mono font-medium">{parseFloat(transaction.rate).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Amount</p>
                            <p className="font-mono font-medium">{parseFloat(transaction.totalAmount).toFixed(2)}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
