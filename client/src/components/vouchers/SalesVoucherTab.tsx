import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pencil, Search } from "lucide-react";

interface SalesVoucherTabProps {
  onEditVoucher: (voucherId: number) => void;
}

export function SalesVoucherTab({ onEditVoucher }: SalesVoucherTabProps) {
  const { selectedCompany } = useCompany();
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch all vouchers
  const { data: vouchers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/vouchers", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  // Filter to show only Sales vouchers
  const salesVouchers = vouchers.filter(
    (v: any) => v.voucherType === "Sales"
  );

  // Apply search filter
  const filteredVouchers = salesVouchers.filter((v: any) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      v.voucherNumber?.toLowerCase().includes(searchLower) ||
      v.description?.toLowerCase().includes(searchLower) ||
      v.locationName?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sales Vouchers</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search vouchers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-[250px]"
                data-testid="input-search-sales"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading sales vouchers...
          </div>
        ) : filteredVouchers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchTerm
              ? "No sales vouchers match your search"
              : "No sales vouchers found. Sales are created through the POS."}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher #</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVouchers.map((voucher: any) => (
                  <TableRow
                    key={voucher.id}
                    data-testid={`row-sales-voucher-${voucher.id}`}
                  >
                    <TableCell>
                      {format(new Date(voucher.voucherDate), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="font-mono">
                      {voucher.voucherNumber}
                    </TableCell>
                    <TableCell>{voucher.locationName || "—"}</TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {voucher.description || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      $
                      {parseFloat(voucher.totalAmount).toLocaleString(
                        undefined,
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEditVoucher(voucher.id)}
                        data-testid={`button-edit-${voucher.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
