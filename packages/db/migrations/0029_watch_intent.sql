CREATE TABLE "watch_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"step_id" text NOT NULL,
	"person_id" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"checks" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "watch_intent" ADD CONSTRAINT "watch_intent_job_id_execution_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."execution_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_intent" ADD CONSTRAINT "watch_intent_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_intent_due" ON "watch_intent" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "watch_intent_job" ON "watch_intent" USING btree ("job_id");