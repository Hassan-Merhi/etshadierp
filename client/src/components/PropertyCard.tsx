import * as React from "react";
import { Link } from "wouter";
import { Building2, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge, type StatusKind } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

export interface PropertyCardProps {
  name: string;
  address?: string;
  status?: StatusKind | string;
  unitsLabel?: string;
  primaryStat?: { label: string; value: React.ReactNode };
  secondaryStat?: { label: string; value: React.ReactNode };
  href?: string;
  imageUrl?: string;
  children?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * PropertyCard — canonical card for a property/unit/listing summary in the
 * Properties module.
 */
export function PropertyCard({
  name,
  address,
  status,
  unitsLabel,
  primaryStat,
  secondaryStat,
  href,
  imageUrl,
  children,
  className,
  "data-testid": testId,
}: PropertyCardProps) {
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const inner = (
    <Card
      className={cn(
        "overflow-hidden flex flex-col h-full",
        href && "hover-elevate active-elevate-2 cursor-pointer",
        className
      )}
      data-testid={testId ?? `card-property-${slug}`}
    >
      {imageUrl ? (
        <div
          className="h-32 w-full bg-cover bg-center bg-muted"
          style={{ backgroundImage: `url(${imageUrl})` }}
          aria-hidden
        />
      ) : (
        <div className="h-20 w-full bg-muted/50 flex items-center justify-center">
          <Building2 className="h-8 w-8 text-muted-foreground/60" aria-hidden />
        </div>
      )}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight truncate" data-testid={`text-property-name-${slug}`}>
              {name}
            </div>
            {address && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{address}</span>
              </div>
            )}
          </div>
          {status && <StatusBadge status={status} className="shrink-0" />}
        </div>

        {(primaryStat || secondaryStat || unitsLabel) && (
          <div className="grid grid-cols-2 gap-2 pt-1 border-t">
            {primaryStat && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{primaryStat.label}</div>
                <div className="text-sm font-semibold tabular-nums">{primaryStat.value}</div>
              </div>
            )}
            {secondaryStat && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{secondaryStat.label}</div>
                <div className="text-sm font-semibold tabular-nums">{secondaryStat.value}</div>
              </div>
            )}
            {!primaryStat && !secondaryStat && unitsLabel && (
              <div className="col-span-2 text-xs text-muted-foreground">{unitsLabel}</div>
            )}
          </div>
        )}

        {children}
      </div>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
