import { Package, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function DiagnosticsSection({
  setOrphanedChargesDiagnostic,
  toast,
}: {
  setOrphanedChargesDiagnostic: (v: any) => void;
  toast: any;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Package className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-medium text-sm uppercase tracking-wider text-muted-foreground">Diagnostics</h3>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <h4 className="font-semibold" data-testid="text-diagnose-vouchers-title">Orphaned Vouchers</h4>
              <p className="text-sm text-muted-foreground">
                Find and clean up charge vouchers for OTW containers
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                setOrphanedChargesDiagnostic(null);
                const response = await fetch("/api/debug/orphaned-charge-vouchers", { method: "GET", credentials: "include" });
                const result = await response.json();
                if (response.ok) {
                  setOrphanedChargesDiagnostic({ count: result.orphanedVoucherCount, impact: result.totalImpact, vouchers: result.orphanedVouchers || [] });
                  if (result.orphanedVoucherCount === 0) toast({ title: "No Orphaned Vouchers", description: "All OTW containers have no leftover charge vouchers." });
                } else {
                  toast({ title: "Error", description: result.message, variant: "destructive" });
                }
              } catch (error: any) {
                toast({ title: "Error", description: error.message, variant: "destructive" });
              }
            }}
            data-testid="button-diagnose-vouchers"
          >
            Diagnose
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-500/10 rounded-lg">
              <Package className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <h4 className="font-semibold" data-testid="text-container-analysis-title">Container Analysis</h4>
              <p className="text-sm text-muted-foreground">
                Analyze offloads for duplicates and quantity issues
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              // This is just a scroll to the analysis section in this simplified view
            }}
          >
            Go to Analysis
          </Button>
        </div>
      </Card>
    </div>
  );
}
