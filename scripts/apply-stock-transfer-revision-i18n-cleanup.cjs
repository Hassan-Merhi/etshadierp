const fs = require("fs");
const path = "client/src/pages/vouchers/StockTransferForm.tsx";
let source = fs.readFileSync(path, "utf8");
const replacements = [
  [
    `      toast({ title: "Error", description: "Stock transfer is not ready yet. Please reopen it and try again.", variant: "destructive" });`,
    `      toast({ title: "Error", description: "Failed to save revision", variant: "destructive" });`,
  ],
  [
    `      toast({\n        title: transferUpdated ? "Revision history was not saved" : "Transfer was not updated",\n        description: transferUpdated\n          ? \`The transfer update succeeded, but the revision record failed: \${error.message || "Unknown error"}. Keep this dialog open and try Save as Revision again.\`\n          : error.message || "Failed to save revision",\n        variant: "destructive",\n      });`,
    `      toast({\n        title: "Error",\n        description: error.message || "Failed to save revision",\n        variant: "destructive",\n      });`,
  ],
];
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error("Expected cleanup block not found");
  source = source.replace(before, after);
}
fs.writeFileSync(path, source);
console.log("Applied revision i18n cleanup");
