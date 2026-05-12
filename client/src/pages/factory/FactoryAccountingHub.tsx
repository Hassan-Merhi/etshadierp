import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Landmark } from "lucide-react";
import Vouchers from "@/pages/Vouchers";
import Accounts from "@/pages/Accounts";

type Section = "vouchers" | "accounts";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "accounts") return "accounts";
  }
  return "vouchers";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryAccountingHub() {
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
        <div className="border-b px-4 pt-3 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="vouchers" data-testid="tab-accounting-hub-vouchers">
              <FileText className="h-4 w-4 mr-2" />
              Vouchers
            </TabsTrigger>
            <TabsTrigger value="accounts" data-testid="tab-accounting-hub-accounts">
              <Landmark className="h-4 w-4 mr-2" />
              Accounts
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="vouchers" className="flex-1 overflow-auto mt-0 p-4">
          <Vouchers />
        </TabsContent>
        <TabsContent value="accounts" className="flex-1 overflow-auto mt-0 p-4">
          <Accounts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
