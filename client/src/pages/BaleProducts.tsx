import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Package, Upload } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { CreateBaleProductDialog } from "../components/CreateBaleProductDialog";
import type { BaleProduct } from "@shared/schema";

export default function BaleProducts() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: products, isLoading } = useQuery<BaleProduct[]>({
    queryKey: ["/api/bale-products"],
  });

  const activeProducts = products?.filter((p) => p.active);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bale Products</h1>
          <p className="text-muted-foreground mt-1">
            Manage product types for bale production
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {}}
            data-testid="button-import-excel"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Excel
          </Button>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-create-product"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Product
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product List</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : activeProducts && activeProducts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeProducts.map((product) => (
                  <TableRow
                    key={product.id}
                    data-testid={`row-product-${product.id}`}
                  >
                    <TableCell className="font-mono font-medium">
                      {product.code}
                    </TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.active ? "secondary" : "outline"}>
                        {product.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(product.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Package className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No products found</h3>
              <p className="text-muted-foreground mt-2">
                Create your first product to get started
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateBaleProductDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
