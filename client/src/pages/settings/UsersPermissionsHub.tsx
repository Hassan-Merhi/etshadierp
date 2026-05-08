import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, Clock, Activity } from "lucide-react";
import { UsersSection } from "./UsersSection";
import { LoginHistoryTab } from "./LoginHistoryTab";
import { ActiveUsersSection } from "./ActiveUsersSection";

interface UsersPermissionsHubProps {
  userRole?: string;
  appMode?: string;
}

export function UsersPermissionsHub({ userRole, appMode }: UsersPermissionsHubProps) {
  const [activeTab, setActiveTab] = useState("users");

  const isDev = userRole === "Developer";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Users &amp; Permissions
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Manage users and role assignments.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="users" className="flex items-center gap-1.5" data-testid="tab-users-list">
            <Users className="h-3.5 w-3.5" />
            Users
          </TabsTrigger>
          {isDev && (
            <TabsTrigger value="login-history" className="flex items-center gap-1.5" data-testid="tab-login-history">
              <Clock className="h-3.5 w-3.5" />
              Login History
            </TabsTrigger>
          )}
          {isDev && (
            <TabsTrigger value="active-users" className="flex items-center gap-1.5" data-testid="tab-active-users">
              <Activity className="h-3.5 w-3.5" />
              Active Sessions
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <UsersSection />
        </TabsContent>

        {isDev && (
          <TabsContent value="login-history" className="mt-4">
            <LoginHistoryTab />
          </TabsContent>
        )}

        {isDev && (
          <TabsContent value="active-users" className="mt-4">
            <ActiveUsersSection />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
