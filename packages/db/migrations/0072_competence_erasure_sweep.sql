-- D108 item 14, after review: the erasure timer is a sweep over the intents, not a sleeping workflow per person. An
-- intent is `inactive` from the deactivation until the person is active again or erased; when it falls due follows
-- from `inactive_since` and the organisation's period as it stands, so `due_at` goes, and with it the states `held`
-- and `waiting`. The foreign key to `auth_person` goes too, as `competence_read_log` has none: a write of an intent then
-- takes no lock on the person's row, which the SCIM transaction holds while it tells the leavers port.
ALTER TABLE "competence_erasure" DROP CONSTRAINT "competence_erasure_due";--> statement-breakpoint
ALTER TABLE "competence_erasure" DROP CONSTRAINT "competence_erasure_state";--> statement-breakpoint
ALTER TABLE "competence_erasure" DROP CONSTRAINT "competence_erasure_since";--> statement-breakpoint
ALTER TABLE "competence_erasure" DROP CONSTRAINT "competence_erasure_person_id_auth_person_id_fk";
--> statement-breakpoint
UPDATE "competence_erasure" SET "state" = 'inactive' WHERE "state" IN ('held', 'waiting');--> statement-breakpoint
CREATE INDEX "competence_erasure_inactive" ON "competence_erasure" USING btree ("inactive_since") WHERE "competence_erasure"."state" = 'inactive';--> statement-breakpoint
ALTER TABLE "competence_erasure" DROP COLUMN "due_at";--> statement-breakpoint
ALTER TABLE "competence_erasure" ADD CONSTRAINT "competence_erasure_state" CHECK ("competence_erasure"."state" IN ('inactive', 'cancelled', 'erased'));--> statement-breakpoint
ALTER TABLE "competence_erasure" ADD CONSTRAINT "competence_erasure_since" CHECK ("competence_erasure"."state" <> 'inactive' OR "competence_erasure"."inactive_since" IS NOT NULL);