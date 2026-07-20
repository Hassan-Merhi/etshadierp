branches=(
  "audit/finalize-daybook-activity"
  "fix/historical-replay-phase-1-executor"

  "quality/program-19-security-hardening"
  "quality/program-18-deployment-reliability"
  "quality/program-17-ui-consistency"
  "quality/program-16-backend-architecture"
  "quality/program-15-database-optimization"
  "quality/program-14-frontend-architecture"
  "quality/program-13-finalization"
  "quality/phases-1-2"

  "ui/usability-100-rollout"
  "hotfix/sales-report-analytics-runtime"
  "integration/programs-1-to-6-validation"

  "agent/program-1-deployment-reliability"
  "agent/memory-phase-1-stabilization"
  "agent/fix-tracking-startup-resilience"
  "agent/reapply-factory-request-log-fixes"
  "agent/temporarily-revert-pr-67"
  "agent/fix-remaining-bandwidth-bursts"

  "agent/phase-7a-performance-baseline"
  "agent/phase-7b-common-inventory-performance"
  "agent/phase-7c-read-performance"

  "agent/phase-8a-audit-framework"
  "agent/phase-8b-voucher-pos-auditing"
  "agent/phase-8c-inventory-transfer-container-auditing"
  "agent/phase-8d-payroll-accounts-users-roles-migration-auditing"

  "agent/phase-5a-health-metrics-v2"
  "agent/phase-5b-event-detection"
  "agent/phase-5c-external-alerting-checklist"

  "agent/phase-9a-ci-coverage-format"
  "agent/phase-9b-security-scanning"
  "agent/phase-9c-branch-protection-guidance"

  "agent/stock-items-bandwidth-light-callers"
  "agent/inventory-integrity-hardening"
  "agent/startup-migration-hardening"
  "agent/inventory-test-hardening"
  "agent/logging-observability-hardening"

  "agent/phase-5a-health-metrics"

  "agent/combo-4g-validation-v2"
  "agent/combo-4g-validation"
  "agent/combo-4f-validation"
  "agent/combo-4e-validation-v1"

  "agent/combo-4d-validation-v6"
  "agent/combo-4d-validation-v5"
  "agent/combo-4d-validation-v4"
  "agent/combo-4d-validation-v3"
  "agent/combo-4d-validation-v2"

  "agent/combo-4c-container-freight-typescript-v2"
  "agent/combo-4b-baseline-669695d"
  "agent/combo-4a-final-validation"
)

deleted=0
missing=0
failed=0

for branch in "${branches[@]}"; do
  if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    echo "Deleting: $branch"

    if git push origin --delete "$branch"; then
      deleted=$((deleted + 1))
    else
      echo "FAILED: $branch"
      failed=$((failed + 1))
    fi
  else
    echo "Already missing: $branch"
    missing=$((missing + 1))
  fi
done

git fetch --prune origin

echo
echo "Cleanup complete"
echo "Deleted: $deleted"
echo "Already missing: $missing"
echo "Failed: $failed"