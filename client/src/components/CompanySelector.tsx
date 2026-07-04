import { useCompany } from "@/contexts/CompanyContext";
import { WifiOff, ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { enqueueRequest } from "@/lib/offlineQueue";

type CompanyType = "erp" | "factory" | "properties" | string;

const TYPE_META: Record<string, { color: string; label: string }> = {
  erp:              { color: "#3b82f6", label: "ERP" },
  factory:          { color: "#f97316", label: "Factory" },
  factory_v2:       { color: "#f97316", label: "Factory V2" },
  properties:       { color: "#6366f1", label: "Properties" },
  supplier_partner: { color: "#f43f5e", label: "Supplier Partner" },
};

function getTypeMeta(type: CompanyType) {
  return TYPE_META[type] ?? { color: "#6b7280", label: type ?? "Unknown" };
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function CompanyAvatar({ name, type, size = "sm" }: { name: string; type: CompanyType; size?: "sm" | "md" }) {
  const { color } = getTypeMeta(type);
  const dim = size === "md" ? "h-7 w-7 text-[11px]" : "h-5 w-5 text-[9px]";
  return (
    <span
      className={`${dim} rounded-md flex items-center justify-center font-bold text-white shrink-0`}
      style={{ backgroundColor: color }}
    >
      {getInitials(name)}
    </span>
  );
}

export function CompanySelector() {
  const { selectedCompany, companies, isLoading, selectCompany } = useCompany();
  const { isOnline } = useConnectivity();
  const { toast } = useToast();

  const handleCompanyChange = async (company: any) => {
    if (company.id === selectedCompany?.id) return;

    if (!isOnline) {
      selectCompany(company);
      enqueueRequest(
        "/api/auth/set-company",
        "POST",
        JSON.stringify({ companyId: company.id }),
        `Switch to ${company.name}`
      );
      toast({
        title: `Switched to ${company.name}`,
        description: "Your work will be saved under this company. The data view will refresh when you reconnect.",
      });
      return;
    }

    try {
      await apiRequest("POST", "/api/auth/set-company", { companyId: company.id });
      selectCompany(company);
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Failed to switch company",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading || !selectedCompany) {
    return (
      <Button variant="outline" size="sm" disabled data-testid="button-company-selector">
        <span className="h-5 w-5 rounded-md bg-muted animate-pulse shrink-0" />
        <span className="hidden sm:inline ml-1.5">Loading…</span>
      </Button>
    );
  }

  const activeType = (selectedCompany as any).companyType ?? "erp";
  const { color: activeColor } = getTypeMeta(activeType);

  if (companies.length <= 1) {
    return (
      <Button variant="outline" size="sm" disabled data-testid="button-company-selector">
        <CompanyAvatar name={selectedCompany.name} type={activeType} />
        <span className="hidden sm:inline ml-1.5 max-w-[120px] truncate">{selectedCompany.name}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-company-selector" className="gap-1.5 pr-2">
          {isOnline ? (
            <CompanyAvatar name={selectedCompany.name} type={activeType} />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="hidden sm:inline max-w-[120px] truncate">{selectedCompany.name}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-1.5">
        {/* Header */}
        <div className="flex items-center justify-between px-2 py-1.5 mb-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <span className="text-xs font-semibold uppercase tracking-wider">Switch workspace</span>
          </div>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {companies.length}
          </Badge>
        </div>

        {!isOnline && (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/50 rounded-md mb-1">
              <WifiOff className="h-3 w-3 shrink-0" />
              Offline — switch will sync on reconnect
            </div>
          </>
        )}

        <DropdownMenuSeparator className="mx-0 my-1" />

        {companies.map((company) => {
          const cType = (company as any).companyType ?? "erp";
          const { color, label } = getTypeMeta(cType);
          const isActive = company.id === selectedCompany.id;

          return (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleCompanyChange(company)}
              data-testid={`company-option-${company.id}`}
              className="rounded-md px-2 py-2 gap-2.5 cursor-pointer"
              style={isActive ? { backgroundColor: `${color}14` } : undefined}
            >
              <CompanyAvatar name={company.name} type={cType} size="md" />
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium leading-tight truncate">{company.name}</span>
                <span className="text-[10px] leading-tight" style={{ color: `${color}cc` }}>
                  {label}
                </span>
              </div>
              {isActive && (
                <span
                  className="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: color }}
                >
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none">
                    <polyline
                      points="1.5,5 4,7.5 8.5,2.5"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
