/**
 * Location Inventory WhatsApp stock-report configuration.
 *
 * Kept separate from the legacy locations.whatsapp_group_chat_id column so later
 * phases can add scheduling/report options without turning the locations table
 * into a scheduler configuration table. The legacy column is mirrored by the
 * route layer for backwards compatibility with existing POS/report code.
 */
export const locationWhatsAppStockReports: string[] = [
  `CREATE TABLE IF NOT EXISTS location_whatsapp_stock_reports (
      location_id integer PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
      company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      whatsapp_group_chat_id text,
      whatsapp_group_name text,
      enabled boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT location_whatsapp_stock_reports_enabled_requires_group
        CHECK (NOT enabled OR whatsapp_group_chat_id IS NOT NULL)
    )`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_reports_company_idx
     ON location_whatsapp_stock_reports (company_id, location_id)`,
  `INSERT INTO location_whatsapp_stock_reports (
      location_id,
      company_id,
      whatsapp_group_chat_id,
      whatsapp_group_name,
      enabled
    )
    SELECT id, company_id, whatsapp_group_chat_id, NULL, true
      FROM locations
     WHERE whatsapp_group_chat_id IS NOT NULL
       AND trim(whatsapp_group_chat_id) <> ''
    ON CONFLICT (location_id) DO NOTHING`,
];
