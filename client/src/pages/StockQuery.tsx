import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  stockGroupId: number | null;
  active: boolean;
}

export default function StockQuery() {
  const [searchTerm, setSearchTerm] = useState("");
  const [_location, navigate] = useLocation();

  const { data: stockItems = [], isLoading: stockItemsLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const filteredItems = stockItems.filter(item =>
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleItemClick = (item: StockItem) => {
    navigate(`/stock-query/${item.id}`);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Stock Query</h1>
        <p className="text-muted-foreground">
          Click on any item to view purchase history, sales history, and current inventory locations
        </p>
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
            <Table>
              <TableHeader>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
