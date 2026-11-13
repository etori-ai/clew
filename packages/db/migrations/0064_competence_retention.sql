-- D108 item 14: a person's competence is erased a set time after the directory deactivates them. The period is an
-- operator's setting per organisation (`competence_retention`), with no default: while it is unset nothing is scheduled
-- and nothing erased. `competence_erasure` is the competence module's own intent per person (the shared `timer_intent`
-- needs a thread): written in the SCIM transaction that deactivates or activates the person, with the generation of
-- the `competenceErasure` workflow started in the same transaction (D86).
CREATE TABLE "competence_erasure" (
	"person_id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"state" text NOT NULL,
	"inactive_since" timestamp with time zone,
	"due_at" timestamp with time zone,
	"generation" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competence_erasure_state" CHECK ("competence_erasure"."state" IN ('held', 'waiting', 'cancelled', 'erased')),
	CONSTRAINT "competence_erasure_due" CHECK (("competence_erasure"."state" = 'waiting') = ("competence_erasure"."due_at" IS NOT NULL)),
	CONSTRAINT "competence_erasure_since" CHECK ("competence_erasure"."state" NOT IN ('held', 'waiting') OR "competence_erasure"."inactive_since" IS NOT NULL),
	CONSTRAINT "competence_erasure_generation" CHECK ("competence_erasure"."generation" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competence_retention" (
	"organisation_id" text PRIMARY KEY NOT NULL,
	"days" integer NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competence_retention_days" CHECK ("competence_retention"."days" BETWEEN 1 AND 3650)
);
--> statement-breakpoint
ALTER TABLE "competence_erasure" ADD CONSTRAINT "competence_erasure_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competence_erasure_organisation" ON "competence_erasure" USING btree ("organisation_id","state");