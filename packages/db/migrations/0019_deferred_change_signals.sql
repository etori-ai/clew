-- Publish revisions at commit, after business row locks have been acquired. An
-- execution updates its card, while a card writer may already hold that card:
-- locking the person's counter between those operations would invert lock order.
DROP TRIGGER thread_content_changed ON thread;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER thread_content_changed AFTER INSERT OR UPDATE OR DELETE ON thread
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
DROP TRIGGER execution_content_changed ON execution;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER execution_content_changed AFTER INSERT OR UPDATE OR DELETE ON execution
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
DROP TRIGGER person_policy_changed ON auth_person;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER person_policy_changed AFTER INSERT OR UPDATE OR DELETE ON auth_person
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_person_policy_changed();
--> statement-breakpoint
DROP TRIGGER grant_policy_changed ON auth_access_grant;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_policy_changed AFTER INSERT OR UPDATE OR DELETE ON auth_access_grant
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_person_policy_changed();
--> statement-breakpoint
DROP TRIGGER connector_policy_changed ON connector;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER connector_policy_changed AFTER INSERT OR UPDATE OR DELETE ON connector
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_connector_policy_changed();
