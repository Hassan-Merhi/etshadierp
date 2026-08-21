#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, text) => fs.writeFileSync(path.join(root, rel), text.endsWith("\n") ? text : `${text}\n`);

const families = [
  {
    dir: "client/src/pages/factory/factoryinvoicedetail",
    oldPrefix: "./factoryinvoicedetail/",
  },
  {
    dir: "client/src/pages/factory/baleshistory",
    oldPrefix: "./baleshistory/",
  },
  {
    dir: "client/src/pages/factory/factorypendinginvoiceverify",
    oldPrefix: "./factorypendinginvoiceverify/",
  },
];

for (const family of families) {
  const base = path.join(root, family.dir);
  if (!fs.existsSync(base)) continue;
  const visit = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
      const rel = path.relative(root, child).split(path.sep).join("/");
      let text = read(rel);
      const depth = path.relative(base, path.dirname(child)).split(path.sep).filter((part) => part && part !== ".").length;
      const replacement = depth === 0 ? "./" : `${"../".repeat(depth)}`;
      const needle = `\"${family.oldPrefix}`;
      const next = text.split(needle).join(`\"${replacement}`);
      if (next !== text) {
        write(rel, next);
        console.log(`WAVE5_IMPORT_REPAIR ${rel}: ${family.oldPrefix} -> ${replacement}`);
      }
    }
  };
  visit(base);
}

// One Pending Verify dialog uses render-local proforma presentation variables.
// Keep that dialog in the parent instead of widening the extracted component's
// API or moving those derived values into the model layer.
const parentRel = "client/src/pages/factory/FactoryPendingInvoiceVerify.tsx";
const componentsRel = "client/src/pages/factory/factorypendinginvoiceverify/components";
const componentsAbs = path.join(root, componentsRel);
if (fs.existsSync(componentsAbs)) {
  for (const entry of fs.readdirSync(componentsAbs)) {
    if (!/^FactoryPendingInvoiceVerifyDialog\d+\.tsx$/.test(entry)) continue;
    const rel = `${componentsRel}/${entry}`;
    const component = read(rel);
    if (!/\b(activeProformaName|activeProformaId|proformaLines)\b/.test(component)) continue;

    const componentName = entry.replace(/\.tsx$/, "");
    const match = component.match(/\n  return \(\n([\s\S]*?)\n  \);\n}\s*$/);
    if (!match) throw new Error(`Could not recover JSX from ${rel}`);
    const jsx = match[1]
      .split("\n")
      .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n");

    let parent = read(parentRel);
    const importPattern = new RegExp(`^import \\{ ${componentName} \\} from \\"[^\\"]+\\";\\n?`, "m");
    parent = parent.replace(importPattern, "");
    const callPattern = new RegExp(`<${componentName}\\s+model=\\{model\\}\\s*/>`);
    if (!callPattern.test(parent)) throw new Error(`Could not find ${componentName} call in ${parentRel}`);
    parent = parent.replace(callPattern, jsx);
    write(parentRel, parent);
    fs.unlinkSync(path.join(root, rel));
    console.log(`WAVE5_INLINE_LOCAL_DIALOG ${componentName}`);
  }
}
