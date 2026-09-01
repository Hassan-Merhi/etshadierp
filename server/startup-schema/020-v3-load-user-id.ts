/**
 * Repair the v3 stock-allocation load tables.
 *
 * `factory_v3_loads.created_by` / `.finalized_by` and
 * `factory_v3_load_bales.added_by` / `.removed_by` were all created as
 * `integer`, but `users.id` is a varchar UUID and every handler in
 * `factoryStockAllocationV3Routes.ts` writes the session user straight into
 * them:
 *
 *     const user = getUserInfo(req);
 *     ... .values({ ..., createdBy: user.id, createdByName: user.name })
 *
 * So `insert into factory_v3_loads` failed with
 * `invalid input syntax for type integer: "73131726-eae4-..."`, and unlike the
 * stock-merge audit — where the same mismatch was swallowed as non-fatal — here
 * nothing catches it. The whole v3 loading feature was unusable end to end: a
 * load could not be opened, so no bale could be scanned into one, so nothing
 * could be finalized. Every one of those endpoints answered 500.
 *
 * This is the second instance of the same defect (see 019). Both were invisible
 * because no test exercised the write path; the guard sweep only proves these
 * routes reject an anonymous caller, which they did, correctly, while being
 * completely broken for a real one.
 *
 * The conversion is safe on any database: the columns are empty everywhere the
 * insert was failing, and where a row somehow exists an integer id casts to its
 * own text form without loss. `USING` makes that explicit rather than relying on
 * Postgres to find an implicit cast, which it will not do for integer -> varchar
 * in an ALTER COLUMN TYPE.
 */
const conversions: { table: string; column: string }[] = [
  { table: "factory_v3_loads", column: "created_by" },
  { table: "factory_v3_loads", column: "finalized_by" },
  { table: "factory_v3_load_bales", column: "added_by" },
  { table: "factory_v3_load_bales", column: "removed_by" },
];

export const v3LoadUserId: string[] = conversions.map(
  ({ table, column }) =>
    `DO $v3_load_user_id$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = '${table}'
            AND column_name = '${column}'
            AND data_type <> 'character varying'
        ) THEN
          ALTER TABLE ${table}
            ALTER COLUMN ${column} TYPE varchar
            USING ${column}::varchar;
        END IF;
      END $v3_load_user_id$;`
);
