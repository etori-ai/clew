ALTER TABLE "execution" ADD COLUMN "presentation" jsonb;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "execution" jsonb;