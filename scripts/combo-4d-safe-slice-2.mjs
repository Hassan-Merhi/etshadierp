import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, source) {
  fs.writeFileSync(path, source);
}

function replaceOnceOrVerify(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count === 1) return source.replace(oldText, newText);
  if (count === 0 && source.includes(newText)) return source;
  throw new Error(`${label}: expected one source match or an already-applied replacement, found ${count}`);
}

const helpersPath = "server/routes/factory/_helpers.ts";
let helpers = read(helpersPath);
helpers = replaceOnceOrVerify(
  helpers,
  "    const affectedBatchIds = [...new Set(mixSources.map((s: any) => s.mixBatchId as number))];",
  "    const affectedBatchIds = Array.from(new Set<number>(mixSources.map((s) => s.mixBatchId)));",
  "factory helper affected batch IDs"
);
write(helpersPath, helpers);

const balesPath = "server/routes/factory/factoryBalesRoutes.ts";
let bales = read(balesPath);
bales = replaceOnceOrVerify(
  bales,
  "          const productByName = new Map(allProducts.map((p: any) => [p.name.toLowerCase(), p]));\n          const productByArticle = new Map(allProducts.map((p: any) => [p.articleCode?.toLowerCase(), p]));",
  "          type ImportedBaleProduct = (typeof allProducts)[number];\n          const productByName = new Map<string, ImportedBaleProduct>(\n            allProducts.map((p) => [p.name.toLowerCase(), p] as const)\n          );\n          const productByArticle = new Map<string | undefined, ImportedBaleProduct>(\n            allProducts.map((p) => [p.articleCode?.toLowerCase(), p] as const)\n          );",
  "factory bales product maps"
);
bales = replaceOnceOrVerify(
  bales,
  "          const categoryByName = new Map(allCategories.map((c: any) => [c.name?.toLowerCase(), c]));",
  "          type ImportedBaleCategory = (typeof allCategories)[number];\n          const categoryByName = new Map<string | undefined, ImportedBaleCategory>(\n            allCategories.map((c) => [c.name?.toLowerCase(), c] as const)\n          );",
  "factory bales category map"
);
bales = replaceOnceOrVerify(
  bales,
  "        .select({ maxRef: sql`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` })",
  "        .select({ maxRef: sql<number>`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` })",
  "factory bales max reference type"
);
bales = replaceOnceOrVerify(
  bales,
  "      let nextRef = Math.max((maxRef[0]?.maxRef || 0) + 1, 200000);",
  "      let nextRef = Math.max(Number(maxRef[0]?.maxRef ?? 0) + 1, 200000);",
  "factory bales next reference"
);
write(balesPath, bales);

const stockPath = "server/routes/factory/factoryStockRoutes.ts";
let stock = read(stockPath);
stock = replaceOnceOrVerify(
  stock,
  "        const productByName = new Map(allProducts.map((p: any) => [p.name.toLowerCase(), p]));",
  "        type ImportedStockProduct = (typeof allProducts)[number];\n        const productByName = new Map<string, ImportedStockProduct>(\n          allProducts.map((p) => [p.name.toLowerCase(), p] as const)\n        );",
  "factory stock product map"
);
write(stockPath, stock);

const v3Path = "server/routes/factory/factoryStockAllocationV3Routes.ts";
let v3 = read(v3Path);
v3 = replaceOnceOrVerify(
  v3,
  "      // Find the bale by referenceNumber, baleCode, articleCode (pick ONE bale — prefer IN_STOCK)\n      const balesFound = await db.execute(sql`",
  "      type ScannedBaleRow = {\n        id: number;\n        baleCode: string;\n        referenceNumber: string;\n        articleCode: string;\n        productName: string;\n        weightKg: string;\n        status: string;\n      };\n\n      // Find the bale by referenceNumber, baleCode, articleCode (pick ONE bale — prefer IN_STOCK)\n      const balesFound = await db.execute(sql`",
  "v3 scanned bale row type"
);
v3 = replaceOnceOrVerify(
  v3,
  "      let bale = (balesFound.rows)[0];",
  "      let bale = balesFound.rows[0] as ScannedBaleRow | undefined;",
  "v3 primary bale row"
);
v3 = replaceOnceOrVerify(
  v3,
  "        bale = (byArticle.rows)[0];",
  "        bale = byArticle.rows[0] as ScannedBaleRow | undefined;",
  "v3 article bale row"
);
write(v3Path, v3);

console.log("Combo 4D second safe slice applied or already present.");
