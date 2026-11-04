ALTER TABLE "proposal" DROP CONSTRAINT "proposal_status";--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "reminders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_status" CHECK ("proposal"."status" IN ('proposed', 'confirmed', 'final', 'accepted', 'declined-by-invitee', 'counter', 'undone', 'declined', 'superseded'));