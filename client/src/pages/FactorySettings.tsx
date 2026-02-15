import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FactorySettingsData {
  dashboardEnabled: boolean;
  kpisEnabled: boolean;
  profitabilityEnabled: boolean;
  alertsEnabled: boolean;
  supplierScoringEnabled: boolean;
  mixOptimizerEnabled: boolean;
  traceabilityEnabled: boolean;
  balePhotosEnabled: boolean;
  wasteTrackingEnabled: boolean;
  cashflowEnabled: boolean;
  rolesEnabled: boolean;
  laborCostPerKg: number;
  overheadPerKg: number;
}

const defaultSettings: FactorySettingsData = {
  dashboardEnabled: true,
  kpisEnabled: true,
  profitabilityEnabled: true,
  alertsEnabled: true,
  supplierScoringEnabled: true,
  mixOptimizerEnabled: true,
  traceabilityEnabled: true,
  balePhotosEnabled: true,
  wasteTrackingEnabled: true,
  cashflowEnabled: true,
  rolesEnabled: true,
  laborCostPerKg: 0,
  overheadPerKg: 0,
};

export default function FactorySettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<FactorySettingsData>(defaultSettings);

  const { data, isLoading } = useQuery<FactorySettingsData>({
    queryKey: ['/api/factory/settings'],
  });

  useEffect(() => {
    if (data) {
      setSettings(data);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (updated: FactorySettingsData) => {
      const res = await apiRequest("PUT", "/api/factory/settings", updated);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/factory/settings'] });
      toast({ title: "Settings saved", description: "Factory settings have been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (key: keyof FactorySettingsData) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNumberChange = (key: keyof FactorySettingsData, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: parseFloat(value) || 0 }));
  };

  const handleSave = () => {
    mutation.mutate(settings);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading factory settings...</span>
      </div>
    );
  }

  const toggleItem = (label: string, key: keyof FactorySettingsData) => (
    <div className="flex items-center justify-between gap-4 py-3" key={key} data-testid={`toggle-row-${key}`}>
      <Label htmlFor={key} className="text-sm font-medium cursor-pointer">{label}</Label>
      <Switch
        id={key}
        checked={!!settings[key]}
        onCheckedChange={() => handleToggle(key)}
        data-testid={`switch-${key}`}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Settings</h1>
          <p className="text-muted-foreground mt-1">Toggle factory intelligence features on or off</p>
        </div>
        <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-settings">
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Settings
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-production">Production Intelligence</CardTitle>
            <CardDescription>Core production monitoring and analytics</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Dashboard", "dashboardEnabled")}
            {toggleItem("KPIs", "kpisEnabled")}
            {toggleItem("Waste Tracking", "wasteTrackingEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-financial">Financial Intelligence</CardTitle>
            <CardDescription>Profitability and cash flow analysis</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Profitability Engine", "profitabilityEnabled")}
            {toggleItem("Cash Flow", "cashflowEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-supply-chain">Supply Chain</CardTitle>
            <CardDescription>Supplier management, optimization, and traceability</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Supplier Scoring", "supplierScoringEnabled")}
            {toggleItem("Mix Optimizer", "mixOptimizerEnabled")}
            {toggleItem("Traceability", "traceabilityEnabled")}
            {toggleItem("Bale Photos", "balePhotosEnabled")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle data-testid="text-section-operations">Operations</CardTitle>
            <CardDescription>Alerts and access control</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {toggleItem("Alerts System", "alertsEnabled")}
            {toggleItem("Roles & Permissions", "rolesEnabled")}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle data-testid="text-section-cost">Cost Configuration</CardTitle>
            <CardDescription>Default cost parameters for profitability calculations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="laborCostPerKg">Labor Cost per KG</Label>
                <Input
                  id="laborCostPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.laborCostPerKg}
                  onChange={(e) => handleNumberChange("laborCostPerKg", e.target.value)}
                  data-testid="input-laborCostPerKg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overheadPerKg">Overhead per KG</Label>
                <Input
                  id="overheadPerKg"
                  type="number"
                  step="0.01"
                  min="0"
                  value={settings.overheadPerKg}
                  onChange={(e) => handleNumberChange("overheadPerKg", e.target.value)}
                  data-testid="input-overheadPerKg"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
