CREATE TABLE "competence_holding" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"type_id" text NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date,
	"evidence" text NOT NULL,
	"state" text NOT NULL,
	"registered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "competence_holding_evidence" CHECK ("competence_holding"."evidence" IN ('system', 'manager', 'self')),
	CONSTRAINT "competence_holding_state" CHECK ("competence_holding"."state" IN ('pending', 'valid', 'rejected', 'revoked')),
	CONSTRAINT "competence_holding_period" CHECK ("competence_holding"."expires_on" IS NULL OR "competence_holding"."expires_on" >= "competence_holding"."issued_on")
);
--> statement-breakpoint
CREATE TABLE "competence_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"kind" text NOT NULL,
	"validity_months" integer,
	"archived_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competence_type_kind" CHECK ("competence_type"."kind" IN ('certificate', 'degree', 'course', 'authorisation')),
	CONSTRAINT "competence_type_validity" CHECK ("competence_type"."validity_months" IS NULL OR "competence_type"."validity_months" BETWEEN 1 AND 600)
);
--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_type_id_competence_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."competence_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_registered_by_auth_person_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_revoked_by_auth_person_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competence_holding_person" ON "competence_holding" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "competence_holding_type" ON "competence_holding" USING btree ("type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competence_type_name" ON "competence_type" USING btree ("organisation_id",lower("name")) WHERE "competence_type"."archived_at" IS NULL;