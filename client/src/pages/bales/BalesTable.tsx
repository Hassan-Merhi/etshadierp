import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Bale } from "@shared/schema";
import { Package, Search, Trash2, Upload } from "lucide-react";

interface BalesTableProps {
  bales: Bale[];
  isLoading: boolean;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  formatDisplayDate: (date: string) => string;
  onDeleteRequest: (baleId: number) => void;
  onNavigateImport: () => void;
}

export function BalesTable({
  bales,
  isLoading,
  searchTerm,
  onSearchChange,
  formatDisplayDate,
  onDeleteRequest,
  onNavigateImport,
}: BalesTableProps) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">All Bales ({bales.length})</h2>
        <div className="flex gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search bales..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8"
              data-testid="input-search-bales"
            />
          </div>
          <Button variant="outline" onClick={onNavigateImport} data-testid="button-import">
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
      ) : bales.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {searchTerm ? "No bales match your search" : "No bales found. Scan or add a bale to get started."}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader className="sticky top-0 z-30 bg-background">
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
            {bales.map((bale) => (
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
                    onClick={() => onDeleteRequest(bale.id)}
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
  );
}
