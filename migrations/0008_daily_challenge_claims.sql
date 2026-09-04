-- Daily Challenge claims — one row per user/reset-period/milestone.
-- The unique constraint prevents double-claiming a milestone within a period.
CREATE TABLE IF NOT EXISTS daily_challenge_claims (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  period varchar NOT NULL,
  milestone integer NOT NULL,
  reward_amount decimal(30, 10) NOT NULL,
  claimed_at timestamp DEFAULT now(),
  CONSTRAINT daily_challenge_claims_unique UNIQUE (user_id, period, milestone)
);

CREATE INDEX IF NOT EXISTS daily_challenge_claims_user_idx
  ON daily_challenge_claims(user_id);
