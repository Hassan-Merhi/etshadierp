import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, Users } from "lucide-react";
import FactoryWorkersHub from "@/pages/factory/FactoryWorkersHub";
import FactoryEmployeesHub from "@/pages/factory/FactoryEmployeesHub";

type Section = "workers" | "employees";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("section");
    if (s === "employees") return "employees";
    if (s === "workers") return "workers";
  }
  return "workers";
}

function setSectionInUrl(section: Section) {
  const url = new URL(window.location.href);
  url.searchParams.set("section", section);
  url.searchParams.delete("tab");
  window.history.replaceState(null, "", url.toString());
}

export default function FactoryPayrollHub() {
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
            <TabsTrigger value="workers" data-testid="tab-payroll-workers">
              <HardHat className="h-4 w-4 mr-2" />
              Workers
            </TabsTrigger>
            <TabsTrigger value="employees" data-testid="tab-payroll-employees">
              <Users className="h-4 w-4 mr-2" />
              Employees
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="workers" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryWorkersHub />
        </TabsContent>

        <TabsContent value="employees" className="flex-1 overflow-auto mt-0 p-4">
          <FactoryEmployeesHub />
        </TabsContent>
      </Tabs>
    </div>
  );
}
