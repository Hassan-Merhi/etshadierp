/**
 * Deterministic repairs for the two tenant-control integrity failures found
 * by tenant-control-integrity-audit.mjs.
 *
 * The lowest id is the stable keeper for duplicate role rows. Nullable
 * location/account settings are filled from the highest-id duplicate only
 * when the keeper is missing them; boolean capabilities are conservative
 * unions and daybook access keeps the greatest configured allowance. Rows in
 * user_locations without a matching company role are invalid authorization
 * metadata and are removed.
 */
export const tenantControlIntegrityRepairs: string[] = [
  `WITH ranked AS (
     SELECT id, user_id, company_id,
            MIN(id) OVER (PARTITION BY user_id, company_id) AS keeper_id,
            MAX(assigned_location_id) FILTER (WHERE assigned_location_id IS NOT NULL)
              OVER (PARTITION BY user_id, company_id) AS merged_location_id,
            MAX(cash_account_id) FILTER (WHERE cash_account_id IS NOT NULL)
              OVER (PARTITION BY user_id, company_id) AS merged_cash_account_id,
            BOOL_OR(can_sell_negative_stock) OVER (PARTITION BY user_id, company_id) AS merged_negative_stock,
            BOOL_OR(pos_view_only) OVER (PARTITION BY user_id, company_id) AS merged_view_only,
            MAX(daybook_edit_days) OVER (PARTITION BY user_id, company_id) AS merged_edit_days,
            BOOL_OR(can_access_customers) OVER (PARTITION BY user_id, company_id) AS merged_customers,
            BOOL_OR(can_delete_records) OVER (PARTITION BY user_id, company_id) AS merged_delete
     FROM user_company_roles
   )
   UPDATE user_company_roles AS keeper
   SET assigned_location_id = COALESCE(keeper.assigned_location_id, ranked.merged_location_id),
       cash_account_id = COALESCE(keeper.cash_account_id, ranked.merged_cash_account_id),
       can_sell_negative_stock = ranked.merged_negative_stock,
       pos_view_only = ranked.merged_view_only,
       daybook_edit_days = ranked.merged_edit_days,
       can_access_customers = ranked.merged_customers,
       can_delete_records = ranked.merged_delete
   FROM ranked
   WHERE keeper.id = ranked.keeper_id
     AND ranked.keeper_id <> ranked.id`,
  `DELETE FROM user_company_roles duplicate
   USING user_company_roles keeper
   WHERE duplicate.user_id = keeper.user_id
     AND duplicate.company_id = keeper.company_id
     AND duplicate.id > keeper.id`,
  `DELETE FROM user_locations AS ul
   WHERE NOT EXISTS (
     SELECT 1
     FROM user_company_roles AS ucr
     WHERE ucr.user_id = ul.user_id
       AND ucr.company_id = ul.company_id
   )`,
];