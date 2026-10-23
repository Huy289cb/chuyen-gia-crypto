-- Independent of account/position cascades. Apply only through a reviewed release.
CREATE TABLE account_mutation_journal (
  attempt_id UUID PRIMARY KEY,
  account_id INTEGER NOT NULL CHECK (account_id > 0),
  mutation_kind TEXT NOT NULL CHECK (mutation_kind = 'admin_local_reset'),
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX account_mutation_journal_account_time
  ON account_mutation_journal(account_id, recorded_at);
COMMENT ON COLUMN account_mutation_journal.recorded_at IS
  'Insertion clock inside transaction, not commit/DB-return time; row visible only after commit.';
