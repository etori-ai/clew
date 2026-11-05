CREATE TABLE "person_change" (
	"person_id" text PRIMARY KEY NOT NULL,
	"content" bigint DEFAULT 0 NOT NULL,
	"policy" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_change" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION clew_content_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text;
BEGIN
  owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END;
  INSERT INTO person_change(person_id, content) VALUES (owner, 1)
    ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER thread_content_changed AFTER INSERT OR UPDATE OR DELETE ON thread
FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
CREATE TRIGGER execution_content_changed AFTER INSERT OR UPDATE OR DELETE ON execution
FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
CREATE FUNCTION clew_person_policy_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text;
BEGIN
  IF TG_TABLE_NAME = 'auth_person' THEN
    owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END;
  END IF;
  INSERT INTO person_change(person_id, policy) VALUES (owner, 1)
    ON CONFLICT(person_id) DO UPDATE SET policy = person_change.policy + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER person_policy_changed AFTER INSERT OR UPDATE OR DELETE ON auth_person
FOR EACH ROW EXECUTE FUNCTION clew_person_policy_changed();
--> statement-breakpoint
CREATE TRIGGER grant_policy_changed AFTER INSERT OR UPDATE OR DELETE ON auth_access_grant
FOR EACH ROW EXECUTE FUNCTION clew_person_policy_changed();
--> statement-breakpoint
CREATE FUNCTION clew_connector_policy_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.state, OLD.audience, OLD.capabilities, OLD.scan_enabled, OLD.tools_enabled, OLD.url, OLD.secret, OLD.manifest)
      IS NOT DISTINCT FROM (NEW.state, NEW.audience, NEW.capabilities, NEW.scan_enabled, NEW.tools_enabled, NEW.url, NEW.secret, NEW.manifest)
      THEN RETURN NULL;
    END IF;
  END IF;
  INSERT INTO policy_change(id, revision) VALUES ('installation', 1)
    ON CONFLICT(id) DO UPDATE SET revision = policy_change.revision + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER connector_policy_changed AFTER INSERT OR UPDATE OR DELETE ON connector
FOR EACH ROW EXECUTE FUNCTION clew_connector_policy_changed();
