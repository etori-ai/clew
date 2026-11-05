CREATE TABLE "attention_day" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"used" integer NOT NULL,
	"bucket" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attention_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"kind" text NOT NULL,
	"batch" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attention_day" ADD CONSTRAINT "attention_day_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_delivery" ADD CONSTRAINT "attention_delivery_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attention_delivery" ADD CONSTRAINT "attention_delivery_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_person_due" ON "attention_delivery" USING btree ("person_id","due_at");