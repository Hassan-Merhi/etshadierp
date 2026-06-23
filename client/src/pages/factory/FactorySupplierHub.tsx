import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardCheck, FileText, Award } from "lucide-react";
import FactorySupplierReport from "@/pages/factory/FactorySupplierReport";
import FactorySupplierStatement from "@/pages/factory/FactorySupplierStatement";
import FactorySupplierScoreboard from "@/pages/factory/FactorySupplierScoreboard";

type Section = "report" | "statement" | "scores";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "statement") return "statement";
    if (s === "scores") return "scores";
  }
  return "report";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactorySupplierHub() {
  const [section, setSection] = useState<Section>(getInitialSection);

  function handleSectionChange(value: string) {
    const s = value as Section;
    setSection(s);
    setSectionInUrl(s);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs value={section} onValueChange={handleSectionChange} className="flex flex-col h-full overflow-hidden">
        <div className="border-b px-4 pt-3 flex-shrink-0 overflow-x-auto">
          <TabsList className="flex-nowrap">
            <TabsTrigger value="report" data-testid="tab-supplier-hub-report">
              <FileText className="h-4 w-4 mr-2" />
              Supplier Report
            </TabsTrigger>
            <TabsTrigger value="statement" data-testid="tab-supplier-hub-statement">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Supplier Statement
            </TabsTrigger>
            <TabsTrigger value="scores" data-testid="tab-supplier-hub-scores">
              <Award className="h-4 w-4 mr-2" />
              Supplier Scores
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="report" className="flex-1 overflow-auto mt-0 p-4">
          <FactorySupplierReport />
        </TabsContent>
        <TabsContent value="statement" className="flex-1 overflow-auto mt-0 p-4">
          <FactorySupplierStatement />
        </TabsContent>
        <TabsContent value="scores" className="flex-1 overflow-auto mt-0 p-4">
          <FactorySupplierScoreboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
