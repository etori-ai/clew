CREATE TABLE "auth_employment" (
	"person_id" text NOT NULL,
	"position" integer NOT NULL,
	"unit_id" text NOT NULL,
	"manager_id" text,
	"title" text,
	"employment_type" text,
	"start_date" date,
	"employment_percentage" double precision,
	CONSTRAINT "auth_employment_person_id_position_pk" PRIMARY KEY("person_id","position"),
	CONSTRAINT "auth_employment_not_own_manager" CHECK ("auth_employment"."manager_id" IS DISTINCT FROM "auth_employment"."person_id")
);
--> statement-breakpoint
ALTER TABLE "auth_employment" ADD CONSTRAINT "auth_employment_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_employment" ADD CONSTRAINT "auth_employment_manager_id_auth_person_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_employment_manager" ON "auth_employment" USING btree ("manager_id");--> statement-breakpoint
-- D147: the employments each person carried in the list column become rows, in the list's order. No list held a
-- manager, so none is written. A start date or a percentage the list held in a form the columns do not take is left
-- out, as one Clew cannot read is when it is sent.
INSERT INTO "auth_employment" ("person_id", "position", "unit_id", "title", "employment_type", "start_date", "employment_percentage")
SELECT
	p."id",
	(job.ordinality - 1)::integer,
	job.value ->> 'unitId',
	job.value ->> 'title',
	job.value ->> 'employmentType',
	CASE WHEN job.value ->> 'startDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		AND pg_input_is_valid(job.value ->> 'startDate', 'date')
		THEN (job.value ->> 'startDate')::date END,
	CASE WHEN jsonb_typeof(job.value -> 'employmentPercentage') = 'number'
		AND (job.value -> 'employmentPercentage') BETWEEN '0'::jsonb AND '100'::jsonb
		AND pg_input_is_valid(job.value ->> 'employmentPercentage', 'double precision')
		THEN (job.value ->> 'employmentPercentage')::double precision END
FROM "auth_person" p
CROSS JOIN LATERAL jsonb_array_elements(p."employments") WITH ORDINALITY AS job(value, ordinality)
WHERE jsonb_typeof(p."employments") = 'array' AND job.value ->> 'unitId' IS NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "employments";
