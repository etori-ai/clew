CREATE TABLE "connector_signing_key" (
	"id" text PRIMARY KEY NOT NULL,
	"kid" text NOT NULL,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_signing_singleton" CHECK ("connector_signing_key"."id" = 'installation')
);
