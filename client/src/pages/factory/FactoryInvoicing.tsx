import { useLocation, useSearch } from "wouter";
import FactoryProformas from "@/pages/factory/FactoryProformas";
import FactoryInvoices from "@/pages/factory/FactoryInvoices";

type InvoicingTab = "proformas" | "invoices";

function getTab(search: string): InvoicingTab {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const t = params.get("tab");
  if (t === "invoices") return t;
  return "proformas";
}

export default function FactoryInvoicing() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeTab = getTab(search);

  const tabs: { key: InvoicingTab; label: string }[] = [
    { key: "proformas", label: "Proformas" },
    { key: "invoices",  label: "Invoices" },
  ];

  const goTo = (tab: InvoicingTab) => {
    navigate(`/factory/invoicing?tab=${tab}`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b bg-background px-6 pt-5 pb-0 shrink-0">
        <h1 className="text-2xl font-semibold mb-3" data-testid="text-invoicing-title">Invoicing</h1>
        <div className="flex gap-1" role="tablist">
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
                  "px-4 py-2 text-sm font-medium border-b-2 transition-colors rounded-t-md",
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
        {activeTab === "proformas" && <FactoryProformas />}
        {activeTab === "invoices"  && <FactoryInvoices />}
      </div>
    </div>
  );
}
