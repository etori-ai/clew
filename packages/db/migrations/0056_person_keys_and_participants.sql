-- The fixes of the review of users and the organisation (2026-11-12), in one migration.
--
-- As in 0030 and 0032: Drizzle runs every pending migration in one transaction, and the change-signal triggers of 0019,
-- 0021, 0025 and 0043 are deferred, so trigger events queued by an earlier migration's writes would make the index on
-- auth_person below fail with "pending trigger events", and the events this migration's writes queue on execution,
-- thread and what cascades from it would do the same to a later migration that alters those tables. Fire them now and
-- keep them immediate through the writes below; the signals are notifications and lose nothing by going out earlier.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
-- S4: a user write locks the person FOR NO KEY UPDATE, but a plain unique index makes external_id a key to PostgreSQL's
-- row locks, so an UPDATE that changes it needs FOR UPDATE and could deadlock with a group write that had just added the
-- person, whose membership insert holds a key-share lock on them. A partial unique index is no such key, and under the
-- same name a duplicate still answers 409 naming externalId. L13: a user name is one name without regard to case under
-- ICU, so Å and å are one letter however the database was created.
DROP INDEX "auth_person_external_id";--> statement-breakpoint
DROP INDEX "auth_person_user_name";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_external_id" ON "auth_person" USING btree ("external_id") WHERE "auth_person"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_user_name" ON "auth_person" USING btree (lower("user_name" collate "und-x-icu"));--> statement-breakpoint
-- D122: the person a started action is about, checked at dispatch against the user name the payload carries.
ALTER TABLE "execution" ADD COLUMN "subject" jsonb;--> statement-breakpoint
-- N3: a proposal names whom it invites by Clew's key, the person's id, beside the address it was drawn with. Nothing is
-- launched and no stored proposal can say which person its address meant, so the ones there are removed, and with them
-- the planning cards whose rows name them: their messages, follow-up policies, timers and deliveries go by cascade, and
-- the next scan draws each card again. A decision on its way for such a card is first retired as a source reset, as
-- `scripts/fixture-maintenance.ts` retires one, so that it never acts on a card that is gone: it fails if it was never
-- sent and is unknown if it was, its approval expires, its lease and any start not yet handed over end, its attempt
-- moves on so that a worker still holding it cannot finish it, and an `execution.source_reset` row says so. Each card
-- removed gets its `thread.removed` row. The actor of both is `system:migration`, as in 0025 and 0026.
INSERT INTO "audit" ("actor", "action", "subject", "details")
SELECT 'system:migration', 'execution.source_reset', 'execution:' || "id",
  jsonb_build_object('previousState', "state", 'state', CASE WHEN "dispatched_at" IS NULL THEN 'failed' ELSE 'unknown' END, 'dispatched', "dispatched_at" IS NOT NULL)
FROM "execution"
WHERE "reason" IS DISTINCT FROM 'source-reset' AND "state" IN ('pending', 'running', 'unknown')
  AND "presentation"->>'threadId' IN (SELECT "id" FROM "thread" WHERE "topic" = 'utvecklingssamtal');--> statement-breakpoint
UPDATE "dispatch_outbox" SET "delivered_at" = now(), "lease_until" = NULL, "last_error" = 'source-reset'
WHERE "delivered_at" IS NULL AND "execution_id" IN (
  SELECT "id" FROM "execution"
  WHERE "reason" IS DISTINCT FROM 'source-reset' AND "state" IN ('pending', 'running', 'unknown')
    AND "presentation"->>'threadId' IN (SELECT "id" FROM "thread" WHERE "topic" = 'utvecklingssamtal'));--> statement-breakpoint
UPDATE "execution"
SET "state" = CASE WHEN "dispatched_at" IS NULL THEN 'failed' ELSE 'unknown' END, "reason" = 'source-reset',
  "expires_at" = now(), "lease_until" = NULL, "attempt" = "attempt" + 1, "updated_at" = now()
WHERE "reason" IS DISTINCT FROM 'source-reset' AND "state" IN ('pending', 'running', 'unknown')
  AND "presentation"->>'threadId' IN (SELECT "id" FROM "thread" WHERE "topic" = 'utvecklingssamtal');--> statement-breakpoint
INSERT INTO "audit" ("actor", "action", "subject", "details")
SELECT 'system:migration', 'thread.removed', 'thread:' || "id", '{"reason":"migration"}'::jsonb
FROM "thread" WHERE "topic" = 'utvecklingssamtal';--> statement-breakpoint
DELETE FROM "thread" WHERE "topic" = 'utvecklingssamtal';--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "participant_id" text;--> statement-breakpoint
DELETE FROM "proposal" WHERE "participant_id" IS NULL;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "participant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "proposal_participant_status" ON "proposal" USING btree ("participant_id","status");--> statement-breakpoint
-- M1: the approved decision that last took a proposal. While it is pending, running or unknown, another manager's
-- confirmation of the same person is refused (`composition/execution-projection.ts`).
ALTER TABLE "proposal" ADD COLUMN "execution_id" text;
