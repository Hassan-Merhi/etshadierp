import { Building2, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHubQueryState } from "@/hooks/use-hub-query-state";
import { GcLshiMigration, SpSetup } from "@/lazyPages";

const SETTINGS_TABS = ["setup", "migration"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export default function SpSettings() {
  const [tab, setTab] = useHubQueryState<SettingsTab>({
    key: "tab",
    allowedValues: SETTINGS_TABS,
    defaultValue: "setup",
    omitDefault: true,
  });

  return (
    <div className="space-y-4" data-testid="sp-settings-hub">
      <div>
        <h1 className="text-xl font-semibold">Supplier Partner Administration</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Setup, repair, and controlled migration tools for Supplier Partner companies.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)}>
        <TabsList className="grid w-full max-w-lg grid-cols-2" data-testid="tabs-sp-settings">
          <TabsTrigger value="setup" data-testid="tab-sp-settings-setup">
            <Wrench className="mr-2 h-4 w-4" />
            Setup
          </TabsTrigger>
          <TabsTrigger value="migration" data-testid="tab-sp-settings-migration">
            <Building2 className="mr-2 h-4 w-4" />
            Migration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <SpSetup />
        </TabsContent>
        <TabsContent value="migration" className="mt-4">
          <GcLshiMigration />
        </TabsContent>
      </Tabs>
    </div>
  );
}
