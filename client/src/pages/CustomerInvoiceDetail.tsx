import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocation, useRoute } from "wouter";
import { FileDown, FileSpreadsheet, ArrowLeft } from "lucide-react";

interface OrderLine {
  articleCode: string;
  baleName: string;
  qty: number;
  weightPerBale: number;
  totalWeight: number;
  pricePerBale: number;
  totalPrice: number;
}

interface OrderBale {
  baleReference: string;
  locationId: number;
  weight: number;
  articleCode: string;
  baleName: string;
  priceUsed: number;
}

interface OrderCharge {
  name: string;
  amount: number;
  chargeType: string;
}

interface OrderDetail {
  id: number;
  companyId: number;
  customerId: number;
  orderDate: string;
  status: string;
  invoiceNumber?: string;
  subtotalBales: string;
  freightAmount: string;
  otherChargesTotal: string;
  grandTotal: string;
  totalQtyBales: number;
  customerName: string;
  customerCode: string;
  lines: OrderLine[];
  bales: OrderBale[];
  charges: OrderCharge[];
}

export default function CustomerInvoiceDetail() {
  const { toast } = useToast();
  const { selectedCompany } = useCompany();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/factory/sales/invoices/:id");

  const orderId = params?.id ? parseInt(params.id) : null;

  const { data: order, isLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/factory/customer-orders", orderId],
    enabled: !!orderId,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary">Draft</Badge>;
      case "FINALIZED":
        return <Badge variant="default">Finalized</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleExportExcel = () => {
    if (!orderId) return;
    window.open(`/api/factory/customer-orders/${orderId}/export-excel`, "_blank");
  };

  const handleExportPdf = () => {
    if (!orderId) return;
    window.open(`/api/factory/customer-orders/${orderId}/export-pdf`, "_blank");
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <p className="text-muted-foreground" data-testid="text-not-found">Invoice not found</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/factory/sales/invoices")}
          data-testid="button-back-to-list"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoices
        </Button>
      </div>
    );
  }

  const sortedLines = [...(order.lines || [])].sort((a, b) =>
    (a.baleName || "").localeCompare(b.baleName || "")
  );

  const freightCharges = (order.charges || []).filter((c) => c.chargeType === "FREIGHT");
  const otherCharges = (order.charges || []).filter((c) => c.chargeType !== "FREIGHT");

  const subtotal = parseFloat(order.subtotalBales || "0");
  const totalCharges = parseFloat(order.freightAmount || "0") + parseFloat(order.otherChargesTotal || "0");
  const grandTotal = parseFloat(order.grandTotal || "0");
  const totalBalesQty = sortedLines.reduce((sum, line) => sum + (line.qty || 0), 0);

  return (
    <div className="flex flex-col h-full p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/sales/invoices")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-invoice-number">
              {order.invoiceNumber || `Draft #${order.id}`}
            </h1>
            {getStatusBadge(order.status)}
          </div>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-order-date">
            {order.orderDate ? new Date(order.orderDate).toLocaleDateString() : "-"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Customer</p>
          <p className="font-semibold text-lg" data-testid="text-customer-name">
            {order.customerName || "-"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.status === "DRAFT" && (
            <Button
              variant="outline"
              onClick={() => navigate(`/factory/sales/new?orderId=${order.id}`)}
              data-testid="button-continue-editing"
            >
              Continue Editing
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleExportExcel}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Download Excel
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPdf}
            data-testid="button-export-pdf"
          >
            <FileDown className="mr-2 h-4 w-4" />
            Download PDF
          </Button>
        </div>
      </div>

      <Card className="overflow-x-auto mb-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>Article Code</TableHead>
              <TableHead>Bale Name</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Weight/Bale</TableHead>
              <TableHead className="text-right">Total Weight</TableHead>
              <TableHead className="text-right">Price/Bale</TableHead>
              <TableHead className="text-right">Total Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-6" data-testid="text-no-lines">
                  No order lines
                </TableCell>
              </TableRow>
            ) : (
              sortedLines.map((line, idx) => (
                <TableRow key={idx} data-testid={`row-line-${idx}`}>
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="font-mono text-sm" data-testid={`text-article-code-${idx}`}>
                    {line.articleCode}
                  </TableCell>
                  <TableCell data-testid={`text-bale-name-${idx}`}>
                    {line.baleName}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-qty-${idx}`}>
                    {line.qty}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-weight-per-bale-${idx}`}>
                    {Number(line.weightPerBale || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-total-weight-${idx}`}>
                    {Number(line.totalWeight || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-price-per-bale-${idx}`}>
                    {Number(line.pricePerBale || 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold" data-testid={`text-total-price-${idx}`}>
                    {Number(line.totalPrice || 0).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {(freightCharges.length > 0 || otherCharges.length > 0) && (
        <Card className="p-4 mb-6">
          <h3 className="font-semibold mb-3" data-testid="text-charges-header">Charges</h3>
          <div className="space-y-2">
            {freightCharges.map((charge, idx) => (
              <div key={`freight-${idx}`} className="flex items-center justify-between gap-2" data-testid={`row-freight-charge-${idx}`}>
                <span className="text-sm">{charge.name}</span>
                <span className="font-mono text-sm" data-testid={`text-freight-amount-${idx}`}>
                  {Number(charge.amount || 0).toFixed(2)}
                </span>
              </div>
            ))}
            {otherCharges.map((charge, idx) => (
              <div key={`other-${idx}`} className="flex items-center justify-between gap-2" data-testid={`row-other-charge-${idx}`}>
                <span className="text-sm">{charge.name}</span>
                <span className="font-mono text-sm" data-testid={`text-other-amount-${idx}`}>
                  {Number(charge.amount || 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Subtotal (Bales)</span>
            <span className="font-mono" data-testid="text-subtotal">{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Total Charges</span>
            <span className="font-mono" data-testid="text-total-charges">{totalCharges.toFixed(2)}</span>
          </div>
          <div className="border-t pt-2 flex items-center justify-between gap-2">
            <span className="font-semibold">Grand Total</span>
            <span className="font-mono font-bold text-lg" data-testid="text-grand-total">{grandTotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>Total Bales Qty</span>
            <span data-testid="text-total-bales-qty">{totalBalesQty}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
