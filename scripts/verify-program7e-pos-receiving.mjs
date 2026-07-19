#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFile(path.join(ROOT, file), "utf8");

const primitive = await read("client/src/components/pos/pos-screen.tsx");
const shell = await read("client/src/app/PosShell.tsx");
const failures = [];

for (const token of [
  "PosScreen",
  "PosScreenHeader",
  "PosMetricCard",
  "PosMetricGrid",
  "PosTableShell",
  "HorizontalScrollRegion",
  "ResponsiveActions",
  "ResponsiveToolbar",
  "tabular-nums",
  "grid-cols-1",
  "sm:grid-cols-2",
]) {
  if (!primitive.includes(token)) failures.push(`POS primitive contract missing: ${token}`);
}

for (const token of [
  "SkipLink",
  'id="main-content"',
  'aria-label="Point of sale workspace"',
  'aria-current={item.active ? "page" : undefined}',
  'aria-label="Go back"',
  'aria-label="Log out"',
  'aria-label="Open command search"',
  'aria-hidden="true"',
  "LoadingState",
  "overflow-x-hidden",
  "overscroll-contain",
  "min-w-0",
]) {
  if (!shell.includes(token)) failures.push(`POS shell contract missing: ${token}`);
}

for (const forbidden of ["/api/", "useMutation(", "useQuery(", "queryClient", "stockQuantity", "saleTotal", "costPrice"]) {
  if (primitive.includes(forbidden)) failures.push(`POS presentation primitive contains business logic: ${forbidden}`);
}

if (failures.length) {
  console.error("Program 7E POS and receiving verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({ phase: "7E", status: "ok", protectedContracts: 23 }, null, 2));
