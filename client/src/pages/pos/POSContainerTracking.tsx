import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MapPin, PackageSearch, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDateFormat } from "@/contexts/DateFormatContext";

interface PosUserContext {
  currentCompanyId?: number | null;
  assignedLocationId?: number | null;
  currentLocationId?: number | null;
}

interface PosContainerRow {
  id: number;
  containerNumber: string;
  eta: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  agent: string | null;
  transporter: string | null;
}

interface PosContainerTrackingResponse {
  assignedLocation: {
    id: number;
    name: string;
    code: string;
  };
  total: number;
  containers: PosContainerRow[];
}

async function loadPosContainers(): Promise<PosContainerTrackingResponse> {
  const response = await fetch("/api/pos/containers-otw", {
    credentials: "include",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "Failed to load containers");
  return body;
}

function containsSearch(row: PosContainerRow, search: string): boolean {
  if (!search) return true;
  const haystack = [row.containerNumber, row.eta, row.numberPlate, row.trackingLocation, row.agent, row.transporter]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search);
}

export default function POSContainerTracking({ posUser }: { posUser?: PosUserContext }) {
  const [, setLocation] = useLocation();
  const { formatDisplayDate } = useDateFormat();
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery<PosContainerTrackingResponse>({
    queryKey: [
      "/api/pos/containers-otw",
      posUser?.currentCompanyId ?? null,
      posUser?.assignedLocationId ?? posUser?.currentLocationId ?? null,
    ],
    queryFn: loadPosContainers,
    staleTime: 30_000,
  });

  const normalizedSearch = search.trim().toLowerCase();
  const visibleContainers = useMemo(
    () => (data?.containers ?? []).filter((row) => containsSearch(row, normalizedSearch)),
    [data?.containers, normalizedSearch]
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-3 sm:p-4"
      data-testid="pos-container-tracking-page"
    >
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold sm:text-2xl">Containers OTW</h1>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {data?.assignedLocation?.name
                ? `Only containers assigned to ${data.assignedLocation.name}`
                : "Only containers for your assigned location"}
            </span>
          </div>
        </div>
        <div className="text-sm text-muted-foreground" data-testid="text-pos-container-count">
          {data ? `${data.total} active container${data.total === 1 ? "" : "s"}` : ""}
        </div>
      </div>

      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search container, truck, location, agent, transporter..."
          className="pl-9"
          data-testid="input-pos-container-search"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border" data-table-scroll-region>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex min-h-52 items-center justify-center p-6 text-center">
            <div>
              <p className="font-medium">Could not load containers</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Container #</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Transporter</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleContainers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    {search ? "No matching containers" : "No active containers for your assigned location"}
                  </TableCell>
                </TableRow>
              ) : (
                visibleContainers.map((container) => (
                  <TableRow key={container.id} data-testid={`row-pos-container-${container.id}`}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setLocation(`/pos-containers/${container.id}`)}
                        className="font-mono font-semibold text-primary underline-offset-4 hover:underline"
                        data-testid={`link-pos-container-${container.id}`}
                      >
                        {container.containerNumber}
                      </button>
                    </TableCell>
                    <TableCell>{container.eta ? formatDisplayDate(container.eta) : "—"}</TableCell>
                    <TableCell className="font-mono">{container.numberPlate || "—"}</TableCell>
                    <TableCell>{container.trackingLocation || "—"}</TableCell>
                    <TableCell>{container.agent || "—"}</TableCell>
                    <TableCell>{container.transporter || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
