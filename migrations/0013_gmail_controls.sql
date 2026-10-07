CREATE INDEX household_notices_retention
  ON household_notices(retained_until);

CREATE INDEX gmail_review_records_retention
  ON gmail_review_records(expires_at);

CREATE TRIGGER household_notices_model_provenance_insert
BEFORE INSERT ON household_notices
WHEN trim(NEW.model_id) = '' OR trim(NEW.model_version) = ''
BEGIN
  SELECT RAISE(ABORT, 'model provenance required');
END;

CREATE TRIGGER household_notices_model_provenance_update
BEFORE UPDATE OF model_id, model_version ON household_notices
WHEN trim(NEW.model_id) = '' OR trim(NEW.model_version) = ''
BEGIN
  SELECT RAISE(ABORT, 'model provenance required');
END;
