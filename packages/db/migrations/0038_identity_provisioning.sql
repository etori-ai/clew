CREATE TABLE "auth_assignment" (
	"person_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "auth_assignment_person_id_unit_id_pk" PRIMARY KEY("person_id","unit_id"),
	CONSTRAINT "auth_assignment_role" CHECK ("auth_assignment"."role" IN ('manager', 'employee'))
);
--> statement-breakpoint
CREATE TABLE "auth_capability_map" (
	"group_external_id" text NOT NULL,
	"capability" text NOT NULL,
	CONSTRAINT "auth_capability_map_group_external_id_capability_pk" PRIMARY KEY("group_external_id","capability")
);
--> statement-breakpoint
CREATE TABLE "auth_group_member" (
	"group_external_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "auth_group_member_group_external_id_person_id_pk" PRIMARY KEY("group_external_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "auth_group" (
	"external_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
-- auth_person carries the deferred policy-change trigger of 0018/0019; fire queued events before altering it (as 0030 did).
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "email" text;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
ALTER TABLE "auth_assignment" ADD CONSTRAINT "auth_assignment_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_assignment" ADD CONSTRAINT "auth_assignment_unit_id_auth_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."auth_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_group_member" ADD CONSTRAINT "auth_group_member_group_external_id_auth_group_external_id_fk" FOREIGN KEY ("group_external_id") REFERENCES "public"."auth_group"("external_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_group_member" ADD CONSTRAINT "auth_group_member_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_group_member_person" ON "auth_group_member" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_external_id" ON "auth_person" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_user_name" ON "auth_person" USING btree ("user_name");--> statement-breakpoint
-- Backfill (D68): every unit the grants know becomes a unit row, and every grant the one assignment it stands for. The
-- grant stays as the derived active assignment. Idempotent, so a rerun on a database that already has them changes nothing.
INSERT INTO "auth_unit" ("id", "organisation_id", "label")
SELECT DISTINCT ON (g."unit_id") g."unit_id", p."organisation_id", g."unit_label"
FROM "auth_access_grant" g JOIN "auth_person" p ON p."id" = g."person_id"
ORDER BY g."unit_id", g."unit_label"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "auth_assignment" ("person_id", "unit_id", "role")
SELECT g."person_id", g."unit_id", g."role" FROM "auth_access_grant" g
ON CONFLICT ("person_id", "unit_id") DO NOTHING;
