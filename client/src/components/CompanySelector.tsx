import { Building2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";

//todo: remove mock functionality
const mockCompanies = [
  { id: "1", name: "ABC Textiles Inc.", locations: 3 },
  { id: "2", name: "Global Imports Ltd.", locations: 5 },
  { id: "3", name: "Fashion Wholesale Co.", locations: 2 },
];

export function CompanySelector() {
  const [selectedCompany, setSelectedCompany] = useState(mockCompanies[0]);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="gap-2 h-10"
          data-testid="button-company-selector"
        >
          <Building2 className="h-4 w-4" />
          <span className="text-sm font-medium">{selectedCompany.name}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <div className="space-y-1">
          {mockCompanies.map((company) => (
            <button
              key={company.id}
              onClick={() => {
                setSelectedCompany(company);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md hover-elevate active-elevate-2"
              data-testid={`button-company-${company.id}`}
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{company.name}</span>
                <span className="text-xs text-muted-foreground">
                  {company.locations} locations
                </span>
              </div>
              {selectedCompany.id === company.id && (
                <Check className="h-4 w-4" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
