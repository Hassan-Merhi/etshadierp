import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertBaleSchema, type Bale, type InsertBale } from "@shared/schema";
import { Package, Scan, Upload, Trash2, Plus, Search } from "lucide-react";
import { z } from "zod";

export default function Bales() {
  const [, navigate] = useLocation();
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [scanMode, setScanMode] = useState<"quick" | "review">("review");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [showBaleDialog, setShowBaleDialog] = useState(false);
  const [scannedBale, setScannedBale] = useState<Partial<InsertBale> | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const { data: bales = [], isLoading } = useQuery<Bale[]>({
    queryKey: ["/api/bales", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: containers = [] } = useQuery<any[]>({
    queryKey: ["/api/containers", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const form = useForm<z.infer<typeof insertBaleSchema>>({
    resolver: zodResolver(insertBaleSchema),
    defaultValues: {
      barcode: "",
      category: "",
      grade: "A",
      origin: "EU",
      weight: "",
      datePressed: new Date().toISOString().split("T")[0],
      price: "",
      currency: "USD",
      status: "AVAILABLE",
    },
  });

  const createBale = useMutation({
    mutationFn: async (data: InsertBale) => {
      return await apiRequest("POST", "/api/bales", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bales", selectedCompany?.id] });
      toast({ title: "Bale created successfully" });
      form.reset();
      setShowBaleDialog(false);
      setScannedBale(null);
      if (barcodeInputRef.current) {
        barcodeInputRef.current.value = "";
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error creating bale",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteBale = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/bales/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bales", selectedCompany?.id] });
      toast({ title: "Bale deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error deleting bale",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleScan = async (barcode: string) => {
    if (!barcode.trim()) return;

    try {
      // Check if bale already exists
      const response = await fetch(`/api/bales/barcode/${encodeURIComponent(barcode)}`, {
        credentials: "include",
      });

      if (response.ok) {
        const existingBale = await response.json();
        toast({
          title: "Bale already exists",
          description: `Barcode: ${barcode}`,
          variant: "destructive",
        });
        setBarcodeInput("");
        return;
      }

      // Bale doesn't exist - create new one
      if (scanMode === "quick") {
        // Quick mode - immediately create with defaults
        if (!selectedCompany) return;
        const newBale: z.infer<typeof insertBaleSchema> = {
          companyId: selectedCompany.id,
          barcode,
          category: "Unsorted",
          grade: "A",
          origin: "EU",
          weight: "1",
          datePressed: new Date().toISOString().split("T")[0],
        };
        createBale.mutate(newBale);
        setBarcodeInput("");
      } else {
        // Review mode - show dialog with barcode pre-filled
        setScannedBale({ barcode });
        form.setValue("barcode", barcode);
        setShowBaleDialog(true);
        setBarcodeInput("");
      }
    } catch (error) {
      toast({
        title: "Error checking barcode",
        description: "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleScan(barcodeInput);
    }
  };

  const onSubmit = (data: z.infer<typeof insertBaleSchema>) => {
    createBale.mutate(data);
  };

  const filteredBales = bales.filter(
    (bale) =>
      bale.barcode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bale.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bale.grade.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bale.origin.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!selectedCompany) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">Please select a company to manage bales</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="h-8 w-8" />
            Factory Bales
          </h1>
          <p className="text-muted-foreground">Manage factory bale inventory with barcode scanning</p>
        </div>
        <Button onClick={() => setShowBaleDialog(true)} data-testid="button-add-bale">
          <Plus className="h-4 w-4 mr-2" />
          Add Bale
        </Button>
      </div>

      {/* Barcode Scanner Section */}
      <Card className="p-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Barcode Scanner
            </h2>
            <div className="flex gap-2">
              <Badge
                variant={scanMode === "quick" ? "default" : "outline"}
                className="cursor-pointer hover-elevate"
                onClick={() => setScanMode("quick")}
                data-testid="badge-quick-mode"
              >
                Quick Add
              </Badge>
              <Badge
                variant={scanMode === "review" ? "default" : "outline"}
                className="cursor-pointer hover-elevate"
                onClick={() => setScanMode("review")}
                data-testid="badge-review-mode"
              >
                Review Mode
              </Badge>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder="Scan or enter barcode..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              className="font-mono text-lg"
              autoFocus
              data-testid="input-barcode-scanner"
            />
            <Button onClick={() => handleScan(barcodeInput)} data-testid="button-scan">
              <Scan className="h-4 w-4 mr-2" />
              Scan
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {scanMode === "quick"
              ? "Scan barcode to instantly create bale with default values"
              : "Scan barcode to review details before adding"}
          </p>
        </div>
      </Card>

      {/* Bales List */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">All Bales ({filteredBales.length})</h2>
          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bales..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
                data-testid="input-search-bales"
              />
            </div>
            <Button variant="outline" onClick={() => navigate("/import-bales")} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filteredBales.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {searchTerm ? "No bales match your search" : "No bales found. Scan or add a bale to get started."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Origin</TableHead>
                <TableHead className="text-right">Weight (kg)</TableHead>
                <TableHead>Date Pressed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBales.map((bale) => (
                <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                  <TableCell className="font-mono font-medium">{bale.barcode}</TableCell>
                  <TableCell>{bale.category}</TableCell>
                  <TableCell>
                    <Badge variant={bale.grade === "A" ? "default" : bale.grade === "B" ? "outline" : "secondary"}>
                      Grade {bale.grade}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{bale.origin}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{parseFloat(bale.weight).toLocaleString()}</TableCell>
                  <TableCell>{new Date(bale.datePressed).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        bale.status === "AVAILABLE" ? "default" : bale.status === "SOLD" ? "secondary" : "outline"
                      }
                    >
                      {bale.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Delete this bale?")) {
                          deleteBale.mutate(bale.id);
                        }
                      }}
                      data-testid={`button-delete-bale-${bale.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add/Edit Bale Dialog */}
      <Dialog open={showBaleDialog} onOpenChange={setShowBaleDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add New Bale</DialogTitle>
            <DialogDescription>Enter bale details to add to inventory</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="barcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Barcode *</FormLabel>
                      <FormControl>
                        <Input {...field} className="font-mono" data-testid="input-bale-barcode" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Children Cotton" data-testid="input-bale-category" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grade *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-bale-grade">
                            <SelectValue placeholder="Select grade" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="A">Grade A</SelectItem>
                          <SelectItem value="B">Grade B</SelectItem>
                          <SelectItem value="C">Grade C</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="origin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Origin *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-bale-origin">
                            <SelectValue placeholder="Select origin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="EU">EU</SelectItem>
                          <SelectItem value="AUS">AUS</SelectItem>
                          <SelectItem value="USA">USA</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weight (kg) *</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.001" data-testid="input-bale-weight" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="datePressed"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Pressed *</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" data-testid="input-bale-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="containerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Container (Optional)</FormLabel>
                      <Select onValueChange={(val) => field.onChange(val ? parseInt(val) : undefined)} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger data-testid="select-bale-container">
                            <SelectValue placeholder="Select container" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {containers.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.containerNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="0.01" data-testid="input-bale-price" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowBaleDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createBale.isPending} data-testid="button-submit-bale">
                  {createBale.isPending ? "Creating..." : "Create Bale"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
