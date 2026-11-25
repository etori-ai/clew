CREATE TABLE "linked_account_client" (
	"connector_id" text NOT NULL,
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"secret" text,
	"source" text NOT NULL,
	CONSTRAINT "linked_account_client_connector_id_issuer_pk" PRIMARY KEY("connector_id","issuer")
);
--> statement-breakpoint
CREATE TABLE "linked_account_pending" (
	"state" text PRIMARY KEY NOT NULL,
	"verifier" text NOT NULL,
	"person_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"issuer" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linked_account_server" (
	"connector_id" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"origin" text NOT NULL,
	"issuer" text NOT NULL,
	"authorization_endpoint" text NOT NULL,
	"token_endpoint" text NOT NULL,
	"revocation_endpoint" text,
	"registration_endpoint" text,
	"pkce" boolean NOT NULL,
	"issuer_on_return" boolean NOT NULL,
	"client_documents" boolean NOT NULL,
	"client_id" text,
	"client_secret" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "linked_account_server_origin" CHECK ("linked_account_server"."origin" IN ('discovered', 'entered')),
	CONSTRAINT "linked_account_server_client" CHECK ("linked_account_server"."client_secret" IS NULL OR "linked_account_server"."client_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "linked_account" (
	"person_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"issuer" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text NOT NULL,
	"tokens" text,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "linked_account_person_id_connector_id_pk" PRIMARY KEY("person_id","connector_id"),
	CONSTRAINT "linked_account_state" CHECK ("linked_account"."state" IN ('linked', 'needs-link')),
	CONSTRAINT "linked_account_tokens" CHECK (("linked_account"."state" = 'linked') = ("linked_account"."tokens" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "linked_account_client" ADD CONSTRAINT "linked_account_client_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_account_pending" ADD CONSTRAINT "linked_account_pending_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_account_server" ADD CONSTRAINT "linked_account_server_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_account" ADD CONSTRAINT "linked_account_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linked_account_pending_expires" ON "linked_account_pending" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "linked_account_connector" ON "linked_account" USING btree ("connector_id");