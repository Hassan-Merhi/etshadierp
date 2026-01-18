import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Package, MapPin, Users, DollarSign, FileCheck, AlertTriangle, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
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

type AgentData = {
  containers: Container[];
  offloadedContainers: Container[];
  total: number;
  offloadedTotal: number;
  balance: number;
};

type DashboardData = {
  containers: Container[];
  byRoute: Record<string, Container[]>;
  byAgent: Record<string, AgentData>;
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
  const [mainTab, setMainTab] = useState<string>("tracking");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

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
    return Array.from(uniqueCompanies.entries()).sort((a, b) => (a[0] || '').localeCompare(b[0] || ''));
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
    const byAgent: Record<string, AgentData> = {};
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
        const originalData = data.byAgent[agent];
        byAgent[agent] = { 
          containers: [], 
          offloadedContainers: originalData?.offloadedContainers || [],
          total: 0, 
          offloadedTotal: originalData?.offloadedTotal || 0,
          balance: originalData?.balance || 0 
        };
      }
      byAgent[agent].containers.push(container);
      byAgent[agent].total += amount;

      if (!byLocation[location]) byLocation[location] = { count: 0, total: 0 };
      byLocation[location].count++;
      byLocation[location].total += amount;

      if (!byTransporter[transporter]) {
        byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
      }
      byTransporter[transporter].otw.push(container);
      byTransporter[transporter].otwTotal += transportFee;

      totalAmount += amount;
    }

    if (data.byTransporter) {
      for (const [transporter, tData] of Object.entries(data.byTransporter)) {
        if (!byTransporter[transporter]) {
          byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
        }
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

  const renderAgentStatement = () => {
    if (!selectedAgent || !data?.byAgent[selectedAgent]) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground mb-4">Select an agent to view their statement</p>
          {agents.map(agent => {
            const agentData = data?.byAgent[agent];
            return (
              <Card 
                key={agent} 
                className="cursor-pointer hover-elevate"
                onClick={() => setSelectedAgent(agent)}
                data-testid={`card-statement-agent-${agent}`}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{agent}</span>
                      <Badge variant="secondary" className="text-xs">{agentData?.containers.length || 0} OTW</Badge>
                      <Badge variant="outline" className="text-xs">{agentData?.offloadedContainers?.length || 0} Offloaded</Badge>
                    </div>
                    <span className={cn("font-bold", (agentData?.balance || 0) < 0 ? "text-red-600" : "text-green-600")}>
                      ${formatNumber(Math.abs(agentData?.balance || 0))} {(agentData?.balance || 0) < 0 ? "Cr" : "Dr"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      );
    }

    const agentData = data.byAgent[selectedAgent];
    
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)} data-testid="button-back-agents">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h3 className="font-bold text-lg">{selectedAgent}</h3>
          <Badge variant={agentData.balance < 0 ? "destructive" : "default"}>
            Balance: ${formatNumber(Math.abs(agentData.balance))} {agentData.balance < 0 ? "Cr" : "Dr"}
          </Badge>
        </div>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400">Offloaded Containers (Balance Owed)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left py-1 px-2 font-medium">Container</th>
                    <th className="text-left py-1 px-2 font-medium">Company</th>
                    <th className="text-right py-1 px-2 font-medium">Amount</th>
                    <th className="text-left py-1 px-2 font-medium">Location</th>
                    <th className="text-left py-1 px-2 font-medium">Offload Date</th>
                  </tr>
                </thead>
                <tbody>
                  {agentData.offloadedContainers?.length > 0 ? (
                    agentData.offloadedContainers.map((container) => (
                      <tr key={container.id} className="border-t" data-testid={`row-offloaded-${container.id}`}>
                        <td className="py-1 px-2 font-mono">{container.containerNumber}</td>
                        <td className="py-1 px-2">{container.companyCode}</td>
                        <td className="py-1 px-2 text-right">${formatNumber(parseFloat(container.grandTotal || "0"))}</td>
                        <td className="py-1 px-2">{container.trackingLocation || "-"}</td>
                        <td className="py-1 px-2">{formatDate(container.offloadDate)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={5} className="py-2 px-2 text-center text-muted-foreground">No offloaded containers</td></tr>
                  )}
                </tbody>
                {agentData.offloadedContainers?.length > 0 && (
                  <tfoot className="bg-green-100 dark:bg-green-900/30">
                    <tr>
                      <td colSpan={2} className="py-1 px-2 font-bold">Total Offloaded</td>
                      <td className="py-1 px-2 text-right font-bold">${formatNumber(agentData.offloadedTotal)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm font-medium text-yellow-700 dark:text-yellow-400">OTW Containers (Pending)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left py-1 px-2 font-medium">Container</th>
                    <th className="text-left py-1 px-2 font-medium">Company</th>
                    <th className="text-right py-1 px-2 font-medium">Amount</th>
                    <th className="text-left py-1 px-2 font-medium">ETA</th>
                    <th className="text-left py-1 px-2 font-medium">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {agentData.containers.length > 0 ? (
                    agentData.containers.map((container) => (
                      <tr key={container.id} className="border-t" data-testid={`row-otw-${container.id}`}>
                        <td className="py-1 px-2 font-mono">{container.containerNumber}</td>
                        <td className="py-1 px-2">{container.companyCode}</td>
                        <td className="py-1 px-2 text-right">${formatNumber(parseFloat(container.grandTotal || "0"))}</td>
                        <td className={cn("py-1 px-2", isOverdue(container.eta) && "text-yellow-600")}>{formatDate(container.eta)}</td>
                        <td className="py-1 px-2">{container.trackingLocation || "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={5} className="py-2 px-2 text-center text-muted-foreground">No OTW containers</td></tr>
                  )}
                </tbody>
                {agentData.containers.length > 0 && (
                  <tfoot className="bg-yellow-100 dark:bg-yellow-900/30">
                    <tr>
                      <td colSpan={2} className="py-1 px-2 font-bold">Total OTW</td>
                      <td className="py-1 px-2 text-right font-bold">${formatNumber(agentData.total)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-3 p-3">
      <PageHeader
        title="Container Tracking"
        subtitle="Cross-company view of containers and agent statements"
      />

      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="tracking" data-testid="tab-main-tracking">Container Tracking</TabsTrigger>
          <TabsTrigger value="statements" data-testid="tab-main-statements">Statement of Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="mt-3">
          <div className="flex flex-wrap gap-2 items-center mb-3">
            <Select value={filterCompany} onValueChange={setFilterCompany}>
              <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-filter-company">
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
              <SelectTrigger className="w-[120px] h-8 text-xs" data-testid="select-filter-agent">
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
              <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-filter-transporter">
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
                className="h-8 text-xs"
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

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
            <div className="lg:col-span-3 space-y-2">
              <div className="grid grid-cols-4 gap-1">
                <Card>
                  <CardContent className="py-1 px-2">
                    <div className="flex items-center gap-1">
                      <Package className="h-3 w-3 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Total OTW</p>
                        <p className="text-sm font-bold">{filteredData?.totals.count || 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-1 px-2">
                    <div className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Total Value</p>
                        <p className="text-sm font-bold">${formatNumber(filteredData?.totals.amount || 0)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-1 px-2">
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Routes</p>
                        <p className="text-sm font-bold">{Object.keys(filteredData?.byRoute || {}).length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-1 px-2">
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      <div>
                        <p className="text-[10px] text-muted-foreground">Agents</p>
                        <p className="text-sm font-bold">{Object.keys(filteredData?.byAgent || {}).filter(a => a !== "Unassigned").length}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="space-y-2">
                  {filteredData && Object.entries(filteredData.byRoute)
                    .sort(([a], [b]) => (a || '').localeCompare(b || ''))
                    .map(([route, containers]) => {
                      const routeTotal = containers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);
                      const isExpanded = expandedRoutes.has(route);
                      
                      return (
                        <Card key={route} className="overflow-hidden">
                          <Collapsible open={isExpanded} onOpenChange={() => toggleRoute(route)}>
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover-elevate py-2 px-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                    <CardTitle className="text-sm font-semibold">
                                      {route === "Unassigned" ? "Unassigned Route" : route}
                                    </CardTitle>
                                    <Badge variant="secondary" className="text-xs">{containers.length}</Badge>
                                  </div>
                                  <span className="text-xs font-medium">${formatNumber(routeTotal)}</span>
                                </div>
                              </CardHeader>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/50">
                                      <tr>
                                        <th className="text-left py-1 px-1 font-medium">#</th>
                                        <th className="text-left py-1 px-1 font-medium">Container</th>
                                        <th className="text-right py-1 px-1 font-medium">Amount</th>
                                        <th className="text-left py-1 px-1 font-medium">Co</th>
                                        <th className="text-left py-1 px-1 font-medium">ETA</th>
                                        <th className="text-left py-1 px-1 font-medium">Plate</th>
                                        <th className="text-left py-1 px-1 font-medium">Location</th>
                                        <th className="text-left py-1 px-1 font-medium">Border</th>
                                        <th className="text-left py-1 px-1 font-medium">Offload</th>
                                        <th className="text-center py-1 px-1 font-medium">Docs</th>
                                        <th className="text-left py-1 px-1 font-medium">Transporter</th>
                                        <th className="text-right py-1 px-1 font-medium">Fee</th>
                                        <th className="text-left py-1 px-1 font-medium">Agent</th>
                                        <th className="text-right py-1 px-1 font-medium">Duty</th>
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
                                          <td className="py-1 px-1">{idx + 1}</td>
                                          <td className="py-1 px-1 font-mono">{container.containerNumber}</td>
                                          <td className="py-1 px-1 text-right">${formatNumber(parseFloat(container.grandTotal || "0"))}</td>
                                          <td className="py-1 px-1">
                                            <Badge variant="outline" className="text-[10px] py-0 px-1">{container.companyCode}</Badge>
                                          </td>
                                          <td className={cn("py-1 px-1", isOverdue(container.eta) && "text-yellow-600 dark:text-yellow-400")}>
                                            {formatDate(container.eta)}
                                          </td>
                                          <td className="py-1 px-1">{container.numberPlate || "-"}</td>
                                          <td className="py-1 px-1">{container.trackingLocation || "-"}</td>
                                          <td className="py-1 px-1">{formatDate(container.borderDate)}</td>
                                          <td className="py-1 px-1">{formatDate(container.offloadDate)}</td>
                                          <td className="py-1 px-1 text-center">
                                            {container.docReceived ? (
                                              <FileCheck className="h-3 w-3 text-green-600 mx-auto" />
                                            ) : (
                                              <AlertTriangle className="h-3 w-3 text-yellow-500 mx-auto" />
                                            )}
                                          </td>
                                          <td className="py-1 px-1">{container.transporter || "-"}</td>
                                          <td className="py-1 px-1 text-right">{container.transportFee ? `$${formatNumber(parseFloat(container.transportFee))}` : "-"}</td>
                                          <td className="py-1 px-1">{container.agent || "-"}</td>
                                          <td className="py-1 px-1 text-right">{container.dutyFee ? `$${formatNumber(parseFloat(container.dutyFee))}` : "-"}</td>
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

            <div className="lg:col-span-1">
              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-2 pr-2">
                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-xs font-medium flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        By Agent
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 py-1 px-3">
                      {filteredData && Object.entries(filteredData.byAgent)
                        .filter(([agent]) => agent !== "Unassigned")
                        .sort(([, a], [, b]) => Math.abs(b.balance) - Math.abs(a.balance))
                        .map(([agent, agentData]) => (
                          <div
                            key={agent}
                            className="flex items-center gap-1 py-1 px-1 rounded hover-elevate cursor-pointer text-xs"
                            onClick={() => setFilterAgent(filterAgent === agent ? "all" : agent)}
                            data-testid={`card-agent-${agent}`}
                          >
                            <span className="font-medium">{agent}</span>
                            <Badge variant="secondary" className="text-[10px] py-0 px-1">{agentData.containers.length}</Badge>
                          </div>
                        ))}
                      {filteredData?.byAgent["Unassigned"] && (
                        <div className="flex items-center gap-1 py-1 rounded text-muted-foreground text-xs">
                          <span>Unassigned</span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1">{filteredData.byAgent["Unassigned"].containers.length}</Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-xs font-medium flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        By Location
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 py-1 px-3">
                      {filteredData && Object.entries(filteredData.byLocation)
                        .sort(([, a], [, b]) => b.count - a.count)
                        .map(([location, locationData]) => (
                          <div
                            key={location}
                            className="flex items-center justify-between py-1 rounded text-xs"
                            data-testid={`card-location-${location}`}
                          >
                            <span>{location}</span>
                            <Badge variant="secondary" className="text-[10px] py-0 px-1">{locationData.count}</Badge>
                          </div>
                        ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-2 px-3">
                      <CardTitle className="text-xs font-medium flex items-center gap-1">
                        <Truck className="h-3 w-3" />
                        Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="py-1 px-3">
                      <div className="space-y-1 text-xs">
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
                </div>
              </ScrollArea>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="statements" className="mt-3">
          <ScrollArea className="h-[calc(100vh-180px)]">
            {renderAgentStatement()}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
