-- D108 item 7: a person registers their own holding, stored pending with evidence `self`, and the manager they report
-- to approves or rejects it. `decided_by` and `decided_at` are the decision (the manager's attestation); `thread_id` is
-- the approval's key, from which each manager's card is named and found by its topic (the partial index on `thread`).
-- Only a person's own registration waits, is rejected or is decided, and one per person and type waits at a time.
ALTER TABLE "competence_holding" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_decided_by_auth_person_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_holding_pending" ON "competence_holding" USING btree ("person_id","type_id") WHERE "competence_holding"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "thread_competence_topic" ON "thread" USING btree ("topic") WHERE "thread"."connector" = 'competence';--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_own" CHECK ("competence_holding"."state" NOT IN ('pending', 'rejected') OR "competence_holding"."evidence" = 'self');--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_decided" CHECK (("competence_holding"."decided_by" IS NULL OR "competence_holding"."decided_at" IS NOT NULL) AND ("competence_holding"."thread_id" IS NULL OR "competence_holding"."evidence" = 'self') AND CASE WHEN "competence_holding"."evidence" = 'self' THEN ("competence_holding"."state" = 'pending') = ("competence_holding"."decided_at" IS NULL) ELSE "competence_holding"."decided_at" IS NULL END);