CREATE TABLE "linked_account_later" (
	"person_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "linked_account_later_person_id_connector_id_pk" PRIMARY KEY("person_id","connector_id")
);
--> statement-breakpoint
ALTER TABLE "linked_account" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "linked_account_later" ADD CONSTRAINT "linked_account_later_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;