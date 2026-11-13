-- D121 with D108 item 15. A group gives its members the relation `registrar` ("Kompetenssökning") by grant, kept apart
-- from the capabilities (D118): `auth_group_relation`, derived with them into `auth_access_grant.relations`, which every
-- person has empty until an administrator maps a group. And the competence domain's read log: one row per read of
-- competence about people (a search across the organisation, its export, one person's holdings opened), ids and counts
-- only, written in the transaction of the read.
CREATE TABLE "competence_read_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"relation" text NOT NULL,
	"kind" text NOT NULL,
	"type_id" text,
	"min_level" integer,
	"unit_id" text,
	"person_id" text,
	"rows" integer NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "competence_read_log_relation" CHECK ("competence_read_log"."relation" IN ('self', 'managed', 'registrar')),
	CONSTRAINT "competence_read_log_kind" CHECK ("competence_read_log"."kind" IN ('search', 'person', 'export')),
	CONSTRAINT "competence_read_log_subject" CHECK (CASE WHEN "competence_read_log"."kind" = 'person' THEN "competence_read_log"."person_id" IS NOT NULL AND "competence_read_log"."type_id" IS NULL AND "competence_read_log"."min_level" IS NULL AND "competence_read_log"."unit_id" IS NULL ELSE "competence_read_log"."type_id" IS NOT NULL AND "competence_read_log"."person_id" IS NULL AND "competence_read_log"."relation" = 'registrar' END),
	CONSTRAINT "competence_read_log_level" CHECK ("competence_read_log"."min_level" IS NULL OR "competence_read_log"."min_level" BETWEEN 1 AND 3),
	CONSTRAINT "competence_read_log_rows" CHECK ("competence_read_log"."rows" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_group_relation" (
	"organisation_id" text NOT NULL,
	"group_external_id" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "auth_group_relation_pk" PRIMARY KEY("organisation_id","group_external_id","relation")
);
--> statement-breakpoint
ALTER TABLE "auth_access_grant" ADD COLUMN "relations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "competence_read_log_organisation" ON "competence_read_log" USING btree ("organisation_id","read_at");--> statement-breakpoint
CREATE INDEX "competence_read_log_person" ON "competence_read_log" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "competence_read_log_reader" ON "competence_read_log" USING btree ("reader_id");