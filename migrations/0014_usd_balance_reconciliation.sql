-- USD balance authority migration.
-- GRAM values are preserved for audit because this deployment does not have a
-- reliable historical exchange rate. No automatic conversion is performed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS usd_balance NUMERIC(30, 10) DEFAULT '0';
CREATE TABLE IF NOT EXISTS legacy_gram_balance_reconciliation (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gram_balance NUMERIC(30, 18) NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(24) NOT NULL DEFAULT 'needs_review',
  note TEXT NOT NULL DEFAULT 'Preserved without conversion: historical USD/GRAM rate unavailable'
);
INSERT INTO legacy_gram_balance_reconciliation (user_id, gram_balance)
SELECT id, COALESCE(gram_balance, 0) FROM users
WHERE COALESCE(gram_balance, 0) <> 0
ON CONFLICT (user_id) DO NOTHING;
-- New market settlement and withdrawals use usd_balance exclusively.
INSERT INTO admin_settings (setting_key, setting_value)
VALUES ('minimum_cashout_usd', '1'), ('maximum_cashout_usd', '1000000'), ('withdrawal_fee_usd', '0')
ON CONFLICT (setting_key) DO NOTHING;
