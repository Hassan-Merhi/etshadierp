import fs from "node:fs";

const path = "server/routes/fiscalTransferRoutes.ts";
let content = fs.readFileSync(path, "utf8");
const from = `        description: \`Waste dispatch from \${location.name}\`,
        totalAmount: "0",
        optional: false,
        locationId,
`;
const to = `        description: \`Waste dispatch from \${location.name}\`,
        totalAmount: "0",
        currency: "USD",
        sourceModule: "ERP",
        optional: false,
        locationId,
`;
const count = content.split(from).length - 1;
if (count !== 1) throw new Error(`Expected one waste-dispatch voucher block, found ${count}`);
content = content.replace(from, to);
fs.writeFileSync(path, content);
console.log("Applied final Combo 4G explicit voucher defaults.");
