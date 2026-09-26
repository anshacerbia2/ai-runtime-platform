CREATE TABLE control.management_receipts (
 id uuid PRIMARY KEY, scope_key char(64) NOT NULL, request_key varchar(160) NOT NULL,
 operation varchar(64) NOT NULL, request_digest char(64) NOT NULL, response jsonb NOT NULL,
 completed boolean NOT NULL DEFAULT false, completed_at timestamptz(6), expires_at timestamptz(6) NOT NULL,
 CONSTRAINT management_receipts_scope_key_request_key_key UNIQUE(scope_key,request_key),
 CONSTRAINT management_receipts_response_bound CHECK(octet_length(response::text)<=65536)
);
CREATE INDEX management_receipts_expires_at_idx ON control.management_receipts(expires_at);
CREATE FUNCTION control.ensure_completed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM control.management_receipts WHERE id=NEW.id AND (NOT completed OR completed_at IS NULL)) THEN
   RAISE EXCEPTION 'An incomplete request receipt cannot be committed';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER management_receipt_completed AFTER INSERT OR UPDATE ON control.management_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION control.ensure_completed_receipt();
