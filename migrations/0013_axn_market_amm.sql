ALTER TABLE users ADD COLUMN IF NOT EXISTS gram_balance NUMERIC(30, 18) DEFAULT '0';

-- AXN virtual AMM market: internal accounting only; no on-chain TON/GRAM transfers.
CREATE TABLE IF NOT EXISTS axn_market_pool (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ton_reserve NUMERIC(30, 18) NOT NULL CHECK (ton_reserve >= 0),
  axn_reserve NUMERIC(30, 0) NOT NULL CHECK (axn_reserve >= 0),
  gram_reserve NUMERIC(30, 18) NOT NULL CHECK (gram_reserve >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS axn_market_settings (
  setting_key VARCHAR(80) PRIMARY KEY,
  setting_value NUMERIC(30, 18),
  text_value TEXT,
  updated_by VARCHAR REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS axn_market_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  input_asset VARCHAR(8) NOT NULL CHECK (input_asset IN ('TON', 'AXN')),
  output_asset VARCHAR(8) NOT NULL CHECK (output_asset IN ('AXN', 'GRAM')),
  input_amount NUMERIC(30, 18) NOT NULL CHECK (input_amount > 0),
  gross_output NUMERIC(30, 18) NOT NULL CHECK (gross_output >= 0),
  fee_amount NUMERIC(30, 18) NOT NULL CHECK (fee_amount >= 0),
  fee_rate_bps INTEGER NOT NULL CHECK (fee_rate_bps >= 0),
  net_output NUMERIC(30, 18) NOT NULL CHECK (net_output >= 0),
  min_received NUMERIC(30, 18),
  price_impact NUMERIC(30, 18) NOT NULL DEFAULT 0,
  ton_usd_price NUMERIC(30, 18),
  gram_usd_price NUMERIC(30, 18),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS axn_market_swaps_created_at_idx ON axn_market_swaps (created_at DESC);

CREATE TABLE IF NOT EXISTS axn_market_price_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swap_id UUID REFERENCES axn_market_swaps(id) ON DELETE CASCADE NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  price_ton NUMERIC(30, 18) NOT NULL,
  price_gram NUMERIC(30, 18) NOT NULL,
  price_usd NUMERIC(30, 18),
  volume_axn NUMERIC(30, 0) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS axn_market_snapshots_recorded_idx ON axn_market_price_snapshots (recorded_at DESC);

INSERT INTO axn_market_pool (id, ton_reserve, axn_reserve, gram_reserve)
VALUES (1, 10, 1000000, 100000)
ON CONFLICT (id) DO NOTHING;
INSERT INTO axn_market_settings (setting_key, setting_value, text_value) VALUES
  ('buy_fee_bps', 30, NULL),
  ('sell_fee_bps', 30, NULL),
  ('min_swap_ton', 0.0001, NULL),
  ('max_swap_ton', 1000, NULL),
  ('min_swap_axn', 1, NULL),
  ('max_swap_axn', 1000000000, NULL),
  ('max_price_impact_bps', 1000, NULL),
  ('slippage_bps', 100, NULL),
  ('gram_usd_price', 0.000001, NULL),
  ('market_paused', NULL, 'false'),
  ('public_trading_enabled', NULL, 'false')
ON CONFLICT (setting_key) DO NOTHING;
