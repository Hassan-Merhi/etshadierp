#!/usr/bin/env python3
from pathlib import Path


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    source = Path(path).read_text()
    for old, new in replacements:
        if new in source:
            continue
        if old not in source:
            raise RuntimeError(f"Missing patch target in {path}: {old[:80]}")
        source = source.replace(old, new, 1)
    Path(path).write_text(source)


patch(
    "server/routes/git/gitListingProfiles.ts",
    [
        (
            "  q?: string;\n}",
            '''  q?: string;
  status?: string;
  transporter?: string;
  agent?: string;
  location?: string;
  docsReady?: string;
  delayed?: string;
  overdue?: string;
}''',
        ),
        (
            '''  return rows.filter((row) => {
    if (query.company && query.company !== "ALL" && row.companyName !== query.company) return false;''',
            '''  return rows.filter((row) => {
    if (query.company && query.company !== "ALL" && row.companyName !== query.company) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.transporter && row.transporter !== query.transporter) return false;
    if (query.agent && row.agent !== query.agent) return false;
    if (query.location && row.trackingLocation !== query.location) return false;
    if (query.docsReady === "true" && !row.docsReadyNotSent) return false;
    if (query.delayed === "true" && !(row.daysDelayed && row.daysDelayed > 0)) return false;
    if (query.overdue === "true" && !row.isOverdue) return false;''',
        ),
    ],
)

patch(
    "client/src/pages/git-containers/ContainerDrawer.tsx",
    [
        ("  queryKey,\n", ""),
        ("  queryKey: string;\n", ""),
        ('  const [lastId, setLastId] = useState<number | null>(null);\n', ""),
        ("      setLastId(container.id);\n", ""),
    ],
)

patch(
    "client/src/pages/git-containers/useGITContainersData.ts",
    [
        ("  allCompanies: boolean;\n", ""),
        ("  queryUrl: string;\n", ""),
        ("  allCompanies,\n", ""),
        ("  queryUrl,\n", ""),
        (
            "  }, [isBulkPending, showProgressBanner, isAllowed, queryUrl, queryClient]);",
            "  }, [isBulkPending, showProgressBanner, isAllowed, queryClient]);",
        ),
    ],
)

patch(
    "client/src/pages/GITContainers.tsx",
    [
        (
            "  const { data, isLoading, isError, error, refetch, queryUrl, loadContainerDetail } =\n",
            "  const { data, isLoading, isError, error, refetch, loadContainerDetail } =\n",
        ),
        ("    allCompanies,\n    queryUrl,\n", ""),
        ('            allContainersCount={allContainers.length}\n', '            allContainersCount={data?.total ?? allContainers.length}\n'),
        ('        queryKey={queryUrl}\n', ""),
    ],
)

print("Phase 5-6 compatibility cleanup applied.")
