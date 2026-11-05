CREATE TABLE "followup_policy" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"authorization_version" text NOT NULL,
	"execution_id" text NOT NULL,
	"proposal_ids" jsonb NOT NULL,
	"max_reminders" integer NOT NULL,
	"after_workdays" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	CONSTRAINT "followup_bounds" CHECK ("followup_policy"."max_reminders" BETWEEN 1 AND 2 AND "followup_policy"."after_workdays" >= 2)
);
--> statement-breakpoint
ALTER TABLE "followup_policy" ADD CONSTRAINT "followup_policy_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_policy" ADD CONSTRAINT "followup_policy_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;