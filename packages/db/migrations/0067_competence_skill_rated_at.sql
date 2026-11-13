-- D120 with D108 item 12: when a skill's level was last rated, by the person or by a manager's registration. A required
-- skill that stops meeting its requirement is then a new spell, so its card is issued again. A skill rated before this
-- migration is dated by when its row was made.
ALTER TABLE "competence_holding" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "competence_holding" SET "rated_at" = "created_at" WHERE "level" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_rated" CHECK (("competence_holding"."level" IS NULL) = ("competence_holding"."rated_at" IS NULL));
