import { useQuery } from "@tanstack/react-query";
import { A4_DESIGN_OPTIONS, setBannerTimestamps } from "@/lib/labelHtml";

export interface DesignColorOption {
  value: string;
  label: string;
  color: string;
  previewUrl: string;
  isDefault: boolean;
  hasCustom?: boolean;
  lastModified?: number | null;
  id?: number;
  slug?: string;
  colorHex?: string;
}

const STATIC_FALLBACK: DesignColorOption[] = A4_DESIGN_OPTIONS.map((o) => ({
  ...o,
  isDefault: true,
  hasCustom: false,
  lastModified: null,
}));

function rowToOption(r: any): DesignColorOption {
  const ts: number | null = r.hasCustom && r.lastModified ? r.lastModified : null;
  return {
    id: r.id,
    slug: r.slug,
    value: r.slug,
    label: r.label,
    color: r.colorHex,
    colorHex: r.colorHex,
    previewUrl: ts ? `/labels/hmd-${r.slug}.jpg?t=${ts}` : `/labels/hmd-${r.slug}.jpg`,
    isDefault: r.isDefault,
    hasCustom: r.hasCustom,
    lastModified: r.lastModified,
  };
}

export function useLabelDesignColors() {
  const query = useQuery<DesignColorOption[]>({
    queryKey: ["/api/factory/label-design-colors"],
    queryFn: () =>
      fetch("/api/factory/label-design-colors", { credentials: "include" })
        .then((r) => r.json())
        .then((rows) => {
          const colors = Array.isArray(rows) ? rows.map(rowToOption) : STATIC_FALLBACK;
          const timestamps: Record<string, number | null> = {};
          for (const c of colors) {
            timestamps[c.value] = c.hasCustom && c.lastModified ? c.lastModified : null;
          }
          setBannerTimestamps(timestamps);
          return colors;
        }),
    staleTime: 30_000,
  });

  return {
    colors: query.data ?? STATIC_FALLBACK,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
