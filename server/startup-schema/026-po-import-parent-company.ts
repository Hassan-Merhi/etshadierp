/**
 * Repair the production company relationship required by PO Import.
 *
 * HMD KINSHASA is an ERP child of HADI L'SHI. Supplier inheritance and the
 * parent-side intercompany supplier posting both depend on that explicit
 * relationship. Keep this repair name-based and guarded so it remains safe if
 * company IDs differ between environments, and never overwrite an existing
 * parent assignment.
 */
export const poImportParentCompany = [
  `DO $$
DECLARE
  parent_id INTEGER;
  child_id INTEGER;
BEGIN
  SELECT id
    INTO parent_id
    FROM companies
   WHERE UPPER(TRIM(name)) = 'HADI L''SHI'
     AND company_type = 'erp'
     AND active = TRUE
   ORDER BY id
   LIMIT 1;

  SELECT id
    INTO child_id
    FROM companies
   WHERE UPPER(TRIM(name)) = 'HMD KINSHASA'
     AND company_type = 'erp'
     AND active = TRUE
   ORDER BY id
   LIMIT 1;

  IF parent_id IS NOT NULL
     AND child_id IS NOT NULL
     AND parent_id <> child_id THEN
    UPDATE companies
       SET parent_company_id = parent_id
     WHERE id = child_id
       AND parent_company_id IS NULL;
  END IF;
END $$`,
];
