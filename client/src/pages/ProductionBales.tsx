import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package, Barcode } from "lucide-react";
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
import { CreateBaleDialog } from "../components/CreateBaleDialog";
import type { ProductionBale, BaleProduct } from "@shared/schema";

type BaleWithProduct = {
  bale: ProductionBale;
  product: BaleProduct | null;
};

export default function ProductionBales() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: bales, isLoading } = useQuery<BaleWithProduct[]>({
    queryKey: ["/api/production-bales"],
  });

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
                  <TableHead>Bale Code</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Weight (kg)</TableHead>
                  <TableHead className="text-right">Cost/kg</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBales.map(({ bale, product }) => (
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
                    <TableCell className="font-medium">{bale.baleCode}</TableCell>
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
                    <TableCell>{bale.warehouseLocation || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(bale.status)}>
                        {bale.status.replace("_", " ")}
                      </Badge>
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
    </div>
  );
}
