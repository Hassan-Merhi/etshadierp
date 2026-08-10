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

for path in files:
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = False
    for index, line in enumerate(lines):
        for text in translations:
            pattern = re.compile(r"(?P<icon><[A-Z][A-Za-z0-9]*\b[^>\n]*/>)\s+" + re.escape(text) + r"(?P<tail>\s*)$")
            match = pattern.search(line)
            if not match:
                continue
            lines[index] = line[: match.start()] + match.group("icon") + f"<span>{text}</span>" + match.group("tail")
            changed = True
            break
    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

subprocess.run(["python", "scripts/final-closeout-i18n-once.py"], cwd=root, check=True)
