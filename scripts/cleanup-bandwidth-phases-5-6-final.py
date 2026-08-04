#!/usr/bin/env python3
from pathlib import Path


def remove(path: str, snippets: list[str]) -> None:
    source = Path(path).read_text()
    for snippet in snippets:
        source = source.replace(snippet, "")
    Path(path).write_text(source)


def replace(path: str, old: str, new: str) -> None:
    source = Path(path).read_text()
    if old in source:
        source = source.replace(old, new, 1)
    elif new not in source:
        raise RuntimeError(f"Missing replacement target in {path}")
    Path(path).write_text(source)


remove(
    "client/src/pages/git-containers/ContainerDrawer.tsx",
    [
        "  queryKey,\n",
        "  queryKey: string;\n",
        "  const [lastId, setLastId] = useState<number | null>(null);\n",
        "      setLastId(container.id);\n",
    ],
)

remove(
    "client/src/pages/git-containers/useGITContainersData.ts",
    [
        "  allCompanies: boolean;\n",
        "  queryUrl: string;\n",
        "  allCompanies,\n",
        "  queryUrl,\n",
    ],
)
replace(
    "client/src/pages/git-containers/useGITContainersData.ts",
    "  }, [isBulkPending, showProgressBanner, isAllowed, queryUrl, queryClient]);",
    "  }, [isBulkPending, showProgressBanner, isAllowed, queryClient]);",
)

remove(
    "client/src/pages/GITContainers.tsx",
    [
        "    allCompanies,\n    queryUrl,\n",
        "        queryKey={queryUrl}\n",
    ],
)
replace(
    "client/src/pages/GITContainers.tsx",
    "  const { data, isLoading, isError, error, refetch, queryUrl, loadContainerDetail } =\n",
    "  const { data, isLoading, isError, error, refetch, loadContainerDetail } =\n",
)
replace(
    "client/src/pages/GITContainers.tsx",
    "            allContainersCount={allContainers.length}\n",
    "            allContainersCount={data?.total ?? allContainers.length}\n",
)

print("Final Phase 5-6 prop cleanup applied.")
