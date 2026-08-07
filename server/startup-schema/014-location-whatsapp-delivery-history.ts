/**
 * Persistent delivery ledger for Location Inventory WhatsApp stock reports.
 *
 * Every manual, scheduled, and retry attempt gets its own immutable row. The
 * unique idempotency key protects against browser retries / duplicate scheduler
 * execution while still preserving a complete operational history.
 */
export const locationWhatsAppDeliveryHistory: string[] = [
  `CREATE TABLE IF NOT EXISTS location_whatsapp_stock_deliveries (
      id bigserial PRIMARY KEY,
      company_id integer NOT NULL,
      location_id integer NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      source text NOT NULL,
      retry_of_id bigint REFERENCES location_whatsapp_stock_deliveries(id) ON DELETE SET NULL,
      idempotency_key text NOT NULL,
      status text NOT NULL DEFAULT 'running',
      include_cost boolean NOT NULL DEFAULT false,
      include_zero_stock boolean NOT NULL DEFAULT false,
      include_negative_stock boolean NOT NULL DEFAULT true,
      stock_group_id integer REFERENCES stock_groups(id) ON DELETE SET NULL,
      stock_group_unassigned boolean NOT NULL DEFAULT false,
      category_id integer REFERENCES stock_categories(id) ON DELETE SET NULL,
      initiated_by_user_id text,
      scheduled_for date,
      destination_chat_id text,
      destination_group_name text,
      report_generated_at timestamptz,
      item_count integer,
      page_count integer,
      file_name text,
      error text,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT location_whatsapp_stock_deliveries_source_check
        CHECK (source IN ('manual', 'scheduled', 'retry')),
      CONSTRAINT location_whatsapp_stock_deliveries_status_check
        CHECK (status IN ('running', 'sent', 'failed', 'skipped_empty')),
      CONSTRAINT location_whatsapp_stock_deliveries_idempotency_unique UNIQUE (idempotency_key)
    )`,
  `ALTER TABLE location_whatsapp_stock_deliveries
     ADD COLUMN IF NOT EXISTS stock_group_unassigned boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_deliveries_location_idx
     ON location_whatsapp_stock_deliveries (company_id, location_id, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_deliveries_status_idx
     ON location_whatsapp_stock_deliveries (company_id, status, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS location_whatsapp_stock_deliveries_retry_idx
     ON location_whatsapp_stock_deliveries (retry_of_id)
     WHERE retry_of_id IS NOT NULL`,
];
