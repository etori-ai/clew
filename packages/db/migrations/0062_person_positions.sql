CREATE TABLE "auth_person_position" (
	"person_id" text NOT NULL,
	"position_id" text NOT NULL,
	CONSTRAINT "auth_person_position_person_id_position_id_pk" PRIMARY KEY("person_id","position_id")
);
--> statement-breakpoint
CREATE TABLE "auth_position" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_person_position" ADD CONSTRAINT "auth_person_position_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_person_position" ADD CONSTRAINT "auth_person_position_position_id_auth_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."auth_position"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_person_position_position" ON "auth_person_position" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_position_code" ON "auth_position" USING btree ("organisation_id","code");