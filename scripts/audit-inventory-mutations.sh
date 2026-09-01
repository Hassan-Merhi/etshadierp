#!/bin/bash
# Audit script: Ensures all inventory mutations go through adjustInventory helper
# Run this in CI or as a pre-commit hook to prevent regressions

set -e

ROUTES_FILE="server/routes.ts"
HELPER_FILE="server/inventoryHelper.ts"
ALLOWED_FILE="server/routes.ts" # Line 15547 is the only allowed exception (negative inventory cleanup)

echo "Auditing direct inventory mutations..."

# Find all .insert(inventory) and .update(inventory) calls in routes.ts
MUTATIONS=$(grep -n '\.insert(inventory)\|\.update(inventory)' "$ROUTES_FILE" 2>/dev/null || true)

# Known exceptions (data cleanup that sets inventory to zero - not a delta operation)
ALLOWED_LINES="15547"

VIOLATIONS=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  LINE_NUM=$(echo "$line" | cut -d: -f1)
  
  # Check if this line is in the allowed exceptions
  ALLOWED=false
  for allowed_line in $ALLOWED_LINES; do
    if [ "$LINE_NUM" = "$allowed_line" ]; then
      ALLOWED=true
      break
    fi
  done
  
  if [ "$ALLOWED" = false ]; then
    VIOLATIONS="$VIOLATIONS\n  $line"
  fi
done <<< "$MUTATIONS"

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Found direct inventory mutations outside adjustInventory helper!"
  echo "All inventory mutations must use adjustInventory() from server/inventoryHelper.ts"
  echo ""
  echo "Violations found:"
  echo -e "$VIOLATIONS"
  echo ""
  echo "Fix: Replace .insert(inventory) / .update(inventory) with:"
  echo "  await adjustInventory(tx, locationId, stockItemId, deltaQty, companyId, incomingRate?)"
  exit 1
fi

echo "PASS: All inventory mutations go through adjustInventory helper"
echo "  Exception: Line(s) $ALLOWED_LINES (data cleanup endpoint - intentionally direct)"
exit 0
