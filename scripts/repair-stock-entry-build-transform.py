from pathlib import Path

path = Path("build/viteHeavyListPaginationPlugin.ts")
text = path.read_text()

obsolete = '''  code = replaceExactly(
    code,
    `  if (workerIdFilter !== "all") params.set("workerId", workerIdFilter);`,
    `  if (workerIdFilter !== "all") params.set("workerId", workerIdFilter);\\n  if (categoryFilter !== "all") params.set("workerCategoryId", categoryFilter);`,
    "stock-entry worker group server filter"
  );

'''
if text.count(obsolete) != 1:
    raise SystemExit(f"obsolete worker-group transform: expected 1 match, found {text.count(obsolete)}")
text = text.replace(obsolete, "", 1)

old_status = 'if (statusFilter !== "all") gp.set("status", statusFilter);'
new_status = 'if (statusFilter.length > 0) gp.set("status", statusFilter.join(","));'
count = text.count(old_status)
if count != 2:
    raise SystemExit(f"status transform: expected 2 matches, found {count}")
text = text.replace(old_status, new_status)

path.write_text(text)
print(f"updated {path}")
