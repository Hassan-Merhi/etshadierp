import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Package, Barcode, Trash2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CreateBaleDialog } from "../components/CreateBaleDialog";
import type { ProductionBale, BaleProduct, Location } from "@shared/schema";

type BaleWithProduct = {
  bale: ProductionBale;
  product: BaleProduct | null;
  location: Location | null;
};

export default function ProductionBales() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [baleToDelete, setBaleToDelete] = useState<ProductionBale | null>(null);
  const { toast } = useToast();

  const { data: bales, isLoading } = useQuery<BaleWithProduct[]>({
    queryKey: ["/api/production-bales"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/production-bales/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/production-bales"] });
      toast({
        title: "Success",
        description: "Bale deleted successfully",
      });
      setDeleteDialogOpen(false);
      setBaleToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (bale: ProductionBale) => {
    setBaleToDelete(bale);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (baleToDelete) {
      deleteMutation.mutate(baleToDelete.id);
    }
  };

  const filteredBales = bales?.filter(({ bale }) => {
    if (statusFilter === "all") return true;
    return bale.status === statusFilter;
  });

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "LABEL_PRINTED":
        return "outline";
      case "PRESSED":
        return "default";
      case "IN_STOCK":
        return "secondary";
      case "RESERVED":
        return "outline";
      case "SOLD":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Production Bales</h1>
          <p className="text-muted-foreground mt-1">
            Create and track bales from mix batches
          </p>
        </div>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          data-testid="button-create-bale"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Bales
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Bale List</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48" data-testid="select-status-filter">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Bales</SelectItem>
                <SelectItem value="LABEL_PRINTED">Label Printed</SelectItem>
                <SelectItem value="PRESSED">Pressed</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredBales && filteredBales.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Total Weight (kg)</TableHead>
                  <TableHead className="text-right">Cost/kg</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBales.map(({ bale, product, location }) => (
                  <TableRow
                    key={bale.id}
                    data-testid={`row-bale-${bale.id}`}
                  >
                    <TableCell className="font-mono">
                      <div className="flex items-center gap-2">
                        <Barcode className="h-4 w-4 text-muted-foreground" />
                        {bale.barcodeValue}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product ? (
                        <div>
                          <div className="font-medium">{product.name}</div>
                          <div className="text-sm text-muted-foreground font-mono">
                            {product.code}
                          </div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground">
                          {bale.category} - {bale.grade}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {bale.quantity.toLocaleString()} bales
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {parseFloat(bale.weightKg).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(bale.costPerKg).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${parseFloat(bale.totalCost).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {location ? (
                        <Badge variant="outline">{location.name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(bale.status)}>
                        {bale.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteClick(bale)}
                        data-testid={`button-delete-${bale.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No bales found</h3>
              <p className="text-muted-foreground mt-2">
                {statusFilter === "all"
                  ? "Create your first bale to get started"
                  : "No bales found with the selected status"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateBaleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bale Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this bale record? This action cannot be undone.
              {baleToDelete && (
                <div className="mt-2 font-mono text-sm">
                  Barcode: {baleToDelete.barcodeValue} ({baleToDelete.quantity} bales)
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
