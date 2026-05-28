import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, Activity } from "lucide-react";
import { ActiveUsersSection } from "./ActiveUsersSection";
import { ActiveSessionsTab } from "./ActiveSessionsTab";

export function SessionsHub({ isAdmin, isDev }: { isAdmin: boolean; isDev: boolean }) {
  const [tab, setTab] = useState(isDev ? "watch" : "sessions");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Sessions & Users
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Monitor active user sessions and watch real-time user activity.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="sessions" className="flex items-center gap-1">
            <Shield className="h-3.5 w-3.5" />
            Active Sessions
          </TabsTrigger>
          {isDev && (
            <TabsTrigger value="watch" className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              Active Users Watch
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <ActiveSessionsTab isAdmin={isAdmin} />
        </TabsContent>
        {isDev && (
          <TabsContent value="watch" className="mt-4">
            <ActiveUsersSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
