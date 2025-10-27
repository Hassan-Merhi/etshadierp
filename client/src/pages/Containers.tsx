import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Upload, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

//todo: remove mock functionality
const mockContainers = [
  {
    id: "1",
    containerNo: "CONT-2024-001",
    status: "On The Way",
    items: 450,
    estimatedArrival: "2024-11-15",
    supplier: "Global Textiles Ltd",
  },
  {
    id: "2",
    containerNo: "CONT-2024-002",
    status: "Arrived",
    items: 380,
    estimatedArrival: "2024-10-28",
    supplier: "Premium Imports Inc",
  },
  {
    id: "3",
    containerNo: "CONT-2024-003",
    status: "Offloading",
    items: 520,
    estimatedArrival: "2024-10-25",
    supplier: "Fashion Wholesale Co",
  },
];

export default function Containers() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Container Tracking</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track containers and manage offloading
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" data-testid="button-import-excel">
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" data-testid="button-add-container">
                <Plus className="h-4 w-4" />
                Add Container
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Container</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="containerNo">Container Number</Label>
                  <Input
                    id="containerNo"
                    placeholder="CONT-2024-XXX"
                    data-testid="input-container-no"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier">Supplier</Label>
                  <Input
                    id="supplier"
                    placeholder="Supplier name"
                    data-testid="input-supplier"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="items">Number of Items</Label>
                  <Input
                    id="items"
                    type="number"
                    placeholder="0"
                    data-testid="input-items"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="arrival">Estimated Arrival</Label>
                  <Input
                    id="arrival"
                    type="date"
                    data-testid="input-arrival"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    console.log("Container added");
                    setDialogOpen(false);
                  }}
                  data-testid="button-save"
                >
                  Save Container
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockContainers.map((container) => (
          <Card
            key={container.id}
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
                    {container.containerNo}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {container.supplier}
                  </p>
                </div>
              </div>
              <Badge
                variant={
                  container.status === "On The Way"
                    ? "secondary"
                    : container.status === "Arrived"
                    ? "default"
                    : "outline"
                }
              >
                {container.status}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Items</span>
                <span className="font-mono font-medium">{container.items}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Est. Arrival</span>
                <span className="font-mono">{container.estimatedArrival}</span>
              </div>
            </div>
            {container.status === "Arrived" && (
              <Button className="w-full mt-4" size="sm" data-testid={`button-offload-${container.id}`}>
                Start Offloading
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
