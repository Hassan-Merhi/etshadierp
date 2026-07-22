#!/usr/bin/env bash
# Deletes 33 stale branches from Hassan-Merhi/etshadierp.
# 20 are already MERGED into main (zero risk); 13 are abandoned/scratch/backup.
# All 29 branches with OPEN pull requests are intentionally left untouched.
set -euo pipefail

BRANCHES=(
  # --- Tier A: merged into main (safe) ---
  agent/combo-4a-safe-typescript-ui-reports
  agent/combo-4b-payroll-nonstock-typescript-v3
  agent/combo-4c-container-freight-typescript
  agent/combo-4d-stock-pos-vouchers-typescript
  agent/combo-4e-accounting-reports-typescript
  agent/combo-4f-fiscal-sp-typescript
  agent/combo-4g-final-data-model-typescript
  agent/fix-container-access-offline-scan-replay
  agent/fix-factory-request-log-bursts
  agent/fix-pos-location-pool-crash
  agent/program-2-accounting-inventory-integrity
  combo-1-ci-safe-types
  combo-2-logging-skipped-tests
  combo-3-frontend-tests-coverage
  fix/aikido-security-update-packages-41113995-tubz
  fix/complete-multi-currency
  fix/daybook-activity-company-isolation
  fix/factory-landed-cost-reconciliation
  fix/historical-replay-v7-completion
  fix/render-critical-security-schema
  # --- Tier B: abandoned / scratch / backup (no merged PR) ---
  agent/combo-4b-payroll-accounting-reports
  agent/combo-4b-payroll-nonstock-typescript
  agent/combo-4b-payroll-nonstock-typescript-v2
  agent/combo-4f-fiscal-transfer-typescript
  backup/combo-1-before-sync-89cf3e1e
  backup/combo-1-before-sync-ba639466
  agent/program6b-parent-group-selector
  agent/program6e-proforma-drawer-refetch-policy
  fix/historical-replay-phase-3-fingerprint
  quality/program-13-types
  quality/program-13-types-2
  temp/program6b-finish
  work
)

# Delete all in one push:
git push origin --delete "${BRANCHES[@]}"

# --- OR, if you prefer the gh CLI, run this instead of the line above: ---
# for b in "${BRANCHES[@]}"; do gh api -X DELETE "repos/Hassan-Merhi/etshadierp/git/refs/heads/$b" && echo "deleted $b"; done
