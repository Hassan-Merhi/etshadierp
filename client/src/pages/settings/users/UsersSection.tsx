import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { UserPlus, Users } from "lucide-react";
import { UserListTable } from "./UserListTable";
import { UserManagementDrawer } from "./UserManagementDrawer";
import { AddUserDialog } from "./AddUserDialog";

interface UsersSectionProps {
  companies: any[];
  handleAddRole: (userId: string) => void;
  handleEditRole: (role: any) => void;
  handleDeleteRole: (roleId: number, userId: string) => void;
}

export function UsersSection({
  companies,
  handleAddRole,
  handleEditRole,
  handleDeleteRole,
}: UsersSectionProps) {
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/users"],
  });

  const openDrawer = (user: any) => {
    setSelectedUser(user);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedUser(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-users-title">
            <Users className="h-6 w-6" />
            User Management
          </h2>
          <p className="text-muted-foreground mt-1">
            Select a user to manage their account, access, and permissions.
          </p>
        </div>
        <Button
          onClick={() => setAddDialogOpen(true)}
          data-testid="button-add-user"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* User list */}
      <UserListTable
        users={users}
        isLoading={isLoading}
        selectedUserId={selectedUser?.id}
        onSelectUser={openDrawer}
      />

      {/* Management drawer */}
      <UserManagementDrawer
        user={selectedUser}
        open={drawerOpen}
        onClose={closeDrawer}
        companies={companies}
        handleAddRole={handleAddRole}
        handleEditRole={handleEditRole}
        handleDeleteRole={handleDeleteRole}
        onUserDeleted={closeDrawer}
      />

      {/* Add user dialog */}
      <AddUserDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
      />
    </div>
  );
}
