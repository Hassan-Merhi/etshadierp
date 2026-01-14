import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Package, MapPin, Users, DollarSign, FileCheck, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Container = {
  id: number;
  containerNumber: string;
  companyId: number;
  companyName: string;
  companyCode: string;
  supplierId: number;
  supplierName: string;
  grandTotal: string;
  shopName: string | null;
  eta: string | null;
  transporter: string | null;
  transportFee: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  offloadDate: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean;
};

type TransporterData = {
  otw: Container[];
  offloaded: Container[];
  otwTotal: number;
  offloadedTotal: number;
};

type DashboardData = {
  containers: Container[];
  byRoute: Record<string, Container[]>;
  byAgent: Record<string, { containers: Container[]; total: number; balance: number }>;
  byLocation: Record<string, { count: number; total: number }>;
  byTransporter: Record<string, TransporterData>;
  totals: { count: number; amount: number };
};

export default function ContainerDashboard() {
  const { selectCompany, companies } = useCompany();
  const [, navigate] = useLocation();
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterTransporter, setFilterTransporter] = useState<string>("all");
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard/container-tracking"],
  });

  const agents = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.byAgent).filter(a => a !== "Unassigned").sort();
  }, [data]);

  const companyFilterOptions = useMemo(() => {
    if (!data) return [];
    const uniqueCompanies = new Map<string, string>();
    data.containers.forEach(c => {
      uniqueCompanies.set(c.companyCode, c.companyName);
    });
    return Array.from(uniqueCompanies.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const transporters = useMemo(() => {
    if (!data) return [];
    const unique = new Set<string>();
    data.containers.forEach(c => {
      if (c.transporter) unique.add(c.transporter);
    });
    return Array.from(unique).sort();
  }, [data]);

  const filteredData = useMemo(() => {
    if (!data) return null;
    
    let containers = data.containers;
    
    if (filterAgent !== "all") {
      containers = containers.filter(c => c.agent === filterAgent);
    }
    if (filterCompany !== "all") {
      containers = containers.filter(c => c.companyCode === filterCompany);
    }
    if (filterTransporter !== "all") {
      containers = containers.filter(c => c.transporter === filterTransporter);
    }

    const byRoute: Record<string, Container[]> = {};
    const byAgent: Record<string, { containers: Container[]; total: number; balance: number }> = {};
    const byLocation: Record<string, { count: number; total: number }> = {};
    const byTransporter: Record<string, TransporterData> = {};
    let totalAmount = 0;

    for (const container of containers) {
      const route = container.shopName || "Unassigned";
      const agent = container.agent || "Unassigned";
      const location = container.trackingLocation || "Unknown";
      const transporter = container.transporter || "Unassigned";
      const amount = parseFloat(String(container.grandTotal || "0"));
      const transportFee = parseFloat(String(container.transportFee || "0"));

      if (!byRoute[route]) byRoute[route] = [];
      byRoute[route].push(container);

      if (!byAgent[agent]) {
        // Get balance from original API data
        const originalBalance = data.byAgent[agent]?.balance || 0;
        byAgent[agent] = { containers: [], total: 0, balance: originalBalance };
      }
      byAgent[agent].containers.push(container);
      byAgent[agent].total += amount;

      if (!byLocation[location]) byLocation[location] = { count: 0, total: 0 };
      byLocation[location].count++;
      byLocation[location].total += amount;

      // Build filtered transporter data from OTW containers
      if (!byTransporter[transporter]) {
        byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
      }
      byTransporter[transporter].otw.push(container);
      byTransporter[transporter].otwTotal += transportFee;

      totalAmount += amount;
    }

    // Add offloaded containers from API (these are not affected by filters)
    if (data.byTransporter) {
      for (const [transporter, tData] of Object.entries(data.byTransporter)) {
        if (!byTransporter[transporter]) {
          byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
        }
        // Filter offloaded containers by company if filter is applied
        let offloaded = tData.offloaded;
        if (filterCompany !== "all") {
          offloaded = offloaded.filter(c => c.companyCode === filterCompany);
        }
        if (filterAgent !== "all") {
          offloaded = offloaded.filter(c => c.agent === filterAgent);
        }
        byTransporter[transporter].offloaded = offloaded;
        byTransporter[transporter].offloadedTotal = offloaded.reduce(
          (sum, c) => sum + parseFloat(String(c.transportFee || "0")), 0
        );
      }
    }

    return {
      containers,
      byRoute,
      byAgent,
      byLocation,
      byTransporter,
      totals: { count: containers.length, amount: totalAmount },
    };
  }, [data, filterAgent, filterCompany, filterTransporter]);

  const toggleRoute = (route: string) => {
    const newExpanded = new Set(expandedRoutes);
    if (newExpanded.has(route)) {
      newExpanded.delete(route);
    } else {
      newExpanded.add(route);
    }
    setExpandedRoutes(newExpanded);
  };

  const handleContainerClick = (companyId: number) => {
    const company = companies.find(c => c.id === companyId);
    if (company) { selectCompany(company); navigate("/containers"); }
    
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
    } catch {
      return dateStr;
    }
  };

  const isOverdue = (eta: string | null) => {
    if (!eta) return false;
    try {
      return new Date(eta) < new Date();
    } catch {
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Container Tracking Dashboard"
        subtitle="Cross-company view of all containers on the way"
      />

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filterCompany} onValueChange={setFilterCompany}>
          <SelectTrigger className="w-[180px]" data-testid="select-filter-company">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companyFilterOptions.map(([code, name]) => (
              <SelectItem key={code} value={code}>{code} - {name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterAgent} onValueChange={setFilterAgent}>
          <SelectTrigger className="w-[150px]" data-testid="select-filter-agent">
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents.map(agent => (
              <SelectItem key={agent} value={agent}>{agent}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterTransporter} onValueChange={setFilterTransporter}>
          <SelectTrigger className="w-[180px]" data-testid="select-filter-transporter">
            <SelectValue placeholder="All Transporters" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Transporters</SelectItem>
            {transporters.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(filterAgent !== "all" || filterCompany !== "all" || filterTransporter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterAgent("all");
              setFilterCompany("all");
              setFilterTransporter("all");
            }}
            data-testid="button-clear-filters"
          >
            Clear Filters
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total OTW</p>
                    <p className="text-2xl font-bold">{filteredData?.totals.count || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Value</p>
                    <p className="text-2xl font-bold">${formatNumber(filteredData?.totals.amount || 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Routes</p>
                    <p className="text-2xl font-bold">{Object.keys(filteredData?.byRoute || {}).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Agents</p>
                    <p className="text-2xl font-bold">{Object.keys(filteredData?.byAgent || {}).filter(a => a !== "Unassigned").length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="space-y-3">
              {filteredData && Object.entries(filteredData.byRoute)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([route, containers]) => {
                  const routeTotal = containers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);
                  const isExpanded = expandedRoutes.has(route);
                  
                  return (
                    <Card key={route} className="overflow-hidden">
                      <Collapsible open={isExpanded} onOpenChange={() => toggleRoute(route)}>
                        <CollapsibleTrigger asChild>
                          <CardHeader className="cursor-pointer hover-elevate py-3 px-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <CardTitle className="text-base font-semibold">
                                  {route === "Unassigned" ? "Unassigned Route" : route}
                                </CardTitle>
                                <Badge variant="secondary">{containers.length}</Badge>
                              </div>
                              <span className="text-sm font-medium">${formatNumber(routeTotal)}</span>
                            </div>
                          </CardHeader>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="p-0">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="text-left p-2 font-medium">#</th>
                                    <th className="text-left p-2 font-medium">Container</th>
                                    <th className="text-right p-2 font-medium">Amount</th>
                                    <th className="text-left p-2 font-medium">Company</th>
                                    <th className="text-left p-2 font-medium">ETA</th>
                                    <th className="text-left p-2 font-medium">Plate</th>
                                    <th className="text-left p-2 font-medium">Location</th>
                                    <th className="text-left p-2 font-medium">Border</th>
                                    <th className="text-left p-2 font-medium">Offload</th>
                                    <th className="text-center p-2 font-medium">Docs</th>
                                    <th className="text-left p-2 font-medium">Transporter</th>
                                    <th className="text-right p-2 font-medium">Fee</th>
                                    <th className="text-left p-2 font-medium">Agent</th>
                                    <th className="text-right p-2 font-medium">Duty</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {containers.map((container, idx) => (
                                    <tr
                                      key={container.id}
                                      className={cn(
                                        "border-t hover-elevate cursor-pointer",
                                        container.docReceived && "bg-green-500/10",
                                        isOverdue(container.eta) && !container.docReceived && "bg-yellow-500/10"
                                      )}
                                      onClick={() => handleContainerClick(container.companyId)}
                                      data-testid={`row-container-${container.id}`}
                                    >
                                      <td className="p-2">{idx + 1}</td>
                                      <td className="p-2 font-mono text-xs">{container.containerNumber}</td>
                                      <td className="p-2 text-right">${formatNumber(parseFloat(container.grandTotal || "0"))}</td>
                                      <td className="p-2">
                                        <Badge variant="outline" className="text-xs">{container.companyCode}</Badge>
                                      </td>
                                      <td className={cn("p-2", isOverdue(container.eta) && "text-yellow-600 dark:text-yellow-400")}>
                                        {formatDate(container.eta)}
                                      </td>
                                      <td className="p-2 text-xs">{container.numberPlate || "-"}</td>
                                      <td className="p-2 text-xs">{container.trackingLocation || "-"}</td>
                                      <td className="p-2">{formatDate(container.borderDate)}</td>
                                      <td className="p-2">{formatDate(container.offloadDate)}</td>
                                      <td className="p-2 text-center">
                                        {container.docReceived ? (
                                          <FileCheck className="h-4 w-4 text-green-600 mx-auto" />
                                        ) : (
                                          <AlertTriangle className="h-4 w-4 text-yellow-500 mx-auto" />
                                        )}
                                      </td>
                                      <td className="p-2 text-xs">{container.transporter || "-"}</td>
                                      <td className="p-2 text-right">{container.transportFee ? `$${formatNumber(parseFloat(container.transportFee))}` : "-"}</td>
                                      <td className="p-2">{container.agent || "-"}</td>
                                      <td className="p-2 text-right">{container.dutyFee ? `$${formatNumber(parseFloat(container.dutyFee))}` : "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  );
                })}
            </div>
          </ScrollArea>
        </div>

        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="summary" data-testid="tab-summary">Summary</TabsTrigger>
            <TabsTrigger value="transporter" data-testid="tab-transporter">Transporter</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  By Agent
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {filteredData && Object.entries(filteredData.byAgent)
                  .filter(([agent]) => agent !== "Unassigned")
                  .sort(([, a], [, b]) => Math.abs(b.balance) - Math.abs(a.balance))
                  .map(([agent, agentData]) => (
                    <div
                      key={agent}
                      className="flex items-center justify-between p-2 rounded hover-elevate cursor-pointer"
                      onClick={() => setFilterAgent(filterAgent === agent ? "all" : agent)}
                      data-testid={`card-agent-${agent}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agent}</span>
                        <Badge variant="secondary" className="text-xs">{agentData.containers.length}</Badge>
                      </div>
                      <span className={cn("text-sm font-medium", agentData.balance > 0 ? "text-red-600" : agentData.balance < 0 ? "text-green-600" : "")}>
                        ${formatNumber(Math.abs(agentData.balance))}
                      </span>
                    </div>
                  ))}
                {filteredData?.byAgent["Unassigned"] && (
                  <div className="flex items-center justify-between p-2 rounded text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>Unassigned</span>
                      <Badge variant="outline" className="text-xs">{filteredData.byAgent["Unassigned"].containers.length}</Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  By Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {filteredData && Object.entries(filteredData.byLocation)
                  .sort(([, a], [, b]) => b.count - a.count)
                  .slice(0, 10)
                  .map(([location, locationData]) => (
                    <div
                      key={location}
                      className="flex items-center justify-between p-2 rounded"
                      data-testid={`card-location-${location}`}
                    >
                      <span className="text-sm">{location}</span>
                      <Badge variant="secondary" className="text-xs">{locationData.count}</Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Containers</span>
                    <span className="font-bold">{filteredData?.totals.count || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Value</span>
                    <span className="font-bold">${formatNumber(filteredData?.totals.amount || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Docs Received</span>
                    <span className="font-bold text-green-600">
                      {filteredData?.containers.filter(c => c.docReceived).length || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pending Docs</span>
                    <span className="font-bold text-yellow-600">
                      {filteredData?.containers.filter(c => !c.docReceived).length || 0}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transporter" className="mt-4">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="space-y-4">
                {filteredData?.byTransporter && Object.entries(filteredData.byTransporter)
                  .filter(([name]) => name !== "Unassigned")
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([transporterName, transporterData]) => (
                    <Card key={transporterName}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4" />
                            {transporterName}
                          </div>
                          <Badge variant="secondary">
                            {transporterData.offloaded.length + transporterData.otw.length} containers
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {transporterData.offloaded.length > 0 && (
                          <div className="bg-yellow-500/20 rounded-md p-2">
                            <div className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-2">
                              Already Offloaded ({transporterData.offloaded.length})
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="text-left p-1">Container</th>
                                    <th className="text-left p-1">Company</th>
                                    <th className="text-left p-1">Plate</th>
                                    <th className="text-left p-1">Border</th>
                                    <th className="text-left p-1">Location</th>
                                    <th className="text-right p-1">Fee</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {transporterData.offloaded.map(c => (
                                    <tr key={c.id} className="border-t border-yellow-500/30">
                                      <td className="p-1 font-mono">{c.containerNumber}</td>
                                      <td className="p-1">{c.companyCode}</td>
                                      <td className="p-1">{c.numberPlate || "-"}</td>
                                      <td className="p-1">{formatDate(c.borderDate)}</td>
                                      <td className="p-1">{c.trackingLocation || "-"}</td>
                                      <td className="p-1 text-right">${formatNumber(parseFloat(String(c.transportFee || "0")))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 border-yellow-500/50 font-medium">
                                    <td colSpan={5} className="p-1 text-right">Total:</td>
                                    <td className="p-1 text-right">${formatNumber(transporterData.offloadedTotal || 0)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        )}

                        {transporterData.otw.length > 0 && (
                          <div className="bg-muted/50 rounded-md p-2">
                            <div className="text-xs font-medium text-muted-foreground mb-2">
                              On The Way ({transporterData.otw.length})
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground">
                                    <th className="text-left p-1">Container</th>
                                    <th className="text-left p-1">Company</th>
                                    <th className="text-left p-1">Plate</th>
                                    <th className="text-left p-1">Border</th>
                                    <th className="text-left p-1">Location</th>
                                    <th className="text-right p-1">Fee</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {transporterData.otw.map(c => (
                                    <tr key={c.id} className="border-t">
                                      <td className="p-1 font-mono">{c.containerNumber}</td>
                                      <td className="p-1">{c.companyCode}</td>
                                      <td className="p-1">{c.numberPlate || "-"}</td>
                                      <td className="p-1">{formatDate(c.borderDate)}</td>
                                      <td className="p-1">{c.trackingLocation || "-"}</td>
                                      <td className="p-1 text-right">${formatNumber(parseFloat(String(c.transportFee || "0")))}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t-2 font-medium">
                                    <td colSpan={5} className="p-1 text-right">Total:</td>
                                    <td className="p-1 text-right">${formatNumber(transporterData.otwTotal || 0)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between pt-2 border-t font-medium text-sm">
                          <span>Grand Total:</span>
                          <span>${formatNumber((transporterData.offloadedTotal || 0) + (transporterData.otwTotal || 0))}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
