CREATE TABLE "handover_turn" (
	"turn" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handover_turn" ADD CONSTRAINT "handover_turn_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;