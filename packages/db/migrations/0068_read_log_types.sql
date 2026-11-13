-- Kompetenssökning asks for up to five types that a person must all hold. The read log keeps one row per search or file
-- and records every type asked for, in the order chosen, by id: `type_ids`, the first of them also in `type_id` as
-- before, so a row written earlier and a search of one type read the same. Rows from before hold their one type.
ALTER TABLE "competence_read_log" ADD COLUMN "type_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "competence_read_log" SET "type_ids" = ARRAY["type_id"] WHERE "type_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_types" CHECK (CASE WHEN "competence_read_log"."type_id" IS NULL THEN cardinality("competence_read_log"."type_ids") = 0 ELSE "competence_read_log"."type_ids"[1] = "competence_read_log"."type_id" END);
