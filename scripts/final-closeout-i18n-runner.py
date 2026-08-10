import ast
import pathlib
import re
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
script_path = root / "scripts/final-closeout-i18n-once.py"
tree = ast.parse(script_path.read_text(encoding="utf-8"))
translations = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "translations" for t in node.targets):
        translations = ast.literal_eval(node.value)
        break
if not translations:
    raise SystemExit("Could not load final closeout translation targets")

files = [
    root / "client/src/pages/location-inventory/LocationWhatsappScheduleDialog.tsx",
    root / "client/src/pages/location-inventory/LocationWhatsappDeliveryHistoryDialog.tsx",
    root / "client/src/pages/location-inventory/LocationDialogs.tsx",
    root / "client/src/pages/location-inventory/LocationInventoryHeader.tsx",
    root / "client/src/pages/CustomerInvoiceCreate.tsx",
]
files.extend(sorted((root / "client/src/pages/sp").rglob("*.tsx")))

for path in files:
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = False
    for index, line in enumerate(lines):
        for text in translations:
            patterns = [
                re.compile(r"(?P<prefix><[A-Z][A-Za-z0-9]*\b[^>\n]*/>)\s+" + re.escape(text) + r"(?P<tail>\s*)$"),
                re.compile(r"(?P<prefix>.*>)\s+" + re.escape(text) + r"(?P<tail>\s*)$"),
            ]
            match = next((pattern.search(line) for pattern in patterns if pattern.search(line)), None)
            if not match:
                continue
            lines[index] = line[: match.start()] + match.group("prefix") + f"<span>{text}</span>" + match.group("tail")
            changed = True
            break
    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

subprocess.run(["python", "scripts/final-closeout-i18n-once.py"], cwd=root, check=True)
