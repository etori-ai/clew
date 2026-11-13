CREATE TABLE "boarding_plan_holder" (
	"plan_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "boarding_plan_holder_plan_id_person_id_pk" PRIMARY KEY("plan_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "boarding_plan" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "boarding_plan_holder" ADD CONSTRAINT "boarding_plan_holder_plan_id_boarding_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."boarding_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_plan_holder" ADD CONSTRAINT "boarding_plan_holder_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_plan_holder_person" ON "boarding_plan_holder" USING btree ("person_id");