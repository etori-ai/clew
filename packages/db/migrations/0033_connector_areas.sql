-- 0032 updates connector rows; see its note on the deferred trigger.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "connector" ADD COLUMN "areas" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;