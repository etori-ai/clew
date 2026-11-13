CREATE TABLE "competence_requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"type_id" text NOT NULL,
	"position_id" text,
	"unit_id" text,
	"person_id" text,
	"min_level" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competence_requirement_target" CHECK (num_nonnulls("competence_requirement"."position_id", "competence_requirement"."unit_id", "competence_requirement"."person_id") = 1),
	CONSTRAINT "competence_requirement_level" CHECK ("competence_requirement"."min_level" IS NULL OR "competence_requirement"."min_level" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "competence_share_target" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"type_id" text NOT NULL,
	"position_id" text NOT NULL,
	"unit_id" text,
	"min_share" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competence_share_target_share" CHECK ("competence_share_target"."min_share" BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD CONSTRAINT "competence_requirement_type_id_competence_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."competence_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD CONSTRAINT "competence_requirement_position_id_auth_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."auth_position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD CONSTRAINT "competence_requirement_unit_id_auth_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."auth_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD CONSTRAINT "competence_requirement_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_share_target" ADD CONSTRAINT "competence_share_target_type_id_competence_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."competence_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_share_target" ADD CONSTRAINT "competence_share_target_position_id_auth_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."auth_position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_share_target" ADD CONSTRAINT "competence_share_target_unit_id_auth_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."auth_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_requirement_position" ON "competence_requirement" USING btree ("type_id","position_id") WHERE "competence_requirement"."position_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_requirement_unit" ON "competence_requirement" USING btree ("type_id","unit_id") WHERE "competence_requirement"."unit_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_requirement_person" ON "competence_requirement" USING btree ("type_id","person_id") WHERE "competence_requirement"."person_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "competence_requirement_organisation" ON "competence_requirement" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competence_share_target_unit" ON "competence_share_target" USING btree ("type_id","position_id","unit_id") WHERE "competence_share_target"."unit_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_share_target_organisation" ON "competence_share_target" USING btree ("organisation_id","type_id","position_id") WHERE "competence_share_target"."unit_id" IS NULL;