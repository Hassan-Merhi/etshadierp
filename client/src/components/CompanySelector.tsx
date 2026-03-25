import { useCompany } from "@/contexts/CompanyContext";
import { Building2, Check, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useConnectivity } from "@/contexts/ConnectivityContext";
import { enqueueRequest } from "@/lib/offlineQueue";

export function CompanySelector() {
  const { selectedCompany, companies, isLoading, selectCompany } = useCompany();
  const { isOnline } = useConnectivity();
  const { toast } = useToast();

  const handleCompanyChange = async (company: any) => {
    if (company.id === selectedCompany?.id) return;

    if (!isOnline) {
      // Update local context + localStorage immediately so UI reflects new company
      selectCompany(company);
      // Queue the session update — plays back first when reconnected, before any
      // subsequent mutations, so they land under the correct company on the server
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
        <Building2 className="h-4 w-4 mr-2" />
        Loading...
      </Button>
    );
  }

  if (companies.length <= 1) {
    // Don't show selector if user only has access to one company
    return (
      <Button variant="outline" size="sm" disabled data-testid="button-company-selector">
        <Building2 className="h-4 w-4 mr-2" />
        {selectedCompany.name}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-company-selector">
          {isOnline ? (
            <Building2 className="h-4 w-4 mr-2" />
          ) : (
            <WifiOff className="h-4 w-4 mr-2 text-muted-foreground" />
          )}
          {selectedCompany.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Select Company</DropdownMenuLabel>
        {!isOnline && (
          <>
            <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
              <WifiOff className="h-3 w-3 shrink-0" />
              Offline — switch will sync on reconnect
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {isOnline && <DropdownMenuSeparator />}
        {companies.map((company) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => handleCompanyChange(company)}
            data-testid={`company-option-${company.id}`}
          >
            <div className="flex items-center justify-between w-full">
              <span>{company.name}</span>
              {company.id === selectedCompany.id && (
                <Check className="h-4 w-4 ml-2" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
