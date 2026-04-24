import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Package, Container, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface OffloadResult {
  itemName: string;
  quantity: string;
  rate: string;
  lineTotal: string;
  poNumber: string;
  containerNumber: string;
  offloadDate: string | null;
  importDate: string | null;
  containerStatus: string;
  currency: string;
  supplierName: string | null;
}

export default function OffloadItemSearch() {
  const [input, setInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: results = [], isLoading } = useQuery<OffloadResult[]>({
    queryKey: ["/api/offload-item-search", searchTerm],
    queryFn: async () => {
      if (!searchTerm) return [];
      const r = await fetch(`/api/offload-item-search?q=${encodeURIComponent(searchTerm)}`);
      if (!r.ok) throw new Error("Search failed");
      return r.json();
    },
    enabled: !!searchTerm,
  });

  const handleSearch = () => {
    const trimmed = input.trim();
    if (trimmed) setSearchTerm(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const totalQty = results.reduce((sum, r) => sum + parseFloat(r.quantity || "0"), 0);
  const totalValue = results.reduce((sum, r) => sum + parseFloat(r.lineTotal || "0"), 0);
  const uniqueContainers = new Set(results.map((r) => r.containerNumber)).size;

  const currency = results[0]?.currency ?? "USD";

  const fmtQty = (v: string | number) =>
    Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtMoney = (v: string | number) =>
    Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Offload Item Search</h1>
        <p className="text-muted-foreground mt-1">Search any item name to see every offloaded container it arrived in</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Type item name e.g. MJS MIX CH WINTER BOOTS"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            data-testid="input-item-search"
          />
        </div>
        <Button onClick={handleSearch} disabled={!input.trim() || isLoading} data-testid="button-search">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
          Search
        </Button>
      </div>

      {searchTerm && !isLoading && results.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>No offloaded containers found for <strong>"{searchTerm}"</strong></p>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-1 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Containers</CardTitle>
                <Container className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="stat-containers">{uniqueContainers}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-1 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Qty (KG)</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="stat-qty">{fmtQty(totalQty)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-1 space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Value ({currency})</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="stat-value">{fmtMoney(totalValue)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                Results for &ldquo;{searchTerm}&rdquo;
                <Badge className="ml-2">{results.length} line{results.length !== 1 ? "s" : ""}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Container</TableHead>
                    <TableHead>Offload Date</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">Qty (KG)</TableHead>
                    <TableHead className="text-right">Price / KG</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((row, i) => {
                    return (
                    <TableRow key={i} data-testid={`row-result-${i}`}>
                      <TableCell className="font-medium">{row.itemName}</TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{row.containerNumber}</span>
                      </TableCell>
                      <TableCell>
                        {row.offloadDate ? format(new Date(row.offloadDate), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell>{row.poNumber}</TableCell>
                      <TableCell className="text-muted-foreground">{row.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-right">{fmtQty(row.quantity)}</TableCell>
                      <TableCell className="text-right">
                        {row.currency} {fmtMoney(row.rate)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {row.currency} {fmtMoney(row.lineTotal)}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {!searchTerm && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg">Enter an item name above to search offloaded containers</p>
            <p className="text-sm mt-1">Shows supplier price (Dubai price) — not the offloaded landed cost</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
