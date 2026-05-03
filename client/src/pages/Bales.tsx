import { useState, useRef, useEffect } from "react";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
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
  const { formatDisplayDate } = useDateFormat();
  const [, navigate] = useLocation();
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [scanMode, setScanMode] = useState<"quick" | "review">("quick");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [showBaleDialog, setShowBaleDialog] = useState(false);
  const [scannedBale, setScannedBale] = useState<Partial<InsertBale> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [pendingBarcodeToMark, setPendingBarcodeToMark] = useState<number | null>(null);
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
      datePressed: new Date().toLocaleDateString('en-CA'),
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
      setBarcodeInput("");
      
      // Mark pending barcode as used after successful creation
      if (pendingBarcodeToMark) {
        fetch(`/api/pending-barcodes/${pendingBarcodeToMark}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ used: true }),
        });
        setPendingBarcodeToMark(null);
      }
      
      if (barcodeInputRef.current) {
        barcodeInputRef.current.value = "";
        barcodeInputRef.current.focus();
      }
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error creating bale",
        description: error.message,
        variant: "destructive",
      });
      setPendingBarcodeToMark(null);
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
      if ((error as any)?._handledGlobally) return;
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
        if (barcodeInputRef.current) {
          barcodeInputRef.current.focus();
        }
        return;
      }

      // Check if barcode exists in pending barcodes (pre-printed labels)
      const pendingResponse = await fetch(`/api/pending-barcodes/${encodeURIComponent(barcode)}`, {
        credentials: "include",
      });
      
      let pendingBarcode: any = null;
      if (pendingResponse.ok) {
        pendingBarcode = await pendingResponse.json();
      }

      // Bale doesn't exist - create new one
      if (scanMode === "quick") {
        // Quick mode - immediately create with defaults (or pending barcode data)
        if (!selectedCompany) return;
        
        // Set pending barcode ID to mark as used after successful creation
        if (pendingBarcode) {
          setPendingBarcodeToMark(pendingBarcode.id);
        }
        
        const newBale: z.infer<typeof insertBaleSchema> = {
          companyId: selectedCompany.id,
          barcode,
          category: pendingBarcode?.category || "Unsorted",
          grade: pendingBarcode?.grade || "A",
          origin: pendingBarcode?.origin || "EU",
          weight: "1",
          datePressed: new Date().toLocaleDateString('en-CA'),
        };
        createBale.mutate(newBale);
        setBarcodeInput("");
      } else {
        // Review mode - show dialog with barcode pre-filled (use pending data if available)
        setScannedBale({ barcode });
        form.setValue("barcode", barcode);
        if (pendingBarcode?.category) form.setValue("category", pendingBarcode.category);
        if (pendingBarcode?.grade) form.setValue("grade", pendingBarcode.grade);
        if (pendingBarcode?.origin) form.setValue("origin", pendingBarcode.origin);
        
        // Set pending barcode ID to mark as used after successful creation
        if (pendingBarcode) {
          setPendingBarcodeToMark(pendingBarcode.id);
        }
        
        setShowBaleDialog(true);
        setBarcodeInput("");
      }
    } catch (error) {
      toast({
        title: "Error checking barcode",
        description: "Please try again",
        variant: "destructive",
      });
      if (barcodeInputRef.current) {
        barcodeInputRef.current.focus();
      }
    }
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleScan(barcodeInput);
    }
  };

  const onSubmit = (data: z.infer<typeof insertBaleSchema>) => {
    const submitData = {
      ...data,
      containerId: String(data.containerId) === "none" ? null : data.containerId,
    };
    createBale.mutate(submitData as InsertBale);
  };

  const filteredBales = bales.filter(
    (bale) =>
      (bale.barcode || "").toLowerCase().includes((searchTerm || "").toLowerCase()) ||
      (bale.category || "").toLowerCase().includes((searchTerm || "").toLowerCase()) ||
      (bale.grade || "").toLowerCase().includes((searchTerm || "").toLowerCase()) ||
      (bale.origin || "").toLowerCase().includes((searchTerm || "").toLowerCase())
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
          <PageHeader title="Factory Bales" subtitle="Manage factory bale inventory with barcode scanning" icon={<Package className="h-5 w-5" />} />
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
                  <TableCell>{formatDisplayDate(bale.datePressed)}</TableCell>
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
                        setPendingDelete(() => () => deleteBale.mutate(bale.id));
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
                          <SelectItem value="none">None</SelectItem>
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
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />
    </div>
  );
}
