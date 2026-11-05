-- Historical approvals did not persist a bounded policy or current assignment.
-- Keep their evidence and counters; never silently authorize a new workflow.
INSERT INTO followup_policy (thread_id, person_id, unit_id, authorization_version, execution_id, proposal_ids, max_reminders, after_workdays, expires_at, state, reason)
SELECT p.thread_id, p.person_id, 'legacy', 'legacy', 'legacy:' || p.thread_id, jsonb_agg(p.id), 2, 2,
       coalesce(min(p.confirmed_at), min(t.created_at)) + interval '30 days', 'blocked', 'legacy-unverified'
FROM proposal p JOIN thread t ON t.id = p.thread_id
WHERE p.status IN ('confirmed', 'final') AND t.execution IS NULL
GROUP BY p.thread_id, p.person_id ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO audit (actor, action, subject, details)
SELECT 'system:migration', 'obligation.legacy_paused', 'thread:' || thread_id, '{"reason":"legacy-unverified","automaticPolicyResumed":false}'::jsonb
FROM followup_policy WHERE reason = 'legacy-unverified';
--> statement-breakpoint
UPDATE thread SET state = 'open', handled_at = NULL, waiting_on = NULL,
 summary = 'Den äldre automatiska uppföljningen är pausad. Inbjudningarna finns kvar. Kontrollera svaren och välj själv nästa steg.', updated_at = now()
WHERE id IN (SELECT thread_id FROM followup_policy WHERE reason = 'legacy-unverified');
--> statement-breakpoint
-- A dismissal is a local disposition, never evidence of source completion.
CREATE FUNCTION clew_occurrence_disposition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('dismissed', 'open') THEN
  UPDATE work_occurrence SET disposition = CASE WHEN NEW.state = 'dismissed' THEN 'dismissed' ELSE 'visible' END WHERE thread_id = NEW.id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER thread_occurrence_disposition AFTER UPDATE OF state ON thread FOR EACH ROW EXECUTE FUNCTION clew_occurrence_disposition();
--> statement-breakpoint
-- A historical topic does not prove a source identity, assignment or period.
INSERT INTO work_occurrence (id, person_id, connector, assignment, source_key, period, revision, observed_at, source_state, disposition, thread_id, legacy)
SELECT 'legacy:' || id, person_id, connector, 'legacy-unverified', topic, 'legacy', 'unknown', updated_at, 'open',
 CASE WHEN state = 'dismissed' THEN 'dismissed' ELSE 'visible' END, id, true FROM thread
WHERE kind = 'pushed' AND connector NOT IN ('clew', 'calendar') AND topic IS NOT NULL ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO audit (actor, action, subject, details)
SELECT 'system:migration', 'work.legacy_retained', 'thread:' || thread_id, '{"identity":"unverified","sourceCompletionInferred":false}'::jsonb
FROM work_occurrence WHERE assignment = 'legacy-unverified';
