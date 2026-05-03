import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useLocation, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Grid3X3 } from "lucide-react";
import LocationSummary from "@/pages/LocationSummary";
import { PageHeader } from "@/components/PageHeader";

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  stockGroupId: number | null;
  active: boolean;
}

interface FactoryBaleProduct {
  id: number;
  code: string;
  name: string;
  articleCode: string | null;
  active: boolean;
}

function StockQueryContent() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const isFactory = appMode === "factory";
  const search = useSearch();
  const initialQ = new URLSearchParams(search).get("q") || "";
  const [searchTerm, setSearchTerm] = useState(initialQ);
  const [_location, navigate] = useLocation();

  const { data: stockItems = [], isLoading: erpLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
    enabled: !isFactory,
  });

  const { data: factoryProducts = [], isLoading: factoryLoading } = useQuery<FactoryBaleProduct[]>({
    queryKey: ["/api/factory/bale-products"],
    enabled: isFactory,
  });

  const stockItemsLoading = isFactory ? factoryLoading : erpLoading;

  const items = isFactory
    ? factoryProducts.map(p => ({ id: p.id, code: p.articleCode || p.code, name: p.name, active: p.active }))
    : stockItems.map(p => ({ id: p.id, code: p.code, name: p.name, active: p.active }));

  const filteredItems = items.filter(item =>
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleItemClick = (item: { id: number }) => {
    if (isFactory) {
      navigate(`/factory/stock-query/${item.id}`);
    } else {
      navigate(`/stock-query/${item.id}`);
    }
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <PageHeader title="Stock Query" subtitle="Click on any item to view purchase history, sales history, and current inventory locations" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Stock Items</CardTitle>
          <CardDescription>Find items by code or name</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-stock-search"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {stockItemsLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading stock items...</div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="text-center text-muted-foreground">
                          No items found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredItems.map((item) => (
                        <TableRow
                          key={item.id}
                          className="cursor-pointer hover-elevate"
                          onClick={() => handleItemClick(item)}
                          data-testid={`row-stock-item-${item.id}`}
                        >
                          <TableCell>
                            <button
                              className="text-primary hover:underline text-left"
                              data-testid={`button-item-name-${item.id}`}
                            >
                              {item.name}
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant={item.active ? "default" : "secondary"}>
                              {item.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden p-3 space-y-2">
                {filteredItems.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">No items found</p>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-md border cursor-pointer hover-elevate"
                      onClick={() => handleItemClick(item)}
                      data-testid={`row-stock-item-${item.id}`}
                    >
                      <button
                        className="text-primary hover:underline text-left text-sm font-medium"
                        data-testid={`button-item-name-${item.id}`}
                      >
                        {item.name}
                      </button>
                      <Badge variant={item.active ? "default" : "secondary"}>
                        {item.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function StockQuery() {
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const activeTab = params.get("tab") || "query";

  const switchTab = (tab: string) => {
    navigate(tab === "query" ? location : `${location}?tab=${tab}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 sm:px-6 pt-3 sm:pt-6 pb-0">
        <div className="flex items-center gap-1 rounded-md border p-1">
          <Button
            size="sm"
            variant={activeTab === "query" ? "secondary" : "ghost"}
            onClick={() => switchTab("query")}
            data-testid="tab-stock-query"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Stock Query
          </Button>
          <Button
            size="sm"
            variant={activeTab === "summary" ? "secondary" : "ghost"}
            onClick={() => switchTab("summary")}
            data-testid="tab-location-summary"
          >
            <Grid3X3 className="h-3.5 w-3.5 mr-1.5" />
            Location Summary
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "summary" ? <LocationSummary /> : <StockQueryContent />}
      </div>
    </div>
  );
}
