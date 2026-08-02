import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { Building2, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHubQueryState } from "@/hooks/use-hub-query-state";
import { getQueryFn } from "@/lib/queryClient";
import SpSetupPanel from "@/pages/sp/SpSetupPanel";
import GcLshiMigration from "@/pages/sp/GcLshiMigration";

const ADMIN_TABS = ["setup", "migration"] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

export default function SpSetup() {
  const { data: user, isLoading } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30 * 60 * 1000,
  });
  const [tab, setTab] = useHubQueryState<AdminTab>({
    key: "tab",
    allowedValues: ADMIN_TABS,
    defaultValue: "setup",
    omitDefault: true,
  });

  if (isLoading) return null;
  const role = user?.currentRole ?? user?.role;
  const canSetup = role === "Admin" || role === "Developer";
  const canMigrate = role === "Developer";

  if (!canSetup) return <Redirect replace to="/sp" />;
  if (tab === "migration" && !canMigrate) return <Redirect replace to="/sp/setup" />;

  return (
    <div className="space-y-4" data-testid="sp-administration-hub">
      <div>
        <h1 className="text-xl font-semibold">Supplier Partner Administration</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Setup, repair, and controlled migration tools for Supplier Partner companies.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as AdminTab)}>
        <TabsList
          className={`grid w-full max-w-lg ${canMigrate ? "grid-cols-2" : "grid-cols-1"}`}
          data-testid="tabs-sp-administration"
        >
          <TabsTrigger value="setup" data-testid="tab-sp-administration-setup">
            <Wrench className="mr-2 h-4 w-4" /> Setup
          </TabsTrigger>
          {canMigrate && (
            <TabsTrigger value="migration" data-testid="tab-sp-administration-migration">
              <Building2 className="mr-2 h-4 w-4" /> Migration
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="setup" className="mt-4">
          <SpSetupPanel />
        </TabsContent>
        {canMigrate && (
          <TabsContent value="migration" className="mt-4">
            <GcLshiMigration />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
