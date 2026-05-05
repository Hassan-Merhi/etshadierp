import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Users, Shield, Eye, Clock, Activity } from "lucide-react";
import { UsersSection } from "./UsersSection";
import { ModuleAccessSection } from "./ModuleAccessSection";
import { PageVisibilityTree } from "./PageVisibilityTree";
import { LoginHistoryTab } from "./LoginHistoryTab";
import { ActiveUsersSection } from "./ActiveUsersSection";
import { Badge } from "@/components/ui/badge";

interface UsersPermissionsHubProps {
  userRole?: string;
  appMode?: string;
}

export function UsersPermissionsHub({ userRole, appMode }: UsersPermissionsHubProps) {
  const [activeTab, setActiveTab] = useState("users");

  const isDev = userRole === "Developer";
  const isAdmin = userRole === "Admin" || isDev;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2">
          <Users className="h-6 w-6" />
          Users &amp; Permissions
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Manage users, roles, module access, and page visibility controls.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="users" className="flex items-center gap-1.5" data-testid="tab-users-list">
            <Users className="h-3.5 w-3.5" />
            Users
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="module-access" className="flex items-center gap-1.5" data-testid="tab-module-access">
              <Shield className="h-3.5 w-3.5" />
              Module Access
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="page-visibility" className="flex items-center gap-1.5" data-testid="tab-page-visibility">
              <Eye className="h-3.5 w-3.5" />
              Page Visibility
            </TabsTrigger>
          )}
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

        {isAdmin && (
          <TabsContent value="module-access" className="mt-4">
            <ModuleAccessSection />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="page-visibility" className="mt-4">
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold">Page Visibility</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Control which pages and features are visible to each role. Items marked{" "}
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
                    Needs mapping
                  </Badge>{" "}
                  are not yet connected to the permission system.
                </p>
              </div>
              <PageVisibilityTree appMode={appMode} />
            </div>
          </TabsContent>
        )}

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
