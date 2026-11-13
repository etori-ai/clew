-- D120 item 7 with D108 item 2: the catalogue at scale. A type imported from a file keeps the address it came with
-- (`source_uri`, such as an ESCO concept's URI), one per organisation, so an import is idempotent on it. A type merged
-- into another keeps a reference to it (`merged_into`) and is archived; a merge is not undone.
ALTER TABLE "competence_type" ADD COLUMN "source_uri" text;--> statement-breakpoint
ALTER TABLE "competence_type" ADD COLUMN "merged_into" text;--> statement-breakpoint
ALTER TABLE "competence_type" ADD CONSTRAINT "competence_type_merged_into_competence_type_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."competence_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_type_source_uri" ON "competence_type" USING btree ("organisation_id","source_uri") WHERE "competence_type"."source_uri" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_type" ADD CONSTRAINT "competence_type_merged" CHECK ("competence_type"."merged_into" IS NULL OR ("competence_type"."archived_at" IS NOT NULL AND "competence_type"."merged_into" <> "competence_type"."id"));