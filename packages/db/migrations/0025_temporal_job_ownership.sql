ALTER TABLE "job" DROP CONSTRAINT "job_status";--> statement-breakpoint
ALTER TABLE "job" ALTER COLUMN "status" SET DEFAULT 'temporal';--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "dispatch_attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_status" CHECK ("job"."status" IN ('due', 'running', 'done', 'failed', 'temporal', 'dispatched', 'executing', 'legacy-running'));
--> statement-breakpoint
INSERT INTO audit(actor, action, subject, details)
SELECT 'system:migration', 'job.temporal_ownership', 'job:' || id, jsonb_build_object('previous', status, 'blocked', status = 'running')
FROM job WHERE status IN ('due', 'failed', 'running');
--> statement-breakpoint
UPDATE job SET status = CASE WHEN status = 'running' THEN 'legacy-running' ELSE 'temporal' END WHERE status IN ('due', 'failed', 'running');
--> statement-breakpoint
CREATE FUNCTION clew_temporal_job_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'due' THEN NEW.status := 'temporal'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER temporal_job_owner BEFORE INSERT ON job FOR EACH ROW EXECUTE FUNCTION clew_temporal_job_owner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refresh_content_changed AFTER INSERT OR UPDATE OR DELETE ON refresh_request
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER delivery_content_changed AFTER INSERT OR UPDATE OR DELETE ON attention_delivery
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER followup_content_changed AFTER INSERT OR UPDATE OR DELETE ON followup_policy
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
