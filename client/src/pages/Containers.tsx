import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Package, Eye } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Container, Supplier } from "@shared/schema";

export default function Containers() {
  const { data: containers = [], isLoading } = useQuery<Container[]>({
    queryKey: ["/api/containers"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const getSupplierName = (supplierId: number) => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    return supplier ? supplier.legalName : "Unknown";
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Container Tracking</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track containers and manage offloading
          </p>
        </div>
        <Link href="/po-import">
          <Button className="gap-2" data-testid="button-import-po">
            <Plus className="h-4 w-4" />
            Import PO
          </Button>
        </Link>
      </div>

      {containers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No containers yet</h2>
            <p className="text-muted-foreground mb-4">
              Import your first purchase order to get started
            </p>
            <Link href="/po-import">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Import PO
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {containers.map((container) => (
            <Link key={container.id} href={`/containers/${container.id}`}>
              <Card
                className="p-6 hover-elevate cursor-pointer"
                data-testid={`card-container-${container.id}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold font-mono">
                        {container.containerNumber}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {getSupplierName(container.supplierId)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={container.status === "OTW" ? "default" : "secondary"}>
                    {container.status}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Grand Total</span>
                    <span className="font-mono font-medium">
                      ${parseFloat(container.grandTotal || "0").toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Import Date</span>
                    <span className="font-mono">
                      {new Date(container.importDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button className="w-full mt-4" size="sm" variant="outline">
                  <Eye className="h-4 w-4 mr-2" />
                  View Details
                </Button>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
