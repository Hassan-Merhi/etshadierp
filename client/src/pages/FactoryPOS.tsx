import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useReactToPrint } from "react-to-print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ShoppingCart, Printer, Plus, Trash2, Search, Package, Receipt, History, X, Check, MapPin
} from "lucide-react";

interface CartItem {
  productId: number;
  productName: string;
  articleCode: string;
  availableQty: number;
  quantity: number;
  unitPrice: number;
}

interface InventoryItem {
  productId: number;
  productName: string;
  articleCode: string;
  category: string | null;
  quantity: number;
  sellingPrice: string;
}

function formatNum(v: string | number) {
  const n = parseFloat(String(v));
  if (isNaN(n)) return "0.00";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FactoryPOS() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [locationId, setLocationId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [cashAccountId, setCashAccountId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [printSale, setPrintSale] = useState<any>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [voidId, setVoidId] = useState<number | null>(null);
  const [tab, setTab] = useState("pos");

  const { data: locations } = useQuery<any[]>({ queryKey: ["/api/locations"] });
  const { data: inventory, isLoading: invLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/factory/location-inventory", locationId],
    queryFn: async () => {
      if (!locationId) return [];
      const res = await fetch(`/api/factory/location-inventory/${locationId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!locationId,
  });
  const { data: ledgerAccounts } = useQuery<any[]>({ queryKey: ["/api/ledger-accounts"] });
  const cashAccounts = (ledgerAccounts || []).filter((a: any) => a.accountType === "Cash");

  const { data: sales, isLoading: salesLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/pos/sales"],
  });

  const { data: companyInfo } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const filteredInventory = (inventory || []).filter(item =>
    !search || item.productName.toLowerCase().includes(search.toLowerCase()) || item.articleCode?.toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (item: InventoryItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.productId === item.productId);
      if (existing) {
        if (existing.quantity >= item.quantity) {
          toast({ title: "Not enough stock", description: `Only ${item.quantity} available`, variant: "destructive" });
          return prev;
        }
        return prev.map(c => c.productId === item.productId ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, {
        productId: item.productId,
        productName: item.productName,
        articleCode: item.articleCode,
        availableQty: item.quantity,
        quantity: 1,
        unitPrice: parseFloat(item.sellingPrice || "0"),
      }];
    });
  };

  const updateCartItem = (productId: number, field: "quantity" | "unitPrice", value: string) => {
    setCart(prev => prev.map(c => {
      if (c.productId !== productId) return c;
      if (field === "quantity") {
        const qty = parseInt(value) || 1;
        if (qty > c.availableQty) {
          toast({ title: "Not enough stock", description: `Only ${c.availableQty} available`, variant: "destructive" });
          return c;
        }
        return { ...c, quantity: Math.max(1, qty) };
      }
      return { ...c, unitPrice: parseFloat(value) || 0 };
    }));
  };

  const removeFromCart = (productId: number) => {
    setCart(prev => prev.filter(c => c.productId !== productId));
  };

  const total = cart.reduce((s, c) => s + c.quantity * c.unitPrice, 0);
  const ccPrefix = currencyCode !== "USD" ? `${currencyCode} ` : "$";

  const handlePrint = useReactToPrint({ contentRef: printRef });

  const saleMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/factory/pos/sale", data),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory", locationId] });
      // Build print data
      setPrintSale({
        ...data,
        items: cart,
        customerName,
        currencyCode,
        total,
        txDate,
        companyName: selectedCompany?.name || "",
      });
      setCart([]);
      setCustomerName("");
      setNotes("");
      toast({ title: "Sale recorded", description: `${data.saleNumber} – ${ccPrefix}${formatNum(total)}` });
      setTimeout(() => handlePrint(), 300);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create sale", variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/pos/sales/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/pos/sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/location-inventory", locationId] });
      setVoidId(null);
      toast({ title: "Sale voided" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!locationId) return toast({ title: "Select a location", variant: "destructive" });
    if (cart.length === 0) return toast({ title: "Cart is empty", variant: "destructive" });
    saleMutation.mutate({
      locationId: parseInt(locationId),
      customerName: customerName || null,
      notes: notes || null,
      txDate,
      currencyCode,
      cashAccountId: cashAccountId ? parseInt(cashAccountId) : null,
      items: cart.map(c => ({
        productId: c.productId,
        productName: c.productName,
        articleCode: c.articleCode,
        quantity: c.quantity,
        unitPrice: String(c.unitPrice),
      })),
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <ShoppingCart className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Factory POS</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pos" data-testid="tab-pos"><ShoppingCart className="h-4 w-4 mr-1" />New Sale</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history"><History className="h-4 w-4 mr-1" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="pos" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left: Product Browser */}
            <div className="lg:col-span-2 space-y-3">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <Select value={locationId} onValueChange={setLocationId}>
                      <SelectTrigger className="w-52" data-testid="select-location">
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        {(locations || []).map((l: any) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1 min-w-40">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-8"
                        placeholder="Search products..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        data-testid="input-product-search"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {!locationId ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      Select a location to browse products
                    </div>
                  ) : invLoading ? (
                    <div className="p-8 text-center text-muted-foreground">Loading inventory...</div>
                  ) : filteredInventory.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">No products in stock</div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
                      {filteredInventory.map(item => {
                        const inCart = cart.find(c => c.productId === item.productId);
                        const price = parseFloat(item.sellingPrice || "0");
                        return (
                          <button
                            key={item.productId}
                            onClick={() => addToCart(item)}
                            className="text-left rounded-md border p-3 hover-elevate active-elevate-2 space-y-1"
                            data-testid={`card-product-${item.productId}`}
                          >
                            <div className="font-medium text-sm leading-tight line-clamp-2">{item.productName}</div>
                            {item.articleCode && <div className="text-xs text-muted-foreground">{item.articleCode}</div>}
                            {item.category && <div className="text-xs text-muted-foreground">{item.category}</div>}
                            <div className="flex items-center justify-between gap-1 mt-1">
                              <Badge variant="outline" className="text-xs">Qty: {item.quantity}</Badge>
                              {price > 0 && <span className="text-xs font-semibold text-primary">{ccPrefix}{formatNum(price)}</span>}
                            </div>
                            {inCart && <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><Check className="h-3 w-3" />In cart: {inCart.quantity}</div>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Cart + Form */}
            <div className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-4 w-4" />Sale Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={txDate} onChange={e => setTxDate(e.target.value)} data-testid="input-sale-date" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Currency</Label>
                      <Select value={currencyCode} onValueChange={setCurrencyCode}>
                        <SelectTrigger data-testid="select-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                          <SelectItem value="LBP">LBP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Customer Name (optional)</Label>
                    <Input placeholder="Walk-in customer" value={customerName} onChange={e => setCustomerName(e.target.value)} data-testid="input-customer-name" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cash Account</Label>
                    <Select value={cashAccountId} onValueChange={setCashAccountId}>
                      <SelectTrigger data-testid="select-cash-account">
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                      <SelectContent>
                        {cashAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Textarea placeholder="Optional notes..." value={notes} onChange={e => setNotes(e.target.value)} className="resize-none text-sm" rows={2} data-testid="input-notes" />
                  </div>
                </CardContent>
              </Card>

              {/* Cart */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" />Cart</span>
                    {cart.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setCart([])} className="text-xs h-7">
                        <X className="h-3 w-3 mr-1" />Clear
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {cart.length === 0 ? (
                    <div className="p-6 text-center text-muted-foreground text-sm">Cart is empty</div>
                  ) : (
                    <div className="divide-y">
                      {cart.map(item => (
                        <div key={item.productId} className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium leading-tight">{item.productName}</div>
                              {item.articleCode && <div className="text-xs text-muted-foreground">{item.articleCode}</div>}
                            </div>
                            <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0" onClick={() => removeFromCart(item.productId)} data-testid={`button-remove-cart-${item.productId}`}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                              <Label className="text-xs text-muted-foreground">Qty (max {item.availableQty})</Label>
                              <Input
                                type="number"
                                min="1"
                                max={item.availableQty}
                                value={item.quantity}
                                onChange={e => updateCartItem(item.productId, "quantity", e.target.value)}
                                className="h-8 text-sm"
                                data-testid={`input-qty-${item.productId}`}
                              />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-xs text-muted-foreground">Price ({currencyCode})</Label>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={e => updateCartItem(item.productId, "unitPrice", e.target.value)}
                                className="h-8 text-sm"
                                data-testid={`input-price-${item.productId}`}
                              />
                            </div>
                          </div>
                          <div className="text-right text-sm font-semibold">
                            {ccPrefix}{formatNum(item.quantity * item.unitPrice)}
                          </div>
                        </div>
                      ))}
                      <div className="p-3 bg-muted/30 flex items-center justify-between">
                        <span className="font-semibold text-sm">Total</span>
                        <span className="text-xl font-bold tabular-nums">{ccPrefix}{formatNum(total)}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={cart.length === 0 || saleMutation.isPending}
                data-testid="button-submit-sale"
              >
                <Printer className="h-4 w-4 mr-2" />
                {saleMutation.isPending ? "Processing..." : `Charge ${ccPrefix}${formatNum(total)}`}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Sales History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {salesLoading ? (
                <div className="p-6 text-center text-muted-foreground">Loading...</div>
              ) : !sales || sales.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">No sales yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sale #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map(sale => {
                      const pfx = sale.currencyCode !== "USD" ? `${sale.currencyCode} ` : "$";
                      return (
                        <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                          <TableCell className="font-mono text-sm">{sale.saleNumber}</TableCell>
                          <TableCell className="text-sm">{sale.txDate}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{sale.customerName || "—"}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{pfx}{formatNum(sale.totalAmount)}</TableCell>
                          <TableCell>
                            <Badge variant={sale.status === "VOIDED" ? "secondary" : "outline"}>
                              {sale.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {sale.status !== "VOIDED" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 text-destructive"
                                onClick={() => setVoidId(sale.id)}
                                data-testid={`button-void-${sale.id}`}
                              >
                                Void
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Print Receipt (hidden) */}
      {printSale && (
        <div className="hidden">
          <div ref={printRef} className="p-6 font-mono text-sm max-w-sm mx-auto">
            <div className="text-center mb-4">
              <div className="text-lg font-bold">{printSale.companyName}</div>
              <div className="text-xs text-gray-500">Factory POS Receipt</div>
              <div className="mt-1 text-xs">#{printSale.saleNumber}</div>
              <div className="text-xs">{printSale.txDate}</div>
            </div>
            {printSale.customerName && (
              <div className="mb-2 text-xs">Customer: {printSale.customerName}</div>
            )}
            <div className="border-t border-b py-2 my-2 space-y-1">
              {printSale.items.map((item: CartItem, i: number) => (
                <div key={i} className="flex justify-between gap-2">
                  <div>
                    <div>{item.productName}</div>
                    <div className="text-xs text-gray-500">{item.quantity} × {ccPrefix}{formatNum(item.unitPrice)}</div>
                  </div>
                  <div className="font-semibold">{ccPrefix}{formatNum(item.quantity * item.unitPrice)}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-bold text-base mt-2">
              <span>TOTAL</span>
              <span>{ccPrefix}{formatNum(printSale.total)}</span>
            </div>
            <div className="text-center mt-4 text-xs text-gray-400">Thank you!</div>
          </div>
        </div>
      )}

      {/* Void confirmation */}
      <AlertDialog open={voidId !== null} onOpenChange={() => setVoidId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this sale?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the sale as voided and restore the bale inventory. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setVoidId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => voidId !== null && voidMutation.mutate(voidId)}
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending ? "Voiding..." : "Void Sale"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
