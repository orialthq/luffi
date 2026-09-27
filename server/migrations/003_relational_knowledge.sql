-- Canonical graph records live in the relational tables from 001. The record
-- column preserves fields that are not indexed yet (including audit metadata),
-- while the typed columns and foreign keys enforce provenance and graph links.
BEGIN;
ALTER TABLE luffi_source ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_source ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_source_version ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_source_version ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_evidence ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_evidence ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_entity ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_entity ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_entity_mention ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_entity_mention ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_identity_decision ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_identity_decision ADD COLUMN IF NOT EXISTS position bigint;
ALTER TABLE luffi_assertion ADD COLUMN IF NOT EXISTS record jsonb;
ALTER TABLE luffi_assertion ADD COLUMN IF NOT EXISTS position bigint;

CREATE INDEX IF NOT EXISTS luffi_source_by_position
  ON luffi_source (position);
CREATE INDEX IF NOT EXISTS luffi_source_version_by_source
  ON luffi_source_version (owner_id, source_id, position);
CREATE INDEX IF NOT EXISTS luffi_evidence_by_version
  ON luffi_evidence (owner_id, source_version_id, position);
CREATE INDEX IF NOT EXISTS luffi_entity_by_type
  ON luffi_entity (owner_id, type_id, status);
CREATE INDEX IF NOT EXISTS luffi_mention_by_version
  ON luffi_entity_mention (owner_id, source_version_id, position);
CREATE INDEX IF NOT EXISTS luffi_identity_by_entity
  ON luffi_identity_decision (owner_id, entity_id, status);
CREATE INDEX IF NOT EXISTS luffi_assertion_object
  ON luffi_assertion (owner_id, object_entity_id, predicate, status)
  WHERE object_entity_id IS NOT NULL;
COMMIT;
