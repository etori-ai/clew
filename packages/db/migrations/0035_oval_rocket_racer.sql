CREATE TABLE "mcp_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"read_tools" jsonb NOT NULL,
	"write_tools" jsonb NOT NULL,
	"watch" jsonb NOT NULL,
	"last_key" text
);
--> statement-breakpoint
CREATE TABLE "mcp_decision" (
	"id" text NOT NULL,
	"person_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"digest" text NOT NULL,
	"state" text NOT NULL,
	"result" text,
	CONSTRAINT "mcp_decision_person_id_id_pk" PRIMARY KEY("person_id","id")
);
--> statement-breakpoint
CREATE TABLE "mcp_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_decision" ADD CONSTRAINT "mcp_decision_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_decision" ADD CONSTRAINT "mcp_decision_connection_id_mcp_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_delivery" ADD CONSTRAINT "mcp_delivery_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_delivery" ADD CONSTRAINT "mcp_delivery_connection_id_mcp_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connection"("id") ON DELETE no action ON UPDATE no action;