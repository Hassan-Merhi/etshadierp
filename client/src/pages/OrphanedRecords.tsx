import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { AlertCircle, RefreshCw, AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface OrphanedVoucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  locationId: number | null;
  locationName: string | null;
  totalAmount: string;
  description: string | null;
  createdAt: string;
}

interface UnbalancedVoucher {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  locationId: number | null;
  locationName: string | null;
  totalAmount: string;
  description: string | null;
  createdAt: string;
  totalDebits: string;
  totalCredits: string;
  imbalance: string;
}

interface OrphanedRecordsResponse {
  orphanedVouchers: OrphanedVoucher[];
  unbalancedVouchers: UnbalancedVoucher[];
}

export default function OrphanedRecordsPage() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVouchers, setSelectedVouchers] = useState<number[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>("");

  const { data: recordsData, isLoading } = useQuery<OrphanedRecordsResponse>({
    queryKey: ["/api/orphaned-records"],
  });

  const orphanedRecords = recordsData?.orphanedVouchers || [];
  const unbalancedRecords = recordsData?.unbalancedVouchers || [];

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  const reassignMutation = useMutation({
    mutationFn: async (data: { voucherIds: number[]; newLocationId: number }) => {
      return apiRequest("POST", "/api/orphaned-records/reassign", data);
    },
    onSuccess: (data: any) => {
      toast({ 
        title: "Success", 
        description: `${data.updated} records reassigned to ${data.newLocationName}` 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/orphaned-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });
      setSelectedVouchers([]);
      setSelectedLocation("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSelectAll = () => {
    if (selectedVouchers.length === orphanedRecords.length) {
      setSelectedVouchers([]);
    } else {
      setSelectedVouchers(orphanedRecords.map(v => v.id));
    }
  };

  const handleToggleVoucher = (id: number) => {
    setSelectedVouchers(prev => 
      prev.includes(id) 
        ? prev.filter(v => v !== id) 
        : [...prev, id]
    );
  };

  const handleReassign = () => {
    if (selectedVouchers.length === 0) {
      toast({ title: "Error", description: "Please select records to reassign", variant: "destructive" });
      return;
    }
    if (!selectedLocation) {
      toast({ title: "Error", description: "Please select a location", variant: "destructive" });
      return;
    }
    reassignMutation.mutate({
      voucherIds: selectedVouchers,
      newLocationId: parseInt(selectedLocation),
    });
  };

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(num);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-8 w-8 text-orange-500" />
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-orphaned-records">Orphaned Records</h1>
          <p className="text-muted-foreground">Records with deleted locations or accounting imbalances</p>
        </div>
      </div>

      {/* Unbalanced Vouchers Section */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-6 w-6 text-red-500" />
          <div>
            <h2 className="text-xl font-semibold" data-testid="heading-unbalanced-vouchers">Unbalanced Vouchers</h2>
            <p className="text-sm text-muted-foreground">Vouchers where debits do not equal credits</p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : unbalancedRecords.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-green-600">All vouchers are balanced</p>
            <p className="text-muted-foreground">No accounting imbalances detected</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total Debits</TableHead>
                <TableHead className="text-right">Total Credits</TableHead>
                <TableHead className="text-right">Imbalance</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unbalancedRecords.map((voucher) => (
                <TableRow key={voucher.id} data-testid={`row-unbalanced-${voucher.id}`}>
                  <TableCell className="font-mono" data-testid={`text-unbalanced-number-${voucher.id}`}>
                    {voucher.voucherNumber}
                  </TableCell>
                  <TableCell data-testid={`text-unbalanced-type-${voucher.id}`}>
                    {voucher.voucherType}
                  </TableCell>
                  <TableCell data-testid={`text-unbalanced-date-${voucher.id}`}>
                    {voucher.voucherDate}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-debits-${voucher.id}`}>
                    {formatCurrency(voucher.totalDebits)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-credits-${voucher.id}`}>
                    {formatCurrency(voucher.totalCredits)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-600 font-bold" data-testid={`text-imbalance-${voucher.id}`}>
                    {formatCurrency(voucher.imbalance)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" data-testid={`text-unbalanced-desc-${voucher.id}`}>
                    {voucher.description || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Orphaned Location Vouchers Section */}
      {orphanedRecords.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger data-testid="select-new-location">
                  <SelectValue placeholder="Select new location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()} data-testid={`option-location-${loc.id}`}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={handleReassign} 
              disabled={reassignMutation.isPending || selectedVouchers.length === 0 || !selectedLocation}
              data-testid="button-reassign"
            >
              {reassignMutation.isPending && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Reassign {selectedVouchers.length} Record{selectedVouchers.length !== 1 ? 's' : ''}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="h-6 w-6 text-orange-500" />
          <div>
            <h2 className="text-xl font-semibold">Deleted Location Vouchers</h2>
            <p className="text-sm text-muted-foreground">Vouchers referencing locations that have been deleted</p>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : orphanedRecords.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium text-green-600">No orphaned records found</p>
            <p className="text-muted-foreground">All your records have valid locations assigned</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox 
                    checked={selectedVouchers.length === orphanedRecords.length && orphanedRecords.length > 0}
                    onCheckedChange={handleSelectAll}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead>Voucher #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Saved Location Name</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orphanedRecords.map((voucher) => (
                <TableRow key={voucher.id} data-testid={`row-voucher-${voucher.id}`}>
                  <TableCell>
                    <Checkbox 
                      checked={selectedVouchers.includes(voucher.id)}
                      onCheckedChange={() => handleToggleVoucher(voucher.id)}
                      data-testid={`checkbox-voucher-${voucher.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono" data-testid={`text-voucher-number-${voucher.id}`}>
                    {voucher.voucherNumber}
                  </TableCell>
                  <TableCell data-testid={`text-voucher-type-${voucher.id}`}>
                    {voucher.voucherType}
                  </TableCell>
                  <TableCell data-testid={`text-voucher-date-${voucher.id}`}>
                    {voucher.voucherDate}
                  </TableCell>
                  <TableCell data-testid={`text-location-name-${voucher.id}`}>
                    {voucher.locationName || <span className="text-muted-foreground">Not saved</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-amount-${voucher.id}`}>
                    {formatCurrency(voucher.totalAmount)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" data-testid={`text-description-${voucher.id}`}>
                    {voucher.description || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-4 bg-muted/50">
        <h3 className="font-semibold mb-2">How this works:</h3>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li><strong>Unbalanced Vouchers:</strong> These have accounting errors where debits don't equal credits. Review and fix manually in the voucher editor.</li>
          <li><strong>Deleted Location Vouchers:</strong> These reference locations that have been deleted. Select records and reassign to a valid location.</li>
          <li>The location name is saved on vouchers to preserve history if the location is deleted in the future.</li>
        </ul>
      </Card>
    </div>
  );
}
