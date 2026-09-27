-- Transactional kernel snapshot. This is the runtime migration bridge while
-- graph records are incrementally mapped to the relational tables in 001.
BEGIN;
CREATE TABLE IF NOT EXISTS luffi_kernel_state (
  id text PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
