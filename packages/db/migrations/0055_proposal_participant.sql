-- N3: a proposal names whom it invites by Clew's key, the person's id, beside the address it was drawn with. Nothing is
-- launched and no stored proposal can say which person its address meant, so the ones there are removed.
ALTER TABLE "proposal" ADD COLUMN "participant_id" text;--> statement-breakpoint
DELETE FROM "proposal" WHERE "participant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "participant_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "proposal_participant_status" ON "proposal" USING btree ("participant_id","status");
