/**
 * Startup schema migrations.
 *
 * The idempotent `CREATE TABLE / ALTER TABLE / DO $$ ... $$` statements run once
 * at server boot to bring a database up to the runtime-authoritative schema.
 * `runMigrations()` in server/index.ts iterates this array in order.
 *
 * The statements are grouped into the modules below purely to keep any one file
 * readable. Concatenation order here IS the execution order and must match the
 * original single-array file exactly - tests/startup-schema-integrity.test.ts
 * pins the statement count and a hash of the assembled array to prove it.
 */
import { coreTablesAndColumns } from "./001-core-tables-and-columns";
import { factoryContainerColumns } from "./002-factory-container-columns";
import { rentalAndProductionPlanner } from "./003-rental-and-production-planner";
import { postDeployTables } from "./004-post-deploy-tables";
import { tenantAndPerformanceIndexes } from "./005-tenant-and-performance-indexes";
import { primaryAndForeignKeys } from "./006-primary-and-foreign-keys";
import { schemaCatchupMay2026 } from "./007-schema-catchup-may-2026";
import { posExportsAndDispatch } from "./008-pos-exports-and-dispatch";
import { supplierPartnerAndAi } from "./009-supplier-partner-and-ai";
import { securityNotificationsAndPrecision } from "./010-security-notifications-and-precision";
import { stockTransferRevisionIntegrity } from "./011-stock-transfer-revision-integrity";
import { productionPositions } from "./012-production-positions";
import { baleProductionAttribution } from "./013-bale-production-attribution";
import { productionPositionPlanner } from "./014-production-position-planner";
import { productionBonusPayroll } from "./015-production-bonus-payroll";
import { stockMergeAuditUserId } from "./016-stock-merge-audit-user-id";

export const startupMigrations: string[] = [
  ...coreTablesAndColumns,
  ...factoryContainerColumns,
  ...rentalAndProductionPlanner,
  ...postDeployTables,
  ...tenantAndPerformanceIndexes,
  ...primaryAndForeignKeys,
  ...schemaCatchupMay2026,
  ...posExportsAndDispatch,
  ...supplierPartnerAndAi,
  ...securityNotificationsAndPrecision,
  ...stockTransferRevisionIntegrity,
  ...productionPositions,
  ...baleProductionAttribution,
  ...productionPositionPlanner,
  ...productionBonusPayroll,
  ...stockMergeAuditUserId,
];
