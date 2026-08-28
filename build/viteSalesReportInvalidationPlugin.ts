import type { Plugin } from "vite";

const ORPHANED_RECORDS_SUFFIX = "/client/src/pages/OrphanedRecords.tsx";
const DATA_TOOLS_SUFFIX = "/client/src/pages/settings/datatoolstab/useDataToolsModel.ts";

const LEGACY_INVALIDATION = `queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });`;
const BANDWIDTH_SAFE_INVALIDATION = `queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.startsWith("/api/sales-report") || key.startsWith("/api/dashboard/sales-report"))
          );
        },
        refetchType: "active",
      });`;

function replaceExpected(
  source: string,
  before: string,
  after: string,
  expectedCount: number,
  label: string
): string {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `[sales-report-invalidation] Expected ${expectedCount} transform target(s) for ${label}, found ${count}`
    );
  }
  return source.split(before).join(after);
}

export function salesReportInvalidationPlugin(): Plugin {
  return {
    name: "erp-sales-report-invalidation",
    enforce: "pre",
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (normalizedId.endsWith(ORPHANED_RECORDS_SUFFIX)) {
        return {
          code: replaceExpected(
            source,
            LEGACY_INVALIDATION,
            BANDWIDTH_SAFE_INVALIDATION,
            2,
            "Orphaned Records sales-report invalidation"
          ),
          map: null,
        };
      }
      if (normalizedId.endsWith(DATA_TOOLS_SUFFIX)) {
        return {
          code: replaceExpected(
            source,
            LEGACY_INVALIDATION,
            BANDWIDTH_SAFE_INVALIDATION,
            1,
            "Data Tools sales-report invalidation"
          ),
          map: null,
        };
      }
      return null;
    },
  };
}
