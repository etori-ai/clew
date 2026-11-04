ALTER TABLE "connector" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connector" ALTER COLUMN "secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connector" ADD COLUMN "bundled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connector" ADD CONSTRAINT "connector_remote" CHECK ("connector"."bundled" OR ("connector"."url" IS NOT NULL AND "connector"."secret" IS NOT NULL));