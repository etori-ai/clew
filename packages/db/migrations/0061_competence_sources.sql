CREATE TABLE "competence_source_mapping" (
	"connector_id" text NOT NULL,
	"organisation_id" text NOT NULL,
	"source_type" text NOT NULL,
	"type_id" text NOT NULL,
	"mapped_by" text NOT NULL,
	"mapped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competence_source_mapping_pk" PRIMARY KEY("connector_id","organisation_id","source_type")
);
--> statement-breakpoint
CREATE TABLE "competence_source" (
	"connector_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"run" text,
	"claimed_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"counts" jsonb,
	CONSTRAINT "competence_source_outcome" CHECK ("competence_source"."outcome" IS NULL OR "competence_source"."outcome" IN ('complete', 'partial', 'failed')),
	CONSTRAINT "competence_source_claim" CHECK (("competence_source"."run" IS NULL) = ("competence_source"."claimed_at" IS NULL) AND ("competence_source"."run" IS NULL) = ("competence_source"."lease_until" IS NULL)),
	CONSTRAINT "competence_source_last_read" CHECK (("competence_source"."outcome" IS NULL) = ("competence_source"."started_at" IS NULL) AND ("competence_source"."outcome" IS NULL) = ("competence_source"."finished_at" IS NULL) AND ("competence_source"."outcome" IS NULL) = ("competence_source"."counts" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "competence_holding" ALTER COLUMN "type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "connector_id" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competence_source_mapping" ADD CONSTRAINT "competence_source_mapping_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_source_mapping" ADD CONSTRAINT "competence_source_mapping_type_id_competence_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."competence_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_source" ADD CONSTRAINT "competence_source_connector_id_connector_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connector"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_source_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."competence_source"("connector_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_holding_source" ON "competence_holding" USING btree ("connector_id","source_id") WHERE "competence_holding"."connector_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "competence_holding_source_type" ON "competence_holding" USING btree ("connector_id","source_type");--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_copy" CHECK (("competence_holding"."connector_id" IS NULL AND "competence_holding"."source_id" IS NULL AND "competence_holding"."source_type" IS NULL AND "competence_holding"."source_label" IS NULL AND "competence_holding"."read_at" IS NULL) OR ("competence_holding"."connector_id" IS NOT NULL AND "competence_holding"."source_id" IS NOT NULL AND "competence_holding"."source_type" IS NOT NULL AND "competence_holding"."source_label" IS NOT NULL AND "competence_holding"."read_at" IS NOT NULL AND "competence_holding"."evidence" = 'system' AND "competence_holding"."registered_by" IS NULL));--> statement-breakpoint
ALTER TABLE "competence_holding" ADD CONSTRAINT "competence_holding_typed" CHECK ("competence_holding"."type_id" IS NOT NULL OR "competence_holding"."connector_id" IS NOT NULL);