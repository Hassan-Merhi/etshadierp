import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Edit, Save, X, Package, Plus, Trash2, ExternalLink, BarChart3 } from "lucide-react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import type { Location as LocationType } from "@shared/schema";

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
  sellingPrice: string;
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

interface CodeAlias {
  id: number;
  stockItemId: number;
  companyId: number;
  aliasCode: string;
  description: string | null;
  createdAt: string;
}

export function StockItemDetailsDialog({
  open,
  onOpenChange,
  stockItemId,
  stockItemName,
}: StockItemDetailsDialogProps) {
  const { toast } = useToast();
  const [_location, navigate] = useLocation();
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedCode, setEditedCode] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedBarcode, setEditedBarcode] = useState("");
  const [editedUom, setEditedUom] = useState("");
  const [editedStockGroupId, setEditedStockGroupId] = useState<number | null>(null);
  const [editedSellingPrice, setEditedSellingPrice] = useState("");
  
  const [editingTransaction, setEditingTransaction] = useState<number | null>(null);
  const [editedStockItemId, setEditedStockItemId] = useState<number | null>(null);
  const [editedQuantity, setEditedQuantity] = useState("");
  const [editedRate, setEditedRate] = useState("");

  // Code aliases state
  const [newAliasCode, setNewAliasCode] = useState("");
  const [newAliasDescription, setNewAliasDescription] = useState("");

  // Location prices state
  const [newLocationId, setNewLocationId] = useState<string>("");
  const [newLocationPrice, setNewLocationPrice] = useState("");
  const [editingLocationPriceId, setEditingLocationPriceId] = useState<number | null>(null);

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

  // Fetch code aliases
  const { data: codeAliases = [], isLoading: loadingAliases } = useQuery<CodeAlias[]>({
    queryKey: [`/api/stock-items/${stockItemId}/code-aliases`],
    enabled: open,
  });

  // Fetch locations
  const { data: locations = [] } = useQuery<LocationType[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  // Fetch location prices
  const { data: locationPrices = [], isLoading: loadingLocationPrices } = useQuery<any[]>({
    queryKey: [`/api/stock-items/${stockItemId}/location-prices`],
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

  // Create code alias mutation
  const createAliasMutation = useMutation({
    mutationFn: async (aliasData: { aliasCode: string; description?: string }) => {
      const response = await apiRequest("POST", `/api/stock-items/${stockItemId}/code-aliases`, aliasData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}/code-aliases`] });
      setNewAliasCode("");
      setNewAliasDescription("");
      toast({
        title: "Alias Created",
        description: "Code alias created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create code alias",
        variant: "destructive",
      });
    },
  });

  // Delete code alias mutation
  const deleteAliasMutation = useMutation({
    mutationFn: async (aliasId: number) => {
      await apiRequest("DELETE", `/api/stock-item-code-aliases/${aliasId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}/code-aliases`] });
      toast({
        title: "Alias Deleted",
        description: "Code alias deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete code alias",
        variant: "destructive",
      });
    },
  });

  // Create/update location price mutation
  const upsertLocationPriceMutation = useMutation({
    mutationFn: async (data: { locationId: number; sellingPrice: string }) => {
      return await apiRequest("POST", `/api/stock-items/${stockItemId}/location-prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}/location-prices`] });
      setNewLocationId("");
      setNewLocationPrice("");
      setEditingLocationPriceId(null);
      toast({
        title: "Success",
        description: "Location price saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed",
        description: error.message || "Failed to save location price",
        variant: "destructive",
      });
    },
  });

  // Delete location price mutation
  const deleteLocationPriceMutation = useMutation({
    mutationFn: async (priceId: number) => {
      await apiRequest("DELETE", `/api/stock-item-location-prices/${priceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock-items/${stockItemId}/location-prices`] });
      toast({
        title: "Deleted",
        description: "Location price deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete location price",
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
      setEditedSellingPrice(stockItem.sellingPrice || "0");
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
      sellingPrice: editedSellingPrice || "0",
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

  const handleAddAlias = () => {
    if (!newAliasCode || newAliasCode.trim() === "") {
      toast({
        title: "Validation Error",
        description: "Alias code is required",
        variant: "destructive",
      });
      return;
    }

    createAliasMutation.mutate({
      aliasCode: newAliasCode.trim(),
      description: newAliasDescription.trim() || undefined,
    });
  };

  const handleDeleteAlias = (aliasId: number) => {
    if (confirm("Are you sure you want to delete this code alias?")) {
      deleteAliasMutation.mutate(aliasId);
    }
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details" data-testid="tab-details">
              Item Details
            </TabsTrigger>
            <TabsTrigger value="prices" data-testid="tab-location-prices">
              Location Prices
            </TabsTrigger>
            <TabsTrigger value="aliases" data-testid="tab-aliases">
              Code Aliases
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

                  <div className="space-y-2">
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

                  <div className="space-y-2">
                    <Label htmlFor="sellingPrice">Selling Price</Label>
                    {isEditingDetails ? (
                      <Input
                        id="sellingPrice"
                        type="number"
                        step="0.01"
                        value={editedSellingPrice}
                        onChange={(e) => setEditedSellingPrice(e.target.value)}
                        data-testid="input-selling-price"
                      />
                    ) : (
                      <p className="text-sm p-2 bg-muted rounded" data-testid="text-selling-price">
                        {stockItem.sellingPrice || "0.00"}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="prices" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="font-medium mb-3">Add Location Price</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="locationSelect">Location *</Label>
                    <Select value={newLocationId} onValueChange={setNewLocationId}>
                      <SelectTrigger data-testid="select-location-price">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id.toString()}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="locationPrice">Selling Price *</Label>
                    <Input
                      id="locationPrice"
                      type="number"
                      step="0.01"
                      value={newLocationPrice}
                      onChange={(e) => setNewLocationPrice(e.target.value)}
                      placeholder="0.00"
                      data-testid="input-location-price"
                    />
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button
                    onClick={() => {
                      if (!newLocationId || !newLocationPrice) {
                        toast({
                          title: "Error",
                          description: "Please fill in all fields",
                          variant: "destructive",
                        });
                        return;
                      }
                      upsertLocationPriceMutation.mutate({
                        locationId: parseInt(newLocationId),
                        sellingPrice: newLocationPrice,
                      });
                    }}
                    disabled={upsertLocationPriceMutation.isPending}
                    data-testid="button-add-location-price"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Price
                  </Button>
                </div>
              </Card>

              <div>
                <h3 className="font-medium mb-3">Location Prices</h3>
                {loadingLocationPrices ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-muted-foreground">Loading prices...</p>
                  </div>
                ) : locationPrices.length === 0 ? (
                  <div className="flex items-center justify-center py-8 border rounded-lg">
                    <p className="text-muted-foreground">No location prices set</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {locationPrices.map((price) => (
                      <Card key={price.id} className="p-4" data-testid={`price-${price.id}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium" data-testid={`location-name-${price.id}`}>
                              {price.locationName}
                            </p>
                            <p className="text-sm text-muted-foreground" data-testid={`price-value-${price.id}`}>
                              {parseFloat(price.sellingPrice).toFixed(2)}
                            </p>
                          </div>
                          <Button
                            onClick={() => {
                              if (confirm("Delete this location price?")) {
                                deleteLocationPriceMutation.mutate(price.id);
                              }
                            }}
                            variant="outline"
                            size="sm"
                            disabled={deleteLocationPriceMutation.isPending}
                            data-testid={`button-delete-price-${price.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="aliases" className="space-y-4 mt-4">
            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="font-medium mb-3">Add New Alias</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="aliasCode">Alias Code *</Label>
                    <Input
                      id="aliasCode"
                      value={newAliasCode}
                      onChange={(e) => setNewAliasCode(e.target.value)}
                      placeholder="ALT-CODE-001"
                      data-testid="input-alias-code"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="aliasDescription">Description (Optional)</Label>
                    <Input
                      id="aliasDescription"
                      value={newAliasDescription}
                      onChange={(e) => setNewAliasDescription(e.target.value)}
                      placeholder="Old supplier code"
                      data-testid="input-alias-description"
                    />
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button
                    onClick={handleAddAlias}
                    disabled={createAliasMutation.isPending}
                    data-testid="button-add-alias"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Alias
                  </Button>
                </div>
              </Card>

              <div>
                <h3 className="font-medium mb-3">Existing Aliases</h3>
                {loadingAliases ? (
                  <div className="flex items-center justify-center py-8">
                    <p className="text-muted-foreground">Loading aliases...</p>
                  </div>
                ) : codeAliases.length === 0 ? (
                  <div className="flex items-center justify-center py-8 border rounded-lg">
                    <p className="text-muted-foreground">No code aliases found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {codeAliases.map((alias) => (
                      <Card key={alias.id} className="p-4" data-testid={`alias-${alias.id}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-mono font-medium" data-testid={`alias-code-${alias.id}`}>
                              {alias.aliasCode}
                            </p>
                            {alias.description && (
                              <p className="text-sm text-muted-foreground mt-1" data-testid={`alias-description-${alias.id}`}>
                                {alias.description}
                              </p>
                            )}
                          </div>
                          <Button
                            onClick={() => handleDeleteAlias(alias.id)}
                            variant="outline"
                            size="sm"
                            disabled={deleteAliasMutation.isPending}
                            data-testid={`button-delete-alias-${alias.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="mt-4">
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <BarChart3 className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-lg">Stock Item Monthly Summary</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  View monthly inwards, outwards, and closing balances for this stock item with detailed transaction history.
                </p>
              </div>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/stock-items/${stockItemId}/history`);
                }}
                data-testid="button-view-history"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Monthly Summary
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
