import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
path = root / "client/src/pages/location-inventory/LocationDialogs.tsx"
source = path.read_text(encoding="utf-8")
old = '<MessageCircle className="h-5 w-5" /> Location WhatsApp Stock Reports'
new = '<MessageCircle className="h-5 w-5" /><span>Location WhatsApp Stock Reports</span>'
if old in source:
    source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")
subprocess.run(["python", "scripts/final-closeout-i18n-once.py"], cwd=root, check=True)
