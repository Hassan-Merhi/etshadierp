import { useCompany } from "@/contexts/CompanyContext";
import { Building2, Check } from "lucide-react";
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

export function CompanySelector() {
  const { selectedCompany, companies, isLoading, selectCompany } = useCompany();
  const { toast } = useToast();

  const handleCompanyChange = async (company: any) => {
    try {
      // Call API to set company in session
      await apiRequest("POST", "/api/auth/set-company", { companyId: company.id });
      
      // Update local context
      selectCompany(company);
      
      // Reload to get fresh data for new company
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to switch company",
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
          <Building2 className="h-4 w-4 mr-2" />
          {selectedCompany.name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Select Company</DropdownMenuLabel>
        <DropdownMenuSeparator />
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
