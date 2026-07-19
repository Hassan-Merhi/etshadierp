#!/usr/bin/env node
import fs from "node:fs";

const path = "client/src/components/ui/responsive-accessibility.tsx";
const source = fs.readFileSync(path, "utf8");
const required = [
  "SkipLink",
  "ResponsiveActions",
  "ResponsiveGrid",
  "AccessibleRegion",
  "HorizontalScrollRegion",
  "focus-visible:ring-2",
  "aria-label",
  'role="region"',
  "overflow-x-auto",
  "sm:flex-row",
  "auto-fit",
  "minmax",
];
const missing = required.filter((token) => !source.includes(token));
if (missing.length) {
  console.error(`Program 7D verification failed. Missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Program 7D accessibility and responsive contract verified.");
