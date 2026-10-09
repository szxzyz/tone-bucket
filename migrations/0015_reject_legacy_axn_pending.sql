-- One-time cleanup: reject only pending legacy AXN/GEM withdrawals.
-- USD and GRAM withdrawals are explicitly excluded.
CREATE TABLE IF NOT EXISTS legacy_axn_withdrawal_reconciliation (
  withdrawal_id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  axn_amount NUMERIC(30, 18) NOT NULL,
  was_debited BOOLEAN NOT NULL DEFAULT FALSE,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  notified_at TIMESTAMP,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW()
);
INSERT INTO legacy_axn_withdrawal_reconciliation (withdrawal_id, user_id, axn_amount, was_debited)
SELECT w.id, w.user_id,
  COALESCE(NULLIF(w.details->>'axnAmount', '')::numeric, NULLIF(w.details->>'goldAmount', '')::numeric, w.gold_amount::numeric, 0),
  COALESCE(w.deducted, false)
FROM withdrawals w
WHERE w.status = 'pending'
  AND (w.details ? 'axnAmount' OR w.details ? 'goldAmount')
  AND COALESCE(w.payout_currency, '') NOT IN ('USD', 'GRAM')
  AND COALESCE(w.details->>'manualUsdWithdrawal', 'false') <> 'true'
  AND COALESCE(w.details->>'manualGramWithdrawal', 'false') <> 'true'
ON CONFLICT (withdrawal_id) DO NOTHING;
UPDATE users u SET balance = u.balance + r.axn_amount, updated_at = NOW()
FROM legacy_axn_withdrawal_reconciliation r WHERE r.user_id = u.id AND r.was_debited = true AND r.refunded = false;
UPDATE legacy_axn_withdrawal_reconciliation SET refunded = was_debited WHERE refunded = false;
UPDATE withdrawals w SET status = 'rejected', refunded = r.refunded, deducted = false,
  admin_notes = COALESCE(w.admin_notes, 'Automatically rejected: legacy AXN/GEM withdrawal reconciliation'),
  updated_at = NOW(), details = COALESCE(w.details, '{}'::jsonb) || jsonb_build_object('legacyAxnReconciled', true)
FROM legacy_axn_withdrawal_reconciliation r WHERE w.id = r.withdrawal_id AND w.status = 'pending';
