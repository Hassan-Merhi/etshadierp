import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Plus, Edit, Check, X, EyeOff, Eye, Tag, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface StockGrade {
  id: number;
  name: string;
  active: boolean;
  companyId: number;
  createdAt: string;
}

interface StockCategory {
  id: number;
  name: string;
  active: boolean;
  companyId: number;
  createdAt: string;
}

function MetaList({
  title,
  icon: Icon,
  apiPath,
  queryKey,
  testPrefix,
}: {
  title: string;
  icon: React.ElementType;
  apiPath: string;
  queryKey: string;
  testPrefix: string;
}) {
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const { data: items = [], isLoading } = useQuery<StockGrade[] | StockCategory[]>({
    queryKey: [apiPath, { includeInactive: showInactive }],
    queryFn: async () => {
      const url = showInactive ? `${apiPath}?includeInactive=true` : apiPath;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", apiPath, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      setNewName("");
      toast({ title: "Created", description: `${title.slice(0, -1)} created successfully` });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to create", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      return await apiRequest("PATCH", `${apiPath}/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
      setEditingId(null);
      toast({ title: "Updated", description: "Name updated successfully" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      if (!active) {
        return await apiRequest("DELETE", `${apiPath}/${id}`);
      } else {
        return await apiRequest("PATCH", `${apiPath}/${id}`, { active: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [apiPath] });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    createMutation.mutate(trimmed);
  };

  const handleEditSave = (id: number) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id, name: trimmed });
  };

  const startEdit = (item: StockGrade | StockCategory) => {
    setEditingId(item.id);
    setEditName(item.name);
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-base font-semibold">{title}</h3>
          <Badge variant="secondary" className="text-xs">{items.filter((i: any) => i.active).length} active</Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowInactive(v => !v)}
          data-testid={`${testPrefix}-toggle-inactive`}
        >
          {showInactive ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
          {showInactive ? "Hide Inactive" : "Show Inactive"}
        </Button>
      </div>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder={`New ${title.slice(0, -1).toLowerCase()} name...`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          data-testid={`${testPrefix}-new-name`}
          className="flex-1"
        />
        <Button
          onClick={handleCreate}
          disabled={createMutation.isPending || !newName.trim()}
          data-testid={`${testPrefix}-create`}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No {title.toLowerCase()} found. Add one above.
        </p>
      ) : (
        <div className="space-y-1">
          {(items as (StockGrade | StockCategory)[]).map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border ${!item.active ? "opacity-50" : ""}`}
              data-testid={`${testPrefix}-row-${item.id}`}
            >
              {editingId === item.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditSave(item.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 h-8"
                    autoFocus
                    data-testid={`${testPrefix}-edit-input-${item.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEditSave(item.id)}
                    disabled={updateMutation.isPending}
                    data-testid={`${testPrefix}-save-${item.id}`}
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    data-testid={`${testPrefix}-cancel-${item.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{item.name}</span>
                  {!item.active && (
                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => startEdit(item)}
                    data-testid={`${testPrefix}-edit-${item.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate({ id: item.id, active: !item.active })}
                    disabled={toggleActiveMutation.isPending}
                    data-testid={`${testPrefix}-toggle-${item.id}`}
                    title={item.active ? "Deactivate" : "Reactivate"}
                  >
                    {item.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function GradesCategoriesManager() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Grades & Categories</h2>
        <p className="text-sm text-muted-foreground">
          Manage stock item grades and categories. These are optional metadata fields that can be assigned to any stock item.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetaList
          title="Grades"
          icon={Tag}
          apiPath="/api/stock-grades"
          queryKey="/api/stock-grades"
          testPrefix="grade"
        />
        <MetaList
          title="Categories"
          icon={Layers}
          apiPath="/api/stock-categories"
          queryKey="/api/stock-categories"
          testPrefix="category"
        />
      </div>
    </div>
  );
}
