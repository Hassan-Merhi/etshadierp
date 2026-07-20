-- Enforce dual-currency storage for every NEW USD/CFA voucher entry, including
-- legacy posting routes that still insert debit_amount/credit_amount directly.
-- Historical rows are not touched; use the explicit dry-run backfill tool for them.

CREATE OR REPLACE FUNCTION normalize_new_voucher_entry_currency_amounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  voucher_currency text;
  voucher_rate numeric(20, 10);
  raw_debit numeric(20, 6);
  raw_credit numeric(20, 6);
BEGIN
  SELECT UPPER(COALESCE(v.currency, 'USD')), v.exchange_rate::numeric
    INTO voucher_currency, voucher_rate
    FROM vouchers v
   WHERE v.id = NEW.voucher_id;

  IF voucher_currency IS NULL THEN
    RAISE EXCEPTION 'Voucher % not found while normalizing voucher entry', NEW.voucher_id;
  END IF;

  raw_debit := COALESCE(NEW.transaction_debit_amount, NEW.debit_amount, 0)::numeric;
  raw_credit := COALESCE(NEW.transaction_credit_amount, NEW.credit_amount, 0)::numeric;

  IF raw_debit < 0 OR raw_credit < 0 THEN
    RAISE EXCEPTION 'Voucher entry amounts cannot be negative';
  END IF;
  IF raw_debit > 0 AND raw_credit > 0 THEN
    RAISE EXCEPTION 'Voucher entry cannot contain both a debit and a credit amount';
  END IF;
  IF raw_debit = 0 AND raw_credit = 0 THEN
    RAISE EXCEPTION 'Voucher entry must contain a debit or credit amount';
  END IF;

  -- Already-normalized application paths remain authoritative. The trigger only
  -- verifies that backward-compatible debit/credit columns equal historical base.
  IF NEW.transaction_currency IS NOT NULL
     AND NEW.transaction_debit_amount IS NOT NULL
     AND NEW.transaction_credit_amount IS NOT NULL
     AND NEW.base_debit_amount IS NOT NULL
     AND NEW.base_credit_amount IS NOT NULL
     AND NEW.historical_exchange_rate IS NOT NULL
     AND NEW.rate_convention IS NOT NULL THEN
    NEW.transaction_currency := CASE WHEN UPPER(NEW.transaction_currency) = 'XOF' THEN 'CFA' ELSE UPPER(NEW.transaction_currency) END;
    NEW.debit_amount := NEW.base_debit_amount;
    NEW.credit_amount := NEW.base_credit_amount;
    RETURN NEW;
  END IF;

  IF voucher_currency = 'USD' THEN
    NEW.transaction_currency := 'USD';
    NEW.transaction_debit_amount := raw_debit;
    NEW.transaction_credit_amount := raw_credit;
    NEW.base_debit_amount := raw_debit;
    NEW.base_credit_amount := raw_credit;
    NEW.historical_exchange_rate := 1.0000000000;
    NEW.rate_convention := 'IDENTITY';
    NEW.debit_amount := raw_debit;
    NEW.credit_amount := raw_credit;
    RETURN NEW;
  END IF;

  IF voucher_currency IN ('CFA', 'XOF') THEN
    IF voucher_rate IS NULL OR voucher_rate <= 0 THEN
      RAISE EXCEPTION 'CFA voucher % requires a positive historical exchange rate', NEW.voucher_id;
    END IF;
    NEW.transaction_currency := 'CFA';
    NEW.transaction_debit_amount := raw_debit;
    NEW.transaction_credit_amount := raw_credit;
    NEW.base_debit_amount := ROUND(raw_debit / voucher_rate, 6);
    NEW.base_credit_amount := ROUND(raw_credit / voucher_rate, 6);
    NEW.historical_exchange_rate := voucher_rate;
    NEW.rate_convention := 'TRANSACTION_PER_BASE';
    NEW.debit_amount := NEW.base_debit_amount;
    NEW.credit_amount := NEW.base_credit_amount;
    RETURN NEW;
  END IF;

  -- Do not guess conventions for other currencies. Refuse the insert so the
  -- caller must provide a fully normalized entry with an explicit convention.
  RAISE EXCEPTION
    'Voucher currency % requires explicit transaction/base amounts and rate convention',
    voucher_currency;
END;
$$;

DROP TRIGGER IF EXISTS voucher_entries_normalize_currency_before_insert ON voucher_entries;
CREATE TRIGGER voucher_entries_normalize_currency_before_insert
BEFORE INSERT ON voucher_entries
FOR EACH ROW
EXECUTE FUNCTION normalize_new_voucher_entry_currency_amounts();
