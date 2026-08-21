from pathlib import Path
import json

# SalesReportLegacy still owns two non-keyboard effects.
path = Path("client/src/pages/SalesReportLegacy.tsx")
text = path.read_text()
text = text.replace('import { useState, useMemo } from "react";', 'import { useState, useMemo, useEffect } from "react";', 1)
path.write_text(text)

# WasteDispatch still owns another ref and a print button outside the extracted dialogs.
path = Path("client/src/pages/factory/WasteDispatch.tsx")
text = path.read_text()
text = text.replace('import { useState, useMemo } from "react";', 'import { useState, useRef, useMemo } from "react";', 1)
if '  Printer,\n' not in text:
    text = text.replace('  Trash2,\n', '  Trash2,\n  Printer,\n', 1)
path.write_text(text)

# The Wave 3 split reduced WasteDispatch from 10 explicit-any escapes to 9.
config_path = Path("config/type-escape-boundaries.json")
config = json.loads(config_path.read_text())
entry = config["scan"]["baseline"].get("client/src/pages/factory/WasteDispatch.tsx")
if entry != [10, 0, 0] and entry != [9, 0, 0]:
    raise RuntimeError(f"Unexpected WasteDispatch type-escape baseline: {entry}")
config["scan"]["baseline"]["client/src/pages/factory/WasteDispatch.tsx"] = [9, 0, 0]
config["totals"]["typeEscapeCeiling"] = 3229
config_path.write_text(json.dumps(config, indent=2) + "\n")

# Keep the bound current-reference figure synchronized with the falling ceiling.
doc_path = Path("docs/system-quality-program.md")
doc = doc_path.read_text()
doc = doc.replace("| Type escapes (AST) | 3,230 total |", "| Type escapes (AST) | 3,229 total |", 1)
doc_path.write_text(doc)
