#!/usr/bin/env python3
from pathlib import Path


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    source = Path(path).read_text()
    for old, new in replacements:
        if new in source:
            continue
        if old not in source:
            raise RuntimeError(f"Missing cleanup target in {path}: {old[:100]}")
        source = source.replace(old, new, 1)
    Path(path).write_text(source)


patch(
    "server/routes/vouchers/voucherQueryRoutes.ts",
    [
        ('import { getErrorMessage } from "../../lib/httpHandlers";\n', ""),
        (
            "const companyMap = new Map(companyRows.filter(Boolean).map((company) => [company!.id, company!]));",
            "const companyMap = new Map(companyRows.filter(Boolean).map((company) => [company!.id, company!] as const));",
        ),
        (
            "companyRows.filter(Boolean).map((company) => [company!.id, company!.name]),",
            "companyRows.filter(Boolean).map((company) => [company!.id, company!.name] as const),",
        ),
    ],
)

patch(
    "server/routes/offloadRoutes.ts",
    [
        (
            '''            or(
              like(vouchers.voucherNumber, `DUTY-${cn}-%`),
            like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
            like(vouchers.voucherNumber, `TRANS-${cn}-%`),
            like(vouchers.voucherNumber, `XFER-${cn}-%`),
              like(vouchers.voucherNumber, `CHG-${cn}-%`)
            ),''',
            '''            or(
              like(vouchers.voucherNumber, `DUTY-${cn}-%`),
              like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
              like(vouchers.voucherNumber, `TRANS-${cn}-%`),
              like(vouchers.voucherNumber, `XFER-${cn}-%`),
              like(vouchers.voucherNumber, `CHG-${cn}-%`),
            ),''',
        ),
        (
            '''                or(
                  like(vouchers.voucherNumber, `DUTY-${cn}-%`),
                like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
                like(vouchers.voucherNumber, `TRANS-${cn}-%`),
                like(vouchers.voucherNumber, `XFER-${cn}-%`),
                  like(vouchers.voucherNumber, `CHG-${cn}-%`)
                ),''',
            '''                or(
                  like(vouchers.voucherNumber, `DUTY-${cn}-%`),
                  like(vouchers.voucherNumber, `OFFICE-${cn}-%`),
                  like(vouchers.voucherNumber, `TRANS-${cn}-%`),
                  like(vouchers.voucherNumber, `XFER-${cn}-%`),
                  like(vouchers.voucherNumber, `CHG-${cn}-%`),
                ),''',
        ),
    ],
)

patch(
    "client/src/pages/git-containers/usePaginatedGITContainers.ts",
    [
        (
            '''  const loadContainerDetail = async (id: number): Promise<EnrichedContainerRow> => {
    const detailUrl = canonicalApiUrl(`/api/git/containers/${id}`);''',
            '''  const loadContainerDetail = async (id: number, companyId: number): Promise<EnrichedContainerRow> => {
    const detailUrl = canonicalApiUrl(`/api/git/containers/${id}`, { companyId });''',
        ),
    ],
)

patch(
    "client/src/pages/GITContainers.tsx",
    [
        ("const detail = await loadContainerDetail(c.id);", "const detail = await loadContainerDetail(c.id, c.companyId);"),
    ],
)

patch(
    "scripts/verify-phase8-frontend-data-architecture.mjs",
    [
        (
            '''  "companyIdentity",
  "frontendQueryPolicies.operational",''',
            '''  "companyIdentity",
  "loadContainerDetail = async (id: number, companyId: number)",
  "frontendQueryPolicies.operational",''',
        ),
    ],
)

print("Final Phase 7-8 source cleanup applied.")
