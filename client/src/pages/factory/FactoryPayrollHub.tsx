import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, Users } from "lucide-react";
import FactoryWorkersHub from "@/pages/factory/FactoryWorkersHub";
import FactoryEmployeesHub from "@/pages/factory/FactoryEmployeesHub";

type Section = "workers" | "employees";

function getInitialSection(): Section {
  if (typeof window !== "undefined") {
    const hash = window.location.hash.replace("#", "");
    if (hash === "employees") return "employees";
  }
  return "workers";
}

export default function FactoryPayrollHub() {
  const [section, setSection] = useState<Section>(getInitialSection);

  function handleSectionChange(value: string) {
    const s = value as Section;
    setSection(s);
    window.history.replaceState(null, "", `#${s}`);
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
