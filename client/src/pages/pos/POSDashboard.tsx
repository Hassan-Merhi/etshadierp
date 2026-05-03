import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShoppingCart,
  Clock,
  DollarSign,
  TrendingUp,
  Play,
  Square,
  FileText,
  Wallet,
  History,
  AlertCircle,
  WifiOff,
  Wifi,
} from "lucide-react";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { PageHeader } from "@/components/PageHeader";

interface PosShift {
  id: number;
  companyId: number;
  locationId: number;
  userId: string;
  username: string;
  cashAccountId: number | null;
  posStation: number | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  closingCash: string | null;
  expectedCash: string | null;
  variance: string | null;
  salesCount: number | null;
  salesTotal: string | null;
  notes: string | null;
}

interface TodaySales {
  count: number;
  total: string;
  average: string;
}

interface Location {
  id: number;
  code: string;
  name: string;
}

interface POSDashboardProps {
  posUser?: {
    id: string;
    username: string;
    assignedLocationId: number;
    cashAccountId: number | null;
    posStation: number | null;
  };
}

export default function POSDashboard({ posUser }: POSDashboardProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [openShiftDialog, setOpenShiftDialog] = useState(false);
  const [closeShiftDialog, setCloseShiftDialog] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Get POS user's assigned location
  const { data: location } = useQuery<Location>({
    queryKey: posUser?.assignedLocationId ? [`/api/locations/${posUser.assignedLocationId}`] : [],
    enabled: !!posUser?.assignedLocationId,
  });

  const locationId = posUser?.assignedLocationId;

  // Fetch current shift
  const { data: currentShift, isLoading: shiftLoading } = useQuery<PosShift | null>({
    queryKey: locationId ? ["/api/pos/shifts/current", { locationId }] : [],
    enabled: !!locationId,
  });

  // Fetch today's sales data
  const { data: todayVouchers = [], isLoading: salesLoading } = useQuery<any[]>({
    queryKey: locationId ? [`/api/locations/${locationId}/vouchers/today`] : [],
    enabled: !!locationId,
  });

  // Calculate today's sales from vouchers
  const todaySales = (() => {
    const salesVouchers = todayVouchers?.filter((v: any) => v.voucherType === "Sales") || [];
    const totalRaw = salesVouchers.reduce((sum: number, v: any) => sum + parseFloat(v.totalAmount || "0"), 0);
    return {
      count: salesVouchers.length,
      total: totalRaw,
      average: salesVouchers.length > 0 ? totalRaw / salesVouchers.length : 0,
    };
  })();

  // Fetch shift history
  const { data: shiftHistory = [] } = useQuery<PosShift[]>({
    queryKey: locationId ? ["/api/pos/shifts/history", { locationId }] : [],
    enabled: !!locationId && showHistory,
  });

  // Open shift mutation
  const openShiftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pos/shifts/open", {
        locationId,
        cashAccountId: posUser?.cashAccountId,
        openingCash,
        posStation: posUser?.posStation,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/shifts/current", { locationId }] });
      setOpenShiftDialog(false);
      setOpeningCash("");
      toast({
        title: "Shift Started",
        description: "Your shift has been opened successfully.",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to open shift",
        variant: "destructive",
      });
    },
  });

  // Close shift mutation
  const closeShiftMutation = useMutation({
    mutationFn: async () => {
      if (!currentShift) throw new Error("No active shift");
      const res = await apiRequest("POST", `/api/pos/shifts/${currentShift.id}/close`, {
        closingCash,
        notes: closeNotes,
      });
      return await res.json();
    },
    onSuccess: (data: PosShift) => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/shifts/current", { locationId }] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/shifts/history", { locationId }] });
      setCloseShiftDialog(false);
      setClosingCash("");
      setCloseNotes("");
      
      const variance = parseFloat(data.variance || "0");
      toast({
        title: "Shift Closed",
        description: `Your shift has been closed. ${variance !== 0 ? `Variance: ${formatAmount(variance)}` : "Cash balanced!"}`,
        variant: variance !== 0 ? "destructive" : "default",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to close shift",
        variant: "destructive",
      });
    },
  });

  if (!posUser || !locationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-medium mb-2">No Location Assigned</h2>
            <p className="text-muted-foreground">
              Please contact your administrator to assign you to a location.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
      <PageHeader
        title="POS Dashboard"
        subtitle={`${location?.name || "Loading..."} — ${posUser.username}`}
      >
        {isOnline ? (
          <Badge variant="outline" className="gap-1">
            <Wifi className="h-3 w-3" />
            Online
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <WifiOff className="h-3 w-3" />
            Offline
          </Badge>
        )}
      </PageHeader>

      {/* Shift Status Card */}
      <Card className={currentShift ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/20" : ""}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            Shift Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shiftLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : currentShift ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="default" className="mb-2">Active Shift</Badge>
                  <p className="text-sm text-muted-foreground">
                    Started: {formatDisplayDate(currentShift.openedAt)} at {format(new Date(currentShift.openedAt), "hh:mm a")}
                  </p>
                  <p className="text-sm">
                    Opening Cash: <span className="font-medium">{formatAmount(parseFloat(currentShift.openingCash))}</span>
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setCloseShiftDialog(true)}
                  className="gap-2"
                  data-testid="button-close-shift"
                >
                  <Square className="h-4 w-4" />
                  End Shift
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <Badge variant="secondary" className="mb-2">No Active Shift</Badge>
                <p className="text-sm text-muted-foreground">
                  Start a shift to begin making sales
                </p>
              </div>
              <Button
                onClick={() => setOpenShiftDialog(true)}
                className="gap-2"
                data-testid="button-start-shift"
              >
                <Play className="h-4 w-4" />
                Start Shift
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-semibold" data-testid="text-today-sales-count">
                  {todaySales?.count || 0}
                </div>
                <p className="text-xs text-muted-foreground">transactions</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-semibold" data-testid="text-today-revenue">
                  {formatAmount(todaySales?.total || 0)}
                </div>
                <p className="text-xs text-muted-foreground">total revenue</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Sale</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-semibold" data-testid="text-average-sale">
                  {formatAmount(todaySales?.average || 0)}
                </div>
                <p className="text-xs text-muted-foreground">per transaction</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => navigate("/pos")}
              disabled={!currentShift}
              data-testid="button-new-sale"
            >
              <ShoppingCart className="h-6 w-6" />
              <span>New Sale</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => navigate("/pos-daybook")}
              data-testid="button-view-daybook"
            >
              <FileText className="h-6 w-6" />
              <span>View Daybook</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => setShowHistory(!showHistory)}
              data-testid="button-shift-history"
            >
              <History className="h-6 w-6" />
              <span>Shift History</span>
            </Button>
            
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              disabled
              data-testid="button-cash-drawer"
            >
              <Wallet className="h-6 w-6" />
              <span>Cash Drawer</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Shift History */}
      {showHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Shifts</CardTitle>
            <CardDescription>Your last 10 shifts at this location</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="table-responsive">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="hidden sm:table-cell">Duration</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shiftHistory.slice(0, 10).map((shift) => {
                  const variance = parseFloat(shift.variance || "0");
                  return (
                    <TableRow key={shift.id} data-testid={`row-shift-${shift.id}`}>
                      <TableCell>
                        {formatDisplayDate(shift.openedAt)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {shift.closedAt ? (
                          <>
                            {format(new Date(shift.openedAt), "hh:mm a")} - {format(new Date(shift.closedAt), "hh:mm a")}
                          </>
                        ) : (
                          format(new Date(shift.openedAt), "hh:mm a") + " - Active"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(parseFloat(shift.openingCash))}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {shift.closingCash ? formatAmount(parseFloat(shift.closingCash)) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {shift.salesTotal ? formatAmount(parseFloat(shift.salesTotal)) : "-"}
                        {shift.salesCount ? ` (${shift.salesCount})` : ""}
                      </TableCell>
                      <TableCell className={`hidden sm:table-cell text-right font-mono ${variance !== 0 ? "text-destructive" : "text-green-600"}`}>
                        {shift.variance ? formatAmount(variance) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={shift.status === "open" ? "default" : "secondary"}>
                          {shift.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shiftHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No shift history found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open Shift Dialog */}
      <Dialog open={openShiftDialog} onOpenChange={setOpenShiftDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Shift</DialogTitle>
            <DialogDescription>
              Enter the opening cash amount in your drawer to begin your shift.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="openingCash">Opening Cash Amount</Label>
              <Input
                id="openingCash"
                type="number"
                step="0.01"
                placeholder="0"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                data-testid="input-opening-cash"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenShiftDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!navigator.onLine) { toast({ title: "Not available offline", description: "Shift operations require a connection", variant: "destructive" }); return; }
                openShiftMutation.mutate();
              }}
              disabled={openShiftMutation.isPending}
              data-testid="button-confirm-start-shift"
            >
              {openShiftMutation.isPending ? "Starting..." : "Start Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Shift Dialog */}
      <Dialog open={closeShiftDialog} onOpenChange={setCloseShiftDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Shift</DialogTitle>
            <DialogDescription>
              Count your cash drawer and enter the closing amount.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {currentShift && (
              <div className="bg-muted p-4 rounded-lg space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Opening Cash:</span>
                  <span className="font-mono">{formatAmount(parseFloat(currentShift.openingCash))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Shift Started:</span>
                  <span>{format(new Date(currentShift.openedAt), "hh:mm a")}</span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="closingCash">Closing Cash Amount</Label>
              <Input
                id="closingCash"
                type="number"
                step="0.01"
                placeholder="0"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                data-testid="input-closing-cash"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="closeNotes">Notes (optional)</Label>
              <Textarea
                id="closeNotes"
                placeholder="Any notes about this shift..."
                value={closeNotes}
                onChange={(e) => setCloseNotes(e.target.value)}
                data-testid="input-close-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseShiftDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!navigator.onLine) { toast({ title: "Not available offline", description: "Shift operations require a connection", variant: "destructive" }); return; }
                closeShiftMutation.mutate();
              }}
              disabled={closeShiftMutation.isPending || !closingCash}
              data-testid="button-confirm-end-shift"
            >
              {closeShiftMutation.isPending ? "Closing..." : "End Shift"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
