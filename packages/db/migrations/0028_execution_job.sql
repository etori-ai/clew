CREATE TABLE "execution_job" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"person_id" text NOT NULL,
	"principal" text NOT NULL,
	"unit_id" text NOT NULL,
	"authorization_version" text NOT NULL,
	"digest" text NOT NULL,
	"steps" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follow_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"capability" text NOT NULL,
	"audience" jsonb NOT NULL,
	"within" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_job" ADD CONSTRAINT "execution_job_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_job_decision" ON "execution_job" USING btree ("person_id","decision_id");--> statement-breakpoint
CREATE INDEX "execution_job_person" ON "execution_job" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "follow_binding_kind" ON "follow_binding" USING btree ("kind");