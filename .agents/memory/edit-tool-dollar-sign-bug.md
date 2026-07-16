---
name: Edit tool dollar-sign handling bug
description: The Edit/Write tools process dollar-sign sequences in new_string specially — $$ becomes $, and $label$ at the end of a line before a backtick can catastrophically corrupt the file (duplicating the whole file content into the string literal). Workarounds documented here.
---

## The bug

The Edit tool's `new_string` parameter has two failure modes with PostgreSQL dollar-quoting inside JS template literals:

1. **`$$` (anonymous) → stripped to `$`**: The tool strips one dollar sign from any `$$` sequence in the new string. `DO $$ BEGIN...END $$` arrives in the file as `DO $ BEGIN...END $`, which is a PG syntax error.

2. **Named `$label$` at end-of-line before the JS closing backtick → catastrophic corruption**: `END $mbsrc_prec$` followed immediately by `` ` `` (the JS template literal terminator) causes the Edit tool to treat the rest of the file as content of the SQL string, duplicating/corrupting the file. The file can expand from 5 000 lines to 19 000+ lines.

## Workarounds

### For simple ALTER TABLE migrations (idempotent type widening)
Don't use DO blocks at all. `ALTER TABLE t ALTER COLUMN c TYPE NUMERIC(20,7)` is a no-op in PostgreSQL when the column is already NUMERIC(20,7), so plain statements are safe:
```javascript
`ALTER TABLE factory_mix_batch_sources ALTER COLUMN cost_per_kg TYPE NUMERIC(20,7)`,
```

### For conditional DO blocks (must survive named dollar-quoting)
Use labeled dollar-quoting **but always put a semicolon after the closing label** before the JS string terminator:
```javascript
`DO $myblock$ BEGIN ... END $myblock$; `,  // note: semicolon + space before closing backtick
```
The key: never let `$label$` be the very last characters before the closing backtick `` ` ``.

### For existing code that uses $$ (e.g. in WriteFile)
WriteFile appears to handle `$$` correctly. The stripping only affects the Edit tool's `new_string`. Use WriteFile for any content with `$$`.

**Why:** The Edit tool appears to have a special `$` processing step in its string replacement logic that treats `$$` as an escape sequence or variable interpolation marker.
