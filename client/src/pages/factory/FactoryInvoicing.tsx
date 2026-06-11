import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import FactoryProformas from "@/pages/factory/FactoryProformas";
import FactoryInvoices from "@/pages/factory/FactoryInvoices";
import { FileText } from "lucide-react";

type InvoicingTab = "proformas" | "invoices";

function getTab(search: string, hideProformas: boolean): InvoicingTab {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const t = params.get("tab");
  if (t === "invoices") return "invoices";
  if (t === "proformas" && !hideProformas) return "proformas";
  return hideProformas ? "invoices" : "proformas";
}

export default function FactoryInvoicing() {
  const [, navigate] = useLocation();
  const search = useSearch();

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const isAdmin = myAccess?.fullAccess === true;
  const hidden: string[] = myAccess?.hiddenCostFields ?? [];
  const hideProformasTab = hidden.includes("hide_invoicing_proformas_tab");

  const activeTab = getTab(search, hideProformasTab);

  const allTabs: { key: InvoicingTab; label: string }[] = [
    { key: "proformas", label: "Proformas" },
    { key: "invoices",  label: "Invoices"  },
  ];
  const tabs = allTabs.filter(t => !(t.key === "proformas" && hideProformasTab));

  const goTo = (tab: InvoicingTab) => {
    navigate(`/factory/invoicing?tab=${tab}`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b bg-background shrink-0">
        {/* Header row */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Invoicing</h1>
            <p className="text-xs text-muted-foreground">Proformas and customer orders</p>
          </div>
        </div>
        {/* Tab row */}
        <div className="flex gap-0 px-4" role="tablist">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                data-testid={`tab-${tab.key}`}
                onClick={() => goTo(tab.key)}
                className={[
                  "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {activeTab === "proformas" && !hideProformasTab && <FactoryProformas />}
        {activeTab === "invoices" && <FactoryInvoices />}
      </div>
    </div>
  );
}
