from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"Expected source not found in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def ensure_import(path: str, line: str) -> None:
    text = read(path)
    if line not in text:
        write(path, line + "\n" + text)


# Remove repeated Phase 3 helper imports left by superseded codemod runs.
for path in [
    "server/routes/payroll/_payrollAccountingHelper.ts",
    "server/services/containers/offload-lifecycle/charge-vouchers.ts",
    "server/services/containers/offload-lifecycle/sp-journals.ts",
    "server/services/factory/post-offload-charge/apply.ts",
    "server/services/pos/createSaleVoucher.ts",
    "server/services/rental/rentalPaymentPostingService.ts",
    "server/storage/accounting/fiscal-periods.ts",
    "server/storage/accounting/vouchers.ts",
    "server/storage/containers-store/offload.ts",
    "server/storage/containers-store/purchase-orders.ts",
]:
    text = read(path)
    pattern = re.compile(
        r'(import\s+\{.*?\}\s+from\s+"[^"\n]*infrastructureVoucherIdentity";\n)(?:\1)+',
        re.S,
    )
    text = pattern.sub(r'\1', text)
    write(path, text)

# Generic storage writer must receive identity from its caller; it may not use
# a freshly generated voucher number as an implicit idempotency key.
path = "server/storage/accounting/vouchers.ts"
text = read(path)
text = text.replace(
    'import {\n  infrastructurePostingIdentity,\n  insertInfrastructureVoucher,\n} from "../../services/accounting/infrastructureVoucherIdentity";',
    'import { insertInfrastructureVoucher } from "../../services/accounting/infrastructureVoucherIdentity";',
    1,
)
if 'import type { PostingSourceIdentity } from "../../services/accounting/centralPostingEngine";' not in text:
    text = 'import type { PostingSourceIdentity } from "../../services/accounting/centralPostingEngine";\n' + text
old = '''export async function createVoucher(voucher: InsertVoucher): Promise<Voucher> {
  const { voucher: created } = await insertInfrastructureVoucher(
    db,
    voucher,
    infrastructurePostingIdentity("storage-voucher", `${voucher.companyId}:${voucher.voucherNumber}`, "create"),
    voucher
  );
  return created;
}'''
new = '''export async function createVoucher(
  voucher: InsertVoucher & { postingSource: PostingSourceIdentity }
): Promise<Voucher> {
  const { postingSource, ...voucherFields } = voucher;
  const { voucher: created } = await insertInfrastructureVoucher(db, voucherFields, postingSource, voucherFields);
  return created;
}'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit("createVoucher storage writer shape changed unexpectedly")
write(path, text)

helper_import = 'import { infrastructurePostingIdentity } from "../../services/accounting/infrastructureVoucherIdentity";'

# PO backfill: persisted PO id is the stable source document.
path = "server/routes/containers/poImportBackfillRoute.ts"
ensure_import(path, helper_import)
replace_once(
    path,
    '          companyId: req.session.currentCompanyId!,\n          currency: "USD",',
    '          companyId: req.session.currentCompanyId!,\n          postingSource: infrastructurePostingIdentity(\n            "po-import-backfill",\n            `${req.session.currentCompanyId!}:${po.id}`,\n            "purchase"\n          ),\n          currency: "USD",',
)

# Manual container voucher: container row already exists and has a stable id.
path = "server/routes/containers/containerCrudRoutes.ts"
ensure_import(path, helper_import)
replace_once(
    path,
    '            companyId: req.session.currentCompanyId,\n            currency: "USD",',
    '            companyId: req.session.currentCompanyId,\n            postingSource: infrastructurePostingIdentity(\n              "manual-container",\n              `${req.session.currentCompanyId}:${container.id}`,\n              "purchase"\n            ),\n            currency: "USD",',
)

# Waste dispatch number is the business document identifier for this posting.
path = "server/routes/stockAdjustmentWasteRoutes.ts"
ensure_import(path, 'import { infrastructurePostingIdentity } from "../services/accounting/infrastructureVoucherIdentity";')
replace_once(
    path,
    '        companyId,\n        voucherType: "Consumption",',
    '        companyId,\n        postingSource: infrastructurePostingIdentity("waste-dispatch", `${companyId}:${dispatchNumber}`, "consumption"),\n        voucherType: "Consumption",',
)

# PO import has subsidiary and parent postings for the same stable PO number.
path = "server/routes/import/po-import.ts"
ensure_import(path, helper_import)
replace_once(
    path,
    '          companyId: req.session.currentCompanyId!,\n          currency: "USD",',
    '          companyId: req.session.currentCompanyId!,\n          postingSource: infrastructurePostingIdentity(\n            "po-import",\n            `${req.session.currentCompanyId!}:${poNumber}`,\n            "purchase"\n          ),\n          currency: "USD",',
)
replace_once(
    path,
    '              companyId: parentCompanyId,\n              currency: "USD",',
    '              companyId: parentCompanyId,\n              postingSource: infrastructurePostingIdentity(\n                "po-import",\n                `${parentCompanyId}:${poNumber}`,\n                "parent-intercompany"\n              ),\n              currency: "USD",',
)

# Manual voucher route receives voucherNumber in the request body. Passing it as
# the source is explicit at the route boundary; Phase 4 will replace this with a
# client request id for the full operational route.
path = "server/routes/vouchers/voucherCreateRoutes.ts"
ensure_import(path, helper_import)
replace_once(
    path,
    '      const voucher = await storage.createVoucher({ ...req.body, exchangeRate });',
    '''      const voucher = await storage.createVoucher({
        ...req.body,
        exchangeRate,
        postingSource: infrastructurePostingIdentity(
          "manual-voucher",
          `${companyId ?? req.body.companyId}:${req.body.voucherNumber}`,
          "create"
        ),
      });''',
)
