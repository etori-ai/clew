ALTER TABLE "auth_session" ADD COLUMN "refresh_claim" text;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "refresh_claim_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_refresh_claim_pair" CHECK (("auth_session"."refresh_claim" is null) = ("auth_session"."refresh_claim_until" is null));