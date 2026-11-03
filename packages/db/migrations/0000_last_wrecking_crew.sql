CREATE TABLE "auth_access_grant" (
	"person_id" text PRIMARY KEY NOT NULL,
	"unit_id" text NOT NULL,
	"unit_label" text NOT NULL,
	"role" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "auth_grant_role" CHECK ("auth_access_grant"."role" IN ('manager', 'employee'))
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_identity_binding" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "auth_identity_binding_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_status" CHECK ("job"."status" IN ('due', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "auth_login_transaction" (
	"digest" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"verifier" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_logout_receipt" (
	"issuer" text NOT NULL,
	"jti" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_logout_receipt_issuer_jti_pk" PRIMARY KEY("issuer","jti")
);
--> statement-breakpoint
CREATE TABLE "auth_person" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"person_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"participant_email" text NOT NULL,
	"participant_name" text NOT NULL,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"event_uid" text,
	"event_ref" text,
	"event_revision" text,
	"confirmed_at" timestamp with time zone,
	"undo_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_status" CHECK ("proposal"."status" IN ('proposed', 'confirmed', 'final', 'undone', 'declined', 'superseded')),
	CONSTRAINT "proposal_interval" CHECK ("proposal"."end" > "proposal"."start")
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"digest" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"sid" text,
	"client_id" text NOT NULL,
	"csrf" text NOT NULL,
	"tokens" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "thread_message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_message_role" CHECK ("thread_message"."role" IN ('assistant', 'user'))
);
--> statement-breakpoint
CREATE TABLE "thread" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"trigger" jsonb NOT NULL,
	"week" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "thread_kind" CHECK ("thread"."kind" IN ('pushed', 'question')),
	CONSTRAINT "thread_state" CHECK ("thread"."state" IN ('open', 'handled', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "auth_access_grant" ADD CONSTRAINT "auth_access_grant_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identity_binding" ADD CONSTRAINT "auth_identity_binding_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_message" ADD CONSTRAINT "thread_message_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_subject" ON "audit" USING btree ("subject","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_issuer" ON "auth_identity_binding" USING btree ("issuer","person_id");--> statement-breakpoint
CREATE INDEX "job_due" ON "job" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "proposal_thread" ON "proposal" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "proposal_person_status" ON "proposal" USING btree ("person_id","status");--> statement-breakpoint
CREATE INDEX "auth_session_sid" ON "auth_session" USING btree ("issuer","client_id","sid");--> statement-breakpoint
CREATE INDEX "thread_message_thread" ON "thread_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "thread_person_state" ON "thread" USING btree ("person_id","state","created_at");