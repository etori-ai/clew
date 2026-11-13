-- The read log records the filters a search or its file narrowed by, beside the types, the least level and the unit:
-- the statuses asked for (one of the closed list's subsets, in its order, empty for every status) and the validity
-- window in days (30, 90 or 180, NULL for none). Rows from before narrowed by neither: empty and NULL. Only a
-- registrar's search or file carries them. Every check compares whole values, so no NULL slips through (0069).
ALTER TABLE "competence_read_log" ADD COLUMN "status" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD COLUMN "until" integer;--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_status" CHECK ("competence_read_log"."status" IN ('{}'::text[], '{valid}'::text[], '{expiring}'::text[], '{expired}'::text[], '{valid,expiring}'::text[], '{valid,expired}'::text[], '{expiring,expired}'::text[], '{valid,expiring,expired}'::text[]));--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_until" CHECK ("competence_read_log"."until" IS NULL OR "competence_read_log"."until" IN (30, 90, 180));--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_filters" CHECK ((cardinality("competence_read_log"."status") = 0 AND "competence_read_log"."until" IS NULL) OR ("competence_read_log"."relation" = 'registrar' AND "competence_read_log"."kind" IN ('search', 'export')));