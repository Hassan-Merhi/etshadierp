import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Calendar, MapPin, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface MonthlyData {
  month: number;
  monthName: string;
  inwardQty: number;
  inwardValue: number;
  outwardQty: number;
  outwardValue: number;
  closingQty: number;
  closingValue: number;
}

interface LocationMonthlySummaryData {
  stockItem: {
    id: number;
    code: string;
    name: string;
    uom: string;
  };
  location?: {
    id: number;
    code: string;
    name: string;
  };
  year: number;
  monthlyData: MonthlyData[];
  grandTotal: {
    inwardQty: number;
    inwardValue: number;
    outwardQty: number;
    outwardValue: number;
    closingQty: number;
    closingValue: number;
  };
}

export default function LocationMonthlySummary() {
  const params = useParams();
  const locationId = parseInt(params.locationId || "0");
  const stockItemId = parseInt(params.stockItemId || "0");
  const [_location, navigate] = useLocation();
  
  const isAllLocationsMode = locationId === 0;
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(-1);
  const tableScrollContainer = useRef<HTMLDivElement>(null);
  
  const apiUrl = isAllLocationsMode
    ? `/api/stock-items/${stockItemId}/monthly-summary?year=${selectedYear}`
    : `/api/locations/${locationId}/stock-items/${stockItemId}/monthly-summary?year=${selectedYear}`;
  
  const queryKey = isAllLocationsMode
    ? [`/api/stock-items/${stockItemId}/monthly-summary`, { year: selectedYear }]
    : [`/api/locations/${locationId}/stock-items/${stockItemId}/monthly-summary`, { year: selectedYear }];
  
  const { data, isLoading } = useQuery<LocationMonthlySummaryData>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(apiUrl, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    enabled: stockItemId > 0,
  });
  
  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) {
    years.push(y);
  }
  
  const chartData = data?.monthlyData.map(m => ({
    name: m.monthName.substring(0, 3),
    Inwards: m.inwardQty,
    Outwards: m.outwardQty,
  })) || [];
  
  const handleMonthClick = (month: number) => {
    if (!isAllLocationsMode) {
      navigate(`/locations/${locationId}/stock-items/${stockItemId}/vouchers/${selectedYear}/${month}`);
    }
  };
  
  const formatNumber = (num: number, decimals = 2) => {
    if (num === 0) return "";
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const handleTableKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      window.history.back();
      return;
    }
    
    if (!data?.monthlyData?.length) return;
    
    const rows = data.monthlyData.filter(m => m.inwardQty > 0 || m.outwardQty > 0 || m.closingQty !== 0);
    if (rows.length === 0) return;
    
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedRowIndex(prev => Math.max(-1, prev - 1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (selectedRowIndex === -1) {
        setSelectedRowIndex(0);
      } else if (selectedRowIndex < rows.length - 1) {
        setSelectedRowIndex(prev => prev + 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!isAllLocationsMode && selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
        const month = rows[selectedRowIndex].month;
        handleMonthClick(month);
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        window.history.back();
        return;
      }
      
      if (!data?.monthlyData?.length) return;
      
      const rows = data.monthlyData.filter(m => m.inwardQty > 0 || m.outwardQty > 0 || m.closingQty !== 0);
      if (rows.length === 0) return;
      
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.max(-1, prev - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (selectedRowIndex === -1) {
          setSelectedRowIndex(0);
        } else if (selectedRowIndex < rows.length - 1) {
          setSelectedRowIndex(prev => prev + 1);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!isAllLocationsMode && selectedRowIndex >= 0 && selectedRowIndex < rows.length) {
          const month = rows[selectedRowIndex].month;
          handleMonthClick(month);
        }
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRowIndex, data, isAllLocationsMode]);

  useEffect(() => {
    if (selectedRowIndex < 0 || !tableScrollContainer.current) return;
    const rowElement = tableScrollContainer.current.querySelector(`[data-row-index="${selectedRowIndex}"]`);
    if (rowElement) {
      rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedRowIndex]);
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => window.history.back()} 
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              {isAllLocationsMode ? "Item Monthly Summary" : "Location Monthly Summary"}
            </h1>
            {data?.stockItem && (
              <div className="flex items-center gap-2 text-muted-foreground" data-testid="text-item-location">
                <span>{data.stockItem.name} ({data.stockItem.code})</span>
                <span>•</span>
                {isAllLocationsMode ? (
                  <>
                    <Globe className="h-4 w-4" />
                    <span>All Locations</span>
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" />
                    <span>{data.location?.name || 'Unknown Location'}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[120px]" data-testid="select-year">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <Card className="overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="text-lg">Monthly Summary - {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto flex-1 p-0" ref={tableScrollContainer}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="bg-muted border-b">
                <th rowSpan={2} className="text-left align-bottom px-4 py-2 border-r bg-muted font-medium">Particulars</th>
                <th colSpan={2} className="text-center px-4 py-2 border-r bg-muted font-medium">Inwards</th>
                <th colSpan={2} className="text-center px-4 py-2 border-r bg-muted font-medium">Outwards</th>
                <th colSpan={2} className="text-center px-4 py-2 bg-muted font-medium">Closing Balance</th>
              </tr>
              <tr className="bg-muted/80 border-b">
                <th className="text-right px-4 py-2 bg-muted/80 font-medium">Quantity</th>
                <th className="text-right px-4 py-2 border-r bg-muted/80 font-medium">Value</th>
                <th className="text-right px-4 py-2 bg-muted/80 font-medium">Quantity</th>
                <th className="text-right px-4 py-2 border-r bg-muted/80 font-medium">Value</th>
                <th className="text-right px-4 py-2 bg-muted/80 font-medium">Quantity</th>
                <th className="text-right px-4 py-2 bg-muted/80 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
                {data?.monthlyData.map((month, idx) => {
                  const hasData = month.inwardQty > 0 || month.outwardQty > 0 || month.closingQty !== 0;
                  const displayIndex = data.monthlyData.slice(0, idx).filter(m => m.inwardQty > 0 || m.outwardQty > 0 || m.closingQty !== 0).length;
                  const isSelected = hasData && selectedRowIndex === displayIndex;
                  const isClickable = !isAllLocationsMode;
                  
                  return hasData ? (
                    <tr 
                      key={month.month}
                      className={`border-b ${isClickable ? 'cursor-pointer' : ''} ${isSelected ? "ring-2 ring-primary bg-blue-200 dark:bg-blue-900" : isClickable ? "hover:bg-muted/50" : ""}`}
                      onClick={() => isClickable && handleMonthClick(month.month)}
                      data-testid={`row-month-${month.month}`}
                      data-row-index={displayIndex}
                    >
                      <td className="font-medium px-4 py-3 border-r">{month.monthName}</td>
                      <td className="text-right px-4 py-3 tabular-nums">
                        {formatNumber(month.inwardQty, 0)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums border-r">
                        {formatNumber(month.inwardValue)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums">
                        {formatNumber(month.outwardQty, 0)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums border-r">
                        {formatNumber(month.outwardValue)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums font-medium">
                        {formatNumber(month.closingQty, 0)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums font-medium">
                        {formatNumber(month.closingValue)}
                      </td>
                    </tr>
                  ) : null;
                })}
                
                <tr className="bg-muted/50 font-bold border-t">
                  <td className="px-4 py-3 border-r">Grand Total</td>
                  <td className="text-right px-4 py-3 tabular-nums">
                    {formatNumber(data?.grandTotal.inwardQty || 0, 0)}
                  </td>
                  <td className="text-right px-4 py-3 tabular-nums border-r">
                    {formatNumber(data?.grandTotal.inwardValue || 0)}
                  </td>
                  <td className="text-right px-4 py-3 tabular-nums">
                    {formatNumber(data?.grandTotal.outwardQty || 0, 0)}
                  </td>
                  <td className="text-right px-4 py-3 tabular-nums border-r">
                    {formatNumber(data?.grandTotal.outwardValue || 0)}
                  </td>
                  <td className="text-right px-4 py-3 tabular-nums">
                    {formatNumber(data?.grandTotal.closingQty || 0, 0)}
                  </td>
                  <td className="text-right px-4 py-3 tabular-nums">
                    {formatNumber(data?.grandTotal.closingValue || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Monthly Activity Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderColor: 'hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                  }} 
                />
                <Legend />
                <Bar dataKey="Inwards" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Outwards" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
