-- Virtual AXN market phase 1: internal accounting only; no on-chain settlement.
CREATE TABLE IF NOT EXISTS axn_market_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  axn_quantity NUMERIC(30, 0) NOT NULL CHECK (axn_quantity > 0),
  ton_amount NUMERIC(30, 10) NOT NULL CHECK (ton_amount > 0),
  price_per_axn NUMERIC(30, 12) NOT NULL CHECK (price_per_axn > 0),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS axn_market_trades_created_at_idx
  ON axn_market_trades (created_at);

CREATE TABLE IF NOT EXISTS axn_market_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES axn_market_trades(id) ON DELETE CASCADE NOT NULL,
  timeframe VARCHAR(4) NOT NULL,
  bucket_start TIMESTAMP NOT NULL,
  open_price NUMERIC(30, 12) NOT NULL,
  high_price NUMERIC(30, 12) NOT NULL,
  low_price NUMERIC(30, 12) NOT NULL,
  close_price NUMERIC(30, 12) NOT NULL,
  volume_axn NUMERIC(30, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (timeframe, bucket_start)
);

CREATE INDEX IF NOT EXISTS axn_market_history_bucket_idx
  ON axn_market_price_history (timeframe, bucket_start);
