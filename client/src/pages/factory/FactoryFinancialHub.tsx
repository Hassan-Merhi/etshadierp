import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Wallet, DollarSign, TrendingUp } from "lucide-react";
import FactoryNetProfitAnalytics from "@/pages/factory/FactoryNetProfitAnalytics";
import FactoryNetPosition from "@/pages/factory/FactoryNetPosition";
import FactoryCashflow from "@/pages/factory/FactoryCashflow";
import FactoryProfitability from "@/pages/factory/FactoryProfitability";

type Section = "net-profit" | "net-position" | "cashflow" | "profitability";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "net-position") return "net-position";
    if (s === "cashflow") return "cashflow";
    if (s === "profitability") return "profitability";
  }
  return "net-profit";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryFinancialHub() {
  const [section, setSection] = useState<Section>(getInitialSection);

  function handleSectionChange(value: string) {
    const s = value as Section;
    setSection(s);
    setSectionInUrl(s);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs
        value={section}
        onValueChange={handleSectionChange}
        className="flex flex-col h-full overflow-hidden"
      >
        <div className="border-b px-4 pt-3 flex-shrink-0 overflow-x-auto">
          <TabsList className="flex-nowrap">
            <TabsTrigger value="net-profit" data-testid="tab-financial-hub-net-profit">
              <BarChart3 className="h-4 w-4 mr-2" />
              Net Profit
            </TabsTrigger>
            <TabsTrigger value="net-position" data-testid="tab-financial-hub-net-position">
              <Wallet className="h-4 w-4 mr-2" />
              Net Position
            </TabsTrigger>
            <TabsTrigger value="cashflow" data-testid="tab-financial-hub-cashflow">
              <DollarSign className="h-4 w-4 mr-2" />
              Cash Flow
            </TabsTrigger>
            <TabsTrigger value="profitability" data-testid="tab-financial-hub-profitability">
              <TrendingUp className="h-4 w-4 mr-2" />
              Profitability
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="net-profit" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryNetProfitAnalytics />
        </TabsContent>
        <TabsContent value="net-position" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryNetPosition />
        </TabsContent>
        <TabsContent value="cashflow" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryCashflow />
        </TabsContent>
        <TabsContent value="profitability" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryProfitability />
        </TabsContent>
      </Tabs>
    </div>
  );
}
