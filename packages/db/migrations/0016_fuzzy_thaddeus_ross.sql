CREATE TABLE "dispatch_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "execution" (
	"id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"person_id" text NOT NULL,
	"principal" text NOT NULL,
	"unit_id" text NOT NULL,
	"authorization_version" text NOT NULL,
	"connector" text NOT NULL,
	"operation" text NOT NULL,
	"digest" text NOT NULL,
	"payload" text NOT NULL,
	"safety" jsonb NOT NULL,
	"result" text,
	"compensates" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	CONSTRAINT "execution_state" CHECK ("execution"."state" IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "dispatch_outbox" ADD CONSTRAINT "dispatch_outbox_execution_id_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."execution"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution" ADD CONSTRAINT "execution_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dispatch_outbox_due" ON "dispatch_outbox" USING btree ("next_at");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_decision" ON "execution" USING btree ("person_id","decision_id");--> statement-breakpoint
CREATE INDEX "execution_person" ON "execution" USING btree ("person_id","created_at");