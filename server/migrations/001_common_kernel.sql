-- Common kernel storage contract. Every FK carries owner_id so a relation can
-- never point at another owner's data. Domain-specific payloads are versioned
-- JSONB, while identity, provenance, state, time and dependency keys are columns.
BEGIN;

CREATE TABLE IF NOT EXISTS luffi_source (
  owner_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL DEFAULT '',
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_source_version (
  owner_id text NOT NULL,
  id text NOT NULL,
  source_id text NOT NULL,
  content_hash text,
  content jsonb,
  asset jsonb,
  captured_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, source_id) REFERENCES luffi_source (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_evidence (
  owner_id text NOT NULL,
  id text NOT NULL,
  source_version_id text NOT NULL,
  locator jsonb,
  quote text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, source_version_id) REFERENCES luffi_source_version (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_entity (
  owner_id text NOT NULL,
  id text NOT NULL,
  type_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_entity_mention (
  owner_id text NOT NULL,
  id text NOT NULL,
  source_version_id text NOT NULL,
  surface_text text NOT NULL,
  entity_type_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, source_version_id) REFERENCES luffi_source_version (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_mention_evidence (
  owner_id text NOT NULL,
  mention_id text NOT NULL,
  evidence_id text NOT NULL,
  PRIMARY KEY (owner_id, mention_id, evidence_id),
  FOREIGN KEY (owner_id, mention_id) REFERENCES luffi_entity_mention (owner_id, id),
  FOREIGN KEY (owner_id, evidence_id) REFERENCES luffi_evidence (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_identity_decision (
  owner_id text NOT NULL,
  id text NOT NULL,
  mention_id text NOT NULL,
  entity_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'accepted', 'retracted', 'superseded', 'invalidated')),
  reason text NOT NULL DEFAULT '',
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  retracted_at timestamptz,
  superseded_at timestamptz,
  invalidated_at timestamptz,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, mention_id) REFERENCES luffi_entity_mention (owner_id, id),
  FOREIGN KEY (owner_id, entity_id) REFERENCES luffi_entity (owner_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS luffi_identity_one_accepted
  ON luffi_identity_decision (owner_id, mention_id) WHERE status = 'accepted';

CREATE TABLE IF NOT EXISTS luffi_identity_evidence (
  owner_id text NOT NULL,
  decision_id text NOT NULL,
  evidence_id text NOT NULL,
  PRIMARY KEY (owner_id, decision_id, evidence_id),
  FOREIGN KEY (owner_id, decision_id) REFERENCES luffi_identity_decision (owner_id, id),
  FOREIGN KEY (owner_id, evidence_id) REFERENCES luffi_evidence (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_assertion (
  owner_id text NOT NULL,
  id text NOT NULL,
  subject_id text NOT NULL,
  subject_mention_id text,
  identity_decision_id text,
  predicate text NOT NULL,
  object_entity_id text,
  typed_value jsonb,
  scope_type text NOT NULL,
  scope_id text NOT NULL,
  origin text NOT NULL,
  asserted_by jsonb NOT NULL,
  observed_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  refresh_due_at timestamptz,
  recorded_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'corrected', 'retracted', 'invalidated')),
  supersedes_id text,
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, subject_id) REFERENCES luffi_entity (owner_id, id),
  FOREIGN KEY (owner_id, subject_mention_id) REFERENCES luffi_entity_mention (owner_id, id),
  FOREIGN KEY (owner_id, identity_decision_id) REFERENCES luffi_identity_decision (owner_id, id),
  FOREIGN KEY (owner_id, object_entity_id) REFERENCES luffi_entity (owner_id, id),
  FOREIGN KEY (owner_id, supersedes_id) REFERENCES luffi_assertion (owner_id, id),
  CHECK (status <> 'active' OR ((object_entity_id IS NULL) <> (typed_value IS NULL))),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to)
);
CREATE INDEX IF NOT EXISTS luffi_assertion_lookup
  ON luffi_assertion (owner_id, subject_id, predicate, scope_type, scope_id, status, observed_at DESC);

CREATE TABLE IF NOT EXISTS luffi_assertion_evidence (
  owner_id text NOT NULL,
  assertion_id text NOT NULL,
  evidence_id text NOT NULL,
  support_group integer NOT NULL DEFAULT 0 CHECK (support_group >= 0),
  PRIMARY KEY (owner_id, assertion_id, evidence_id, support_group),
  FOREIGN KEY (owner_id, assertion_id) REFERENCES luffi_assertion (owner_id, id),
  FOREIGN KEY (owner_id, evidence_id) REFERENCES luffi_evidence (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_activity (
  owner_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL,
  goal jsonb NOT NULL,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  lifecycle text NOT NULL CHECK (lifecycle IN ('active', 'completed', 'canceled')),
  current_plan_revision bigint NOT NULL DEFAULT 0,
  revision bigint NOT NULL CHECK (revision > 0),
  occurrence_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_plan_revision (
  owner_id text NOT NULL,
  activity_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, activity_id, revision),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_task (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  capability_id text NOT NULL,
  capability_version integer NOT NULL CHECK (capability_version > 0),
  kind text NOT NULL CHECK (kind IN ('observation', 'decision', 'action', 'wait', 'milestone')),
  execution_status text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema jsonb,
  renderer_key text,
  latest_result_id text,
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id)
);
CREATE INDEX IF NOT EXISTS luffi_task_by_activity ON luffi_task (owner_id, activity_id);

CREATE TABLE IF NOT EXISTS luffi_task_dependency (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  from_task_id text NOT NULL,
  to_task_id text NOT NULL,
  condition jsonb,
  PRIMARY KEY (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id, from_task_id) REFERENCES luffi_task (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id, to_task_id) REFERENCES luffi_task (owner_id, activity_id, id),
  CHECK (from_task_id <> to_task_id)
);

CREATE TABLE IF NOT EXISTS luffi_data_binding (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  source_task_id text NOT NULL,
  target_task_id text NOT NULL,
  output_key text,
  input_key text NOT NULL,
  policy text NOT NULL CHECK (policy IN ('latest_until_started', 'fixed')),
  result_id text,
  PRIMARY KEY (owner_id, activity_id, id),
  UNIQUE (owner_id, activity_id, target_task_id, input_key),
  FOREIGN KEY (owner_id, activity_id, source_task_id) REFERENCES luffi_task (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id, target_task_id) REFERENCES luffi_task (owner_id, activity_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_task_result (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  task_id text NOT NULL,
  result_revision bigint NOT NULL CHECK (result_revision > 0),
  value jsonb NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_result_id text,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, activity_id, id),
  UNIQUE (owner_id, activity_id, task_id, result_revision),
  FOREIGN KEY (owner_id, activity_id, task_id) REFERENCES luffi_task (owner_id, activity_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_artifact (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  type_id text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  data jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  PRIMARY KEY (owner_id, activity_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_resource (
  owner_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('quantity', 'exclusive')),
  allocation_mode text NOT NULL CHECK (allocation_mode IN ('consumable', 'concurrent')),
  unit_policy jsonb NOT NULL,
  availability_status text NOT NULL CHECK (availability_status IN ('known', 'unknown', 'stale')),
  capacity_units bigint CHECK (capacity_units >= 0),
  observation_id text,
  observed_at timestamptz,
  fresh_until timestamptz,
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id),
  CHECK ((availability_status = 'unknown' AND capacity_units IS NULL) OR
         (availability_status <> 'unknown' AND capacity_units IS NOT NULL)),
  CHECK (fresh_until IS NULL OR observed_at < fresh_until)
);

CREATE TABLE IF NOT EXISTS luffi_resource_claim (
  owner_id text NOT NULL,
  id text NOT NULL,
  resource_id text NOT NULL,
  activity_id text NOT NULL,
  quantity_units bigint NOT NULL CHECK (quantity_units > 0),
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  requested_unit text NOT NULL,
  time_range tstzrange,
  state text NOT NULL CHECK (state IN ('held', 'released')),
  acquisition_observation_id text NOT NULL,
  acquisition_resource_revision bigint NOT NULL CHECK (acquisition_resource_revision > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  acquired_at timestamptz NOT NULL,
  released_at timestamptz,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, resource_id) REFERENCES luffi_resource (owner_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id),
  CHECK (time_range IS NULL OR (NOT isempty(time_range) AND lower_inc(time_range) AND NOT upper_inc(time_range)))
);
CREATE INDEX IF NOT EXISTS luffi_resource_claim_held
  ON luffi_resource_claim (owner_id, resource_id, state) WHERE state = 'held';

CREATE TABLE IF NOT EXISTS luffi_command_receipt (
  owner_id text NOT NULL,
  stream text NOT NULL CHECK (stream IN ('knowledge', 'activity', 'resource')),
  command_id text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, stream, command_id)
);

CREATE TABLE IF NOT EXISTS luffi_knowledge_event (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id text NOT NULL,
  command_id text NOT NULL,
  kind text NOT NULL,
  changes jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS luffi_knowledge_event_owner_sequence
  ON luffi_knowledge_event (owner_id, sequence);

CREATE TABLE IF NOT EXISTS luffi_context_subscription (
  owner_id text NOT NULL,
  consumer_id text NOT NULL,
  context jsonb NOT NULL,
  registered_at_sequence bigint NOT NULL,
  next_reevaluate_at timestamptz,
  PRIMARY KEY (owner_id, consumer_id)
);
CREATE INDEX IF NOT EXISTS luffi_context_due
  ON luffi_context_subscription (next_reevaluate_at) WHERE next_reevaluate_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS luffi_issued_context (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text,
  activity_revision bigint,
  context jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id),
  CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS luffi_issued_context_expiry ON luffi_issued_context (expires_at);

CREATE TABLE IF NOT EXISTS luffi_plan_proposal (
  owner_id text NOT NULL,
  id text NOT NULL,
  activity_id text NOT NULL,
  context_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('draft', 'patch')),
  plan jsonb NOT NULL,
  run_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_activity_revision bigint NOT NULL CHECK (base_activity_revision > 0),
  base_plan_revision bigint NOT NULL CHECK (base_plan_revision >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  accepted_command_id text,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id),
  FOREIGN KEY (owner_id, context_id) REFERENCES luffi_issued_context (owner_id, id)
);
CREATE INDEX IF NOT EXISTS luffi_plan_proposal_pending
  ON luffi_plan_proposal (owner_id, activity_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS luffi_review_event (
  owner_id text NOT NULL,
  activity_id text NOT NULL,
  key text NOT NULL,
  reason jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, activity_id, key),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_import_receipt (
  owner_id text NOT NULL,
  import_id text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, import_id)
);

CREATE TABLE IF NOT EXISTS luffi_execution_receipt (
  owner_id text NOT NULL,
  command_id text NOT NULL,
  payload_hash text NOT NULL,
  activity_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, command_id),
  FOREIGN KEY (owner_id, activity_id) REFERENCES luffi_activity (owner_id, id)
);

CREATE TABLE IF NOT EXISTS luffi_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'unknown')),
  attempt_count integer NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS luffi_outbox_due ON luffi_outbox (status, due_at);

COMMIT;
