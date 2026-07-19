#!/usr/bin/env node
import fs from "node:fs";

const files = {
  responsive: "client/src/components/ui/responsive-accessibility.tsx",
  financial: "client/src/components/financial/financial-screen.tsx",
  operations: "client/src/components/operations/operations-screen.tsx",
};

const sources = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, fs.readFileSync(path, "utf8")]),
);

const failures = [];

for (const token of [
  "SkipLink",
  "ResponsiveActions",
  "ResponsiveToolbar",
  "ResponsiveGrid",
  "AccessibleRegion",
  "HorizontalScrollRegion",
  "focus-visible:ring-2",
  "focus:ring-offset-2",
  "aria-label",
  'role="region"',
  'role="search"',
  'role="group"',
  "overflow-x-auto",
  "sm:flex-row",
  "auto-fit",
  "minmax",
  "motion-reduce:transition-none",
]) {
  if (!sources.responsive.includes(token)) failures.push(`Responsive primitive contract missing: ${token}`);
}

for (const [name, source] of [
  ["financial", sources.financial],
  ["operations", sources.operations],
]) {
  for (const token of ["ResponsiveActions", "ResponsiveToolbar", "aria-labelledby", "React.useId()", "break-words"]) {
    if (!source.includes(token)) failures.push(`${name} page header contract missing: ${token}`);
  }
}

if (failures.length) {
  console.error("Program 7D accessibility and responsive verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 7D accessibility and responsive contracts verified.");
