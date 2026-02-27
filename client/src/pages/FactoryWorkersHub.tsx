import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HardHat, DollarSign } from "lucide-react";
import FactoryWorkers from "@/pages/FactoryWorkers";
import FactoryPayrollPage from "@/pages/FactoryPayroll";

export default function FactoryWorkersHub() {
  const [tab, setTab] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "payroll" ? "payroll" : "workers";
  });

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="mb-4">
        <TabsTrigger value="workers" data-testid="tab-workers">
          <HardHat className="h-4 w-4 mr-2" />
          Workers
        </TabsTrigger>
        <TabsTrigger value="payroll" data-testid="tab-payroll">
          <DollarSign className="h-4 w-4 mr-2" />
          Payroll
        </TabsTrigger>
      </TabsList>

      <TabsContent value="workers" className="mt-0">
        <FactoryWorkers />
      </TabsContent>
      <TabsContent value="payroll" className="mt-0">
        <FactoryPayrollPage />
      </TabsContent>
    </Tabs>
  );
}
