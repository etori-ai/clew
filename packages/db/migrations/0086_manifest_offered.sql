ALTER TABLE "connector" ADD COLUMN "manifest_offered" jsonb;--> statement-breakpoint
ALTER TABLE "connector" ADD COLUMN "manifest_offered_at" timestamp with time zone;