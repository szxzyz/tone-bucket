-- Miner system for the production AXN ledger (users.axn_balance).
-- This migration does not alter the separate legacy/Gems balance.
ALTER TABLE users
  ALTER COLUMN axn_balance TYPE numeric(40,10)
  USING axn_balance::numeric(40,10);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mining_accrual_level integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS miner_configurations (
  level integer PRIMARY KEY,
  required_holding numeric(30,10) NOT NULL,
  mining_power_ths numeric(12,4) NOT NULL,
  daily_yield_axn numeric(30,10) NOT NULL,
  display_value_usd numeric(30,10) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT miner_configurations_positive_level CHECK (level >= 1),
  CONSTRAINT miner_configurations_nonnegative CHECK (
    required_holding >= 0 AND mining_power_ths >= 0 AND daily_yield_axn >= 0 AND display_value_usd >= 0
  )
);

-- Insert initial defaults only. Re-running the migration will not overwrite
-- configuration values that an operator has changed later.
INSERT INTO miner_configurations (level, required_holding, mining_power_ths, daily_yield_axn, display_value_usd)
VALUES
  (1, 0,   0.20,  5,     0.0002422),
  (2, 100, 0.24,  6,     0.00029065),
  (3, 101, 0.28,  7,     0.00033909),
  (4, 102, 0.31,  7.75,  0.00037542),
  (5, 105, 0.35,  8.75,  0.00042386),
  (6, 108, 0.39,  9.75,  0.0004723),
  (7, 112, 0.42,  10.5,  0.00050863),
  (8, 117, 0.46,  11.5,  0.00055708),
  (9, 123, 0.50,  12.5,  0.00060552),
  (10,130, 0.53,  13.25, 0.00064185)
ON CONFLICT (level) DO NOTHING;

CREATE TABLE IF NOT EXISTS miner_system_migrations (
  migration_key varchar PRIMARY KEY,
  applied_at timestamp NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION tone_bucket_miner_level_for_balance(p_balance numeric)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(level), 1)
  FROM miner_configurations
  WHERE required_holding <= GREATEST(COALESCE(p_balance, 0), 0)
$$;

-- Preserve active legacy 8-hour accrual once, at its old fixed rate. From this
-- point new accrual is continuous and tier-based. The marker keeps reruns safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM miner_system_migrations WHERE migration_key = '0016_miner_system') THEN
    UPDATE users
    SET mining_accrued_gold = LEAST(
          23.9574 * 8,
          GREATEST(0, COALESCE(mining_accrued_gold, 0)) +
            GREATEST(0, EXTRACT(EPOCH FROM (
              LEAST(now(), mining_started_at + interval '8 hours') -
              GREATEST(COALESCE(mining_last_accrual_at, mining_started_at), mining_started_at)
            ))) * 23.9574 / 3600
        ),
        mining_last_accrual_at = now()
    WHERE mining_started_at IS NOT NULL;

    UPDATE users
    SET mining_accrual_level = tone_bucket_miner_level_for_balance(axn_balance);

    INSERT INTO miner_system_migrations (migration_key) VALUES ('0016_miner_system');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION tone_bucket_accrue_before_axn_balance_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamp := clock_timestamp();
  v_from timestamp;
  v_rate numeric;
BEGIN
  IF NEW.mining_started_at IS NOT NULL THEN
    -- A claim supplies its own accrual timestamp and cleared reward. Only
    -- accrue here when no explicit claim/state accrual timestamp was supplied.
    IF NEW.axn_balance IS DISTINCT FROM OLD.axn_balance
       AND NEW.mining_last_accrual_at IS NOT DISTINCT FROM OLD.mining_last_accrual_at
       AND OLD.mining_started_at IS NOT NULL THEN
      v_from := GREATEST(COALESCE(OLD.mining_last_accrual_at, OLD.mining_started_at), OLD.mining_started_at);
      SELECT daily_yield_axn INTO v_rate
      FROM miner_configurations
      WHERE level = COALESCE(OLD.mining_accrual_level, tone_bucket_miner_level_for_balance(OLD.axn_balance));
      IF v_from < v_now AND v_rate IS NOT NULL THEN
        NEW.mining_accrued_gold := ROUND(
          COALESCE(OLD.mining_accrued_gold, 0) +
          GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_from))) * v_rate / 86400,
          10
        );
      END IF;
      NEW.mining_last_accrual_at := v_now;
    END IF;
    NEW.mining_accrual_level := tone_bucket_miner_level_for_balance(NEW.axn_balance);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_miner_balance_accrual ON users;
CREATE TRIGGER users_miner_balance_accrual
BEFORE UPDATE OF axn_balance ON users
FOR EACH ROW
EXECUTE FUNCTION tone_bucket_accrue_before_axn_balance_change();
