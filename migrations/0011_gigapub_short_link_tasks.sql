ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "gigapub_short_link_1_claimed" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gigapub_short_link_2_claimed" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gigapub_short_link_3_claimed" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gigapub_short_link_started_at" timestamp;
