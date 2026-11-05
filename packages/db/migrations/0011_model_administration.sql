CREATE TABLE "model_choice" (
	"person_id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text,
	"key_changed_at" timestamp with time zone,
	"health" jsonb DEFAULT '{"status":"untested","at":"1970-01-01T00:00:00.000Z"}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "model_provider_id" CHECK ("model_provider"."id" ~ '^[a-z][a-z0-9-]*$')
);
--> statement-breakpoint
CREATE TABLE "model" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'disabled' NOT NULL,
	"audience" jsonb DEFAULT '{"mode":"all"}'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"tools" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "model_id" CHECK ("model"."id" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "model_state" CHECK ("model"."state" IN ('enabled', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "model_choice" ADD CONSTRAINT "model_choice_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_choice" ADD CONSTRAINT "model_choice_model_id_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_provider_id_model_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."model_provider"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_by_provider" ON "model" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_one_default" ON "model" USING btree ("is_default") WHERE "model"."is_default";