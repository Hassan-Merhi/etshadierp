import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Read a route module as one string, whether it is still a single file or has
 * been split into a directory of registrars.
 *
 * The audit-coverage tests assert on source text, so they used to break the
 * moment a route file was split - the path stopped existing and the assertion
 * failed for a reason that had nothing to do with auditing. Resolving a module
 * to "the file, or every .ts under the directory" keeps those assertions about
 * audit wiring rather than about file layout.
 */
export function moduleSource(modulePath: string): string {
  const absolute = resolve(process.cwd(), modulePath);
  const stats = statSync(absolute);
  if (!stats.isDirectory()) return readFileSync(absolute, "utf8");

  const parts: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(modulePath, entry.name);
    if (entry.isDirectory()) parts.push(moduleSource(child));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) parts.push(moduleSource(child));
  }
  return parts.join("\n");
}

/** True when the module both references logAudit and awaits at least one call. */
export function hasAwaitedAuditWrite(modulePath: string): boolean {
  const contents = moduleSource(modulePath);
  return /\blogAudit\b/.test(contents) && /await\s+logAudit\s*\(/.test(contents);
}
