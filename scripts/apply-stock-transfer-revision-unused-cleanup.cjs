const fs = require("fs");
const path = "client/src/pages/vouchers/StockTransferForm.tsx";
let source = fs.readFileSync(path, "utf8");
for (const value of ["    let transferUpdated = false;\n", "      transferUpdated = true;\n"]) {
  if (!source.includes(value)) throw new Error(`Expected block not found: ${value}`);
  source = source.replace(value, "");
}
fs.writeFileSync(path, source);
