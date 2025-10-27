import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Package, DollarSign, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Supplier } from "@shared/schema";

interface ContainerDetailData {
  container: any;
  pos: any[];
  charges: any[];
}

export default function ContainerDetail() {
  const params = useParams();
  const containerId = params.id;

  const { data: containerData, isLoading } = useQuery<ContainerDetailData>({
    queryKey: [`/api/containers/${containerId}`],
    enabled: !!containerId,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!containerData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Container not found</h2>
        <Link href="/containers">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Containers
          </Button>
        </Link>
      </div>
    );
  }

  const { container, pos, charges } = containerData;
  const supplier = suppliers.find((s: any) => s.id === container.supplierId);

  const itemsTotal = parseFloat(container.itemsTotal || "0");
  const chargesTotal = parseFloat(container.chargesTotal || "0");
  const grandTotal = parseFloat(container.grandTotal || "0");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/containers">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-container-number">
            Container {container.containerNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            Imported on {new Date(container.importDate).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={container.status === "OTW" ? "default" : "secondary"} data-testid="badge-status">
          {container.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Supplier</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold" data-testid="text-supplier">
              {supplier ? supplier.legalName : "Unknown"}
            </div>
            {supplier && (
              <p className="text-xs text-muted-foreground">{supplier.code}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Items Total</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-items-total">
              ${itemsTotal.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              {pos.reduce((sum: number, po: any) => sum + po.items.length, 0)} items in {pos.length} PO(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Grand Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-grand-total">
              ${grandTotal.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              Including ${Math.abs(chargesTotal).toFixed(2)} in charges
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders & Items</CardTitle>
        </CardHeader>
        <CardContent>
          {pos.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">No purchase orders found</p>
          ) : (
            <div className="space-y-6">
              {pos.map((po: any) => (
                <div key={po.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold" data-testid={`text-po-${po.poNumber}`}>
                      PO: {po.poNumber}
                    </h3>
                    <div className="text-sm">
                      <span className="text-muted-foreground">Currency: </span>
                      <span className="font-medium">{po.currency}</span>
                      <span className="text-muted-foreground ml-4">Total: </span>
                      <span className="font-semibold">${parseFloat(po.itemsTotal).toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item Name</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Line Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {po.items.map((item: any) => (
                          <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                            <TableCell className="font-medium">{item.itemName}</TableCell>
                            <TableCell className="text-right">{parseFloat(item.quantity).toFixed(2)}</TableCell>
                            <TableCell className="text-right">${parseFloat(item.rate).toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold">
                              ${parseFloat(item.lineTotal).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {charges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extra Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Charge Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {charges.map((charge: any) => (
                    <TableRow key={charge.id} data-testid={`row-charge-${charge.chargeType.toLowerCase().replace(/\s/g, "-")}`}>
                      <TableCell className="font-medium">{charge.chargeType}</TableCell>
                      <TableCell className={`text-right font-semibold ${parseFloat(charge.amount) < 0 ? "text-red-500" : ""}`}>
                        ${parseFloat(charge.amount).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-bold">Total Charges</TableCell>
                    <TableCell className="text-right font-bold">
                      ${chargesTotal.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items Total:</span>
              <span className="font-semibold">${itemsTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Charges Total:</span>
              <span className="font-semibold">${chargesTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t">
              <span className="text-lg font-bold">Grand Total:</span>
              <span className="text-lg font-bold">${grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
