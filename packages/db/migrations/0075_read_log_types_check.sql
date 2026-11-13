-- 0074's check let through a row that names a type and an empty list: an empty array's first element is NULL, the
-- comparison is NULL, and a check that comes to NULL holds. The list must begin with `type_id`, as the memory adapter
-- has always held it.
ALTER TABLE "competence_read_log" DROP CONSTRAINT "competence_read_log_types";--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_types" CHECK (CASE WHEN "competence_read_log"."type_id" IS NULL THEN cardinality("competence_read_log"."type_ids") = 0 ELSE coalesce("competence_read_log"."type_ids"[1] = "competence_read_log"."type_id", false) END);
