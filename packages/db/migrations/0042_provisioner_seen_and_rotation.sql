ALTER TABLE "auth_provisioner" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_provisioner" ADD COLUMN "previous_token_digest" text;--> statement-breakpoint
ALTER TABLE "auth_provisioner" ADD COLUMN "previous_valid_until" timestamp with time zone;