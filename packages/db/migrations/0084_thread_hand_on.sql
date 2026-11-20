-- A card can be handed on by the person (D139): `hand_on` is the source's offer (the button's words and whom the card
-- then waits on), `handed_on_to` and `handed_on_at` that the person said so, to whom and when. Null on every other thread.
ALTER TABLE "thread" ADD COLUMN "hand_on" jsonb;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "handed_on_to" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "handed_on_at" timestamp with time zone;