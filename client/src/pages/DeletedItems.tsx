import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  MapPin,
  Package,
  FolderTree,
  BookOpen,
  Users,
  User,
  Truck,
  Building2,
  Loader2,
} from "lucide-react";

interface DeletedItem {
  id: number;
  type: string;
  name: string;
  code: string;
  accountType?: string;
  deletedAt: string;
}

interface DeletedItemsResponse {
  locations: DeletedItem[];
  stockItems: DeletedItem[];
  stockGroups: DeletedItem[];
  ledgerAccounts: DeletedItem[];
  employees: DeletedItem[];
  customers: DeletedItem[];
  suppliers: DeletedItem[];
  bankAccounts: DeletedItem[];
  totalCount: number;
}

const typeLabels: Record<string, string> = {
  location: "Location",
  stockItem: "Stock Item",
  stockGroup: "Stock Group",
  ledgerAccount: "Ledger Account",
  employee: "Employee",
  customer: "Customer",
  supplier: "Supplier",
  bankAccount: "Bank Account",
};

const typeIcons: Record<string, any> = {
  location: MapPin,
  stockItem: Package,
  stockGroup: FolderTree,
  ledgerAccount: BookOpen,
  employee: Users,
  customer: User,
  supplier: Truck,
  bankAccount: Building2,
};

export default function DeletedItems() {
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<string>("all");
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: "restore" | "delete";
    item: DeletedItem | null;
  }>({ open: false, action: "restore", item: null });

  const { data, isLoading, error } = useQuery<DeletedItemsResponse>({
    queryKey: ["/api/deleted-items"],
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: number }) => {
      return apiRequest("POST", `/api/deleted-items/${type}/${id}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deleted-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      toast({
        title: "Item Restored",
        description: "The item has been restored successfully.",
      });
      setConfirmDialog({ open: false, action: "restore", item: null });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore item",
        variant: "destructive",
      });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: number }) => {
      return apiRequest("DELETE", `/api/deleted-items/${type}/${id}/permanent`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deleted-items"] });
      toast({
        title: "Permanently Deleted",
        description: "The item has been permanently removed.",
        variant: "destructive",
      });
      setConfirmDialog({ open: false, action: "delete", item: null });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to permanently delete item",
        variant: "destructive",
      });
    },
  });

  const getAllItems = (): DeletedItem[] => {
    if (!data) return [];
    const allItems = [
      ...data.locations,
      ...data.stockItems,
      ...data.stockGroups,
      ...data.ledgerAccounts,
      ...data.employees,
      ...data.customers,
      ...data.suppliers,
      ...data.bankAccounts,
    ];
    if (filterType === "all") return allItems;
    return allItems.filter((item) => item.type === filterType);
  };

  const items = getAllItems();

  const handleRestore = (item: DeletedItem) => {
    setConfirmDialog({ open: true, action: "restore", item });
  };

  const handlePermanentDelete = (item: DeletedItem) => {
    setConfirmDialog({ open: true, action: "delete", item });
  };

  const confirmAction = () => {
    if (!confirmDialog.item) return;
    if (confirmDialog.action === "restore") {
      restoreMutation.mutate({
        type: confirmDialog.item.type,
        id: confirmDialog.item.id,
      });
    } else {
      permanentDeleteMutation.mutate({
        type: confirmDialog.item.type,
        id: confirmDialog.item.id,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-destructive">Failed to load deleted items</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2" data-testid="title-deleted-items">
                <Trash2 className="h-5 w-5" />
                Deleted Items
              </CardTitle>
              <CardDescription>
                View and manage deleted records. You can restore items or permanently delete them.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter:</span>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[180px]" data-testid="select-filter-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types ({data?.totalCount || 0})</SelectItem>
                  <SelectItem value="location">Locations ({data?.locations.length || 0})</SelectItem>
                  <SelectItem value="stockItem">Stock Items ({data?.stockItems.length || 0})</SelectItem>
                  <SelectItem value="stockGroup">Stock Groups ({data?.stockGroups.length || 0})</SelectItem>
                  <SelectItem value="ledgerAccount">Ledger Accounts ({data?.ledgerAccounts.length || 0})</SelectItem>
                  <SelectItem value="employee">Employees ({data?.employees.length || 0})</SelectItem>
                  <SelectItem value="customer">Customers ({data?.customers.length || 0})</SelectItem>
                  <SelectItem value="supplier">Suppliers ({data?.suppliers.length || 0})</SelectItem>
                  <SelectItem value="bankAccount">Bank Accounts ({data?.bankAccounts.length || 0})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12">
              <Trash2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">No deleted items</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {filterType === "all"
                  ? "Items you delete will appear here for recovery."
                  : `No deleted ${typeLabels[filterType]?.toLowerCase() || filterType}s found.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Deleted At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const IconComponent = typeIcons[item.type] || Package;
                  return (
                    <TableRow key={`${item.type}-${item.id}`} data-testid={`row-deleted-${item.type}-${item.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <IconComponent className="h-4 w-4 text-muted-foreground" />
                          <Badge variant="outline">
                            {typeLabels[item.type] || item.type}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.code || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{item.name}</span>
                          {item.accountType && (
                            <span className="text-xs text-muted-foreground">{item.accountType}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.deletedAt
                          ? format(new Date(item.deletedAt), "MMM d, yyyy h:mm a")
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestore(item)}
                            disabled={restoreMutation.isPending || permanentDeleteMutation.isPending}
                            data-testid={`button-restore-${item.type}-${item.id}`}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Restore
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handlePermanentDelete(item)}
                            disabled={restoreMutation.isPending || permanentDeleteMutation.isPending}
                            data-testid={`button-delete-permanent-${item.type}-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete Forever
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog({ ...confirmDialog, open })
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {confirmDialog.action === "delete" && (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              {confirmDialog.action === "restore"
                ? "Restore Item?"
                : "Permanently Delete Item?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === "restore" ? (
                <>
                  This will restore{" "}
                  <strong>
                    {confirmDialog.item?.name} ({confirmDialog.item?.code || "no code"})
                  </strong>{" "}
                  and make it active again.
                </>
              ) : (
                <>
                  This will permanently delete{" "}
                  <strong>
                    {confirmDialog.item?.name} ({confirmDialog.item?.code || "no code"})
                  </strong>
                  . This action cannot be undone and all associated data will be lost.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction}
              className={
                confirmDialog.action === "delete"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }
              data-testid="button-confirm-dialog"
            >
              {restoreMutation.isPending || permanentDeleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {confirmDialog.action === "restore" ? "Restore" : "Delete Forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
