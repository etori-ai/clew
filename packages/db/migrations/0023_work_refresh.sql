CREATE TABLE "refresh_request" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"connector" text NOT NULL,
	"assignment" text NOT NULL,
	"authorization_version" text NOT NULL,
	"state" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"last_success" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "work_occurrence" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"connector" text NOT NULL,
	"assignment" text NOT NULL,
	"source_key" text NOT NULL,
	"period" text NOT NULL,
	"revision" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source_state" text NOT NULL,
	"disposition" text NOT NULL,
	"thread_id" text,
	"legacy" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_request" ADD CONSTRAINT "refresh_request_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_occurrence" ADD CONSTRAINT "work_occurrence_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_occurrence" ADD CONSTRAINT "work_occurrence_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_due" ON "refresh_request" USING btree ("next_at");--> statement-breakpoint
CREATE INDEX "occurrence_scope" ON "work_occurrence" USING btree ("person_id","connector","assignment");--> statement-breakpoint
CREATE INDEX "occurrence_thread" ON "work_occurrence" USING btree ("thread_id");