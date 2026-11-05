CREATE TABLE "timer_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"kind" text NOT NULL,
	"generation" integer NOT NULL,
	"unit_id" text NOT NULL,
	"authorization_version" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"delivered_generation" integer,
	"delivered_state" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	CONSTRAINT "timer_intent_state" CHECK ("timer_intent"."state" IN ('active', 'cancelled', 'fired', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "timer_intent" ADD CONSTRAINT "timer_intent_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_intent" ADD CONSTRAINT "timer_intent_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timer_intent_due" ON "timer_intent" USING btree ("next_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timer_intent_slot" ON "timer_intent" USING btree ("thread_id","kind");