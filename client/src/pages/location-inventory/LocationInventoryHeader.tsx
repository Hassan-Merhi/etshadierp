import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/contexts/CompanyContext";
import { useLocation } from "@/contexts/LocationContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface LocationInventoryHeaderProps {
  posUser?: any;
  showNegativeStock: boolean;
  setShowNegativeStock: (v: boolean) => void;
}

type SendMode = "with_cost" | "no_cost" | null;

export function LocationInventoryHeader({
  posUser,
  showNegativeStock,
  setShowNegativeStock,
}: LocationInventoryHeaderProps) {
  const { selectedLocation } = useLocation();
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [sendMode, setSendMode] = useState<SendMode>(null);
  const companyId = selectedCompany?.id;

  // Reuses the exact query key used by the Location Inventory data hook, so this
  // normally reads the existing React Query cache rather than adding a request.
  const { data: whatsappCapability } = useQuery<{ canManage: boolean }>({
    queryKey: companyId ? ["/api/location-inventory/whatsapp/capability", companyId] : [],
    queryFn: async () => {
      const response = await fetch("/api/location-inventory/whatsapp/capability", { credentials: "include" });
      if (!response.ok) return { canManage: false };
      return response.json();
    },
    enabled: !posUser && !!companyId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const canManageWhatsapp = !posUser && whatsappCapability?.canManage === true;

  // WITH COST is separately protected by the sensitive cost/value permissions.
  // A denied or unavailable probe is treated as false; the POST endpoint enforces
  // the same permissions again and remains authoritative.
  const { data: costCapability } = useQuery<{ canSendWithCost: boolean }>({
    queryKey: companyId ? ["/api/location-inventory/whatsapp/cost-capability", companyId] : [],
    queryFn: async () => {
      const response = await fetch("/api/location-inventory/whatsapp/cost-capability", { credentials: "include" });
      if (!response.ok) return { canSendWithCost: false };
      return response.json();
    },
    enabled: canManageWhatsapp && !!companyId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const canSendWithCost = costCapability?.canSendWithCost === true;
  const whatsappReady = Boolean(
    selectedLocation?.whatsappGroupChatId && selectedLocation?.whatsappStockReportsEnabled
  );

  const handleSendStock = async (includeCost: boolean) => {
    if (!selectedLocation || sendMode) return;
    if (includeCost && !canSendWithCost) {
      toast({
        title: "Cost report restricted",
        description: "Your role does not have permission to send cost price and total inventory value.",
        variant: "destructive",
      });
      return;
    }

    const mode: SendMode = includeCost ? "with_cost" : "no_cost";
    setSendMode(mode);
    try {
      const response = await apiRequest(
        "POST",
        `/api/locations/${selectedLocation.id}/send-stock-whatsapp`,
        { includeCost }
      );
      const result = await response.json();
      toast({
        title: "Stock sent to WhatsApp",
        description: `${result.itemCount ?? 0} items sent${result.pageCount ? ` in ${result.pageCount} PDF page${result.pageCount === 1 ? "" : "s"}` : ""}${includeCost ? " with cost" : " without cost"}.`,
      });
    } catch (error: any) {
      toast({
        title: "WhatsApp send failed",
        description: error?.message || "Could not send the stock report.",
        variant: "destructive",
      });
    } finally {
      setSendMode(null);
    }
  };

  const whatsappButtonTitle = !selectedLocation
    ? "Open a location to send its stock report"
    : !selectedLocation.whatsappGroupChatId
      ? "Link a WhatsApp group to this location first"
      : !selectedLocation.whatsappStockReportsEnabled
        ? "Enable WhatsApp stock reports for this location first"
        : `Send stock to ${selectedLocation.whatsappGroupName || "the linked WhatsApp group"}`;

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-4 border-b shrink-0">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">Location Inventory</h1>
        <p className="text-sm text-muted-foreground">
          {selectedLocation ? `Manage inventory for ${selectedLocation.name}` : "Manage inventory across all locations"}
        </p>
      </div>

      {!posUser && (
        <div className="flex items-center gap-2 shrink-0">
          {canManageWhatsapp && selectedLocation && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={!whatsappReady || sendMode !== null}
                  title={whatsappButtonTitle}
                  data-testid="button-send-location-stock-whatsapp"
                >
                  {sendMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                  {sendMode ? "Sending…" : "Send Stock"}
                  {!sendMode && <ChevronDown className="h-3.5 w-3.5" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <DropdownMenuItem
                  onClick={() => handleSendStock(false)}
                  disabled={sendMode !== null}
                  data-testid="menu-send-stock-whatsapp-no-cost"
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  <div>
                    <div className="font-medium">Send WITHOUT COST</div>
                    <div className="text-xs text-muted-foreground">Quantity-only Godown Summary PDF</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleSendStock(true)}
                  disabled={sendMode !== null || !canSendWithCost}
                  data-testid="menu-send-stock-whatsapp-with-cost"
                >
                  <MessageCircle className="h-4 w-4 mr-2" />
                  <div>
                    <div className="font-medium">Send WITH COST</div>
                    <div className="text-xs text-muted-foreground">
                      {canSendWithCost
                        ? "Includes average rate and total value"
                        : "Requires cost-price and total-value permission"}
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant={showNegativeStock ? "destructive" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setShowNegativeStock(!showNegativeStock)}
            data-testid="button-negative-stock"
          >
            <AlertCircle className="h-4 w-4" /> Negative Stock
          </Button>
        </div>
      )}
    </div>
  );
}
