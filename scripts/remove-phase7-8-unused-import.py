#!/usr/bin/env python3
from pathlib import Path

path = Path("server/routes/vouchers/voucherQueryRoutes.ts")
source = path.read_text()
source = source.replace('import { getErrorMessage } from "../../lib/httpHandlers";\n', "")
source = source.replace(
    "// Get unified ledger for a supplier across all companies",
    "// Get unified ledger for a supplier across explicitly accessible companies",
)
path.write_text(source)
