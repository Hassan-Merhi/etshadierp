/**
 * Per-location WhatsApp stock-report schedules.
 *
 * Scheduling is intentionally separate from the destination table created in
 * Phase 1. A location may keep a linked/usable WhatsApp group while automatic
 * delivery is disabled, and later phases can add retry/history fields without
 * changing the core locations table.
 */
export const locationWhatsAppStockSchedules: string[] = [
  `CREATE TABLE IF NOT EXISTS location_whatsapp_stock_schedules (
      location_id integer PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
      company_id integer NOT NULL,
      enabled boolean NOT NULL DEFAULT false,
      frequency text NOT NULL DEFAULT 'daily',
      days_of_week integer[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
      send_time time NOT NULL DEFAULT '18:00',
      timezone text NOT NULL DEFAULT 'Africa/Lubumbashi',
      include_cost boolean NOT NULL DEFAULT false,
      include_zero_stock boolean NOT NULL DEFAULT false,
      include_negative_stock boolean NOT NULL DEFAULT true,
      stock_group_id integer REFERENCES stock_groups(id) ON DELETE SET NULL,
      category_id integer REFERENCES stock_categories(id) ON DELETE SET NULL,
      last_scheduled_for date,
      last_attempt_at timestamptz,
      last_sent_at timestamptz,
      last_status text,
      last_error text,
      updated_by_user_id text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT location_whatsapp_stock_schedules_frequency_check
        CHECK (frequency IN ('daily', 'selected_days'))
    )`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_schedules_due_idx
     ON location_whatsapp_stock_schedules (enabled, company_id, location_id)`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_schedules_group_idx
     ON location_whatsapp_stock_schedules (company_id, stock_group_id)
     WHERE stock_group_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_schedules_category_idx
     ON location_whatsapp_stock_schedules (company_id, category_id)
     WHERE category_id IS NOT NULL`,
];
