-- The fixes of the review of users and the organisation (2026-11-12), in one migration.
--
-- S4: a person's source key is unique only where there is one, so any number of people may hold none. L13: a user
-- name is one name without regard to case under ICU, so Å and å are one letter however the database was created.
DROP INDEX "auth_person_external_id";--> statement-breakpoint
DROP INDEX "auth_person_user_name";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_external_id" ON "auth_person" USING btree ("external_id") WHERE "auth_person"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_user_name" ON "auth_person" USING btree (lower("user_name" collate "und-x-icu"));--> statement-breakpoint
-- D116: the person a started action is about, checked at dispatch against the user name the payload carries.
ALTER TABLE "execution" ADD COLUMN "subject" jsonb;--> statement-breakpoint
-- N3: a proposal names whom it invites by Clew's key, the person's id, beside the address it was drawn with. Nothing is
-- launched and no stored proposal can say which person its address meant, so the ones there are removed, and with them
-- the planning cards whose rows name them: their messages, follow-up policies, timers and deliveries go by cascade, and
-- the next scan draws each card again. A decision on its way for such a card is first retired as a source reset, as
-- `scripts/fixture-maintenance.ts` retires one, so that it never acts on a card that is gone.
UPDATE "execution" SET "state" = CASE WHEN "dispatched_at" IS NULL THEN 'failed' ELSE 'unknown' END, "reason" = 'source-reset', "lease_until" = NULL WHERE "state" IN ('pending', 'running', 'unknown') AND "presentation"->>'threadId' IN (SELECT "id" FROM "thread" WHERE "topic" = 'utvecklingssamtal');--> statement-breakpoint
DELETE FROM "thread" WHERE "topic" = 'utvecklingssamtal';--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "participant_id" text;--> statement-breakpoint
DELETE FROM "proposal" WHERE "participant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "participant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "proposal_participant_status" ON "proposal" USING btree ("participant_id","status");--> statement-breakpoint
-- M1: the approved decision that last took a proposal. While it is pending, running or unknown, another manager's
-- confirmation of the same person is refused (`composition/execution-projection.ts`).
ALTER TABLE "proposal" ADD COLUMN "execution_id" text;
