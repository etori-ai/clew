ALTER TABLE "execution" ADD COLUMN "approving_session" text;--> statement-breakpoint
ALTER TABLE "execution" ADD COLUMN "checking_session" text;--> statement-breakpoint
ALTER TABLE "refresh_request" ADD COLUMN "session" text;