import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Users, Truck, AlertTriangle, Activity, Scale, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface DashboardData {
  today: {
    kgPressed: number;
    balesProduced: number;
    wasteKg: number;
  };
  workers: {
    active: number;
    totalBalesToday: number;
  };
  containers: {
    total: number;
    missingDocs: number;
  };
  freight: {
    unpaidCount: number;
    partialCount: number;
  };
  recentActivity: Array<{
    id?: number;
    date: string;
    txType: string;
    description: string;
  }>;
}

export default function FactoryDashboard() {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/factory/dashboard", date],
    queryFn: async () => {
      const res = await fetch(`/api/factory/dashboard?date=${date}`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Dashboard</h1>
          <p className="text-muted-foreground mt-1">Production overview and operations</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
            data-testid="input-date"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">KG Pressed</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-kg-pressed">
              {data?.today?.kgPressed ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Bales Produced</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-bales-produced">
              {data?.today?.balesProduced ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Waste</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-waste-kg">
              {data?.today?.wasteKg ?? 0} KG
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Active Workers</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-active-workers">
              {data?.workers?.active ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Containers</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-containers-total">
              {data?.containers?.total ?? 0} <span className="text-sm font-normal text-muted-foreground">total</span>
            </p>
            <p className="text-sm mt-1" data-testid="text-containers-missing-docs">
              {(data?.containers?.missingDocs ?? 0) > 0 ? (
                <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {data?.containers?.missingDocs} missing docs
                </span>
              ) : (
                <span className="text-muted-foreground">No missing docs</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Freight</p>
            </div>
            <div className="flex items-center gap-2 mt-1" data-testid="text-freight-summary">
              <Badge variant="outline">{data?.freight?.unpaidCount ?? 0} unpaid</Badge>
              <Badge variant="outline">{data?.freight?.partialCount ?? 0} partial</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Workers Today</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-workers-bales-today">
              {data?.workers?.totalBalesToday ?? 0} <span className="text-sm font-normal text-muted-foreground">bales</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.recentActivity || data.recentActivity.length === 0 ? (
            <div className="text-center py-8">
              <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground mt-2">No recent activity</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentActivity.map((entry, idx) => (
                    <TableRow key={entry.id ?? idx} data-testid={`row-activity-${entry.id ?? idx}`}>
                      <TableCell className="font-mono text-sm">{entry.date}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.txType}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
