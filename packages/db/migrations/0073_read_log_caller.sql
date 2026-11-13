-- D122 item 6: a read of one person's holdings that the assistant makes for a manager is logged as a person's is, with
-- the fact that the assistant made it. Every row written before is the person's own. The assistant reads only as
-- `managed` and only one person's holdings (D122 item 5): a row that says it read as a registrar, or searched, or
-- exported, is refused with the read it records.
ALTER TABLE "competence_read_log" ADD COLUMN "caller" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_read_log" ADD CONSTRAINT "competence_read_log_caller" CHECK ("competence_read_log"."caller" = 'person' OR ("competence_read_log"."caller" = 'assistant' AND "competence_read_log"."kind" = 'person' AND "competence_read_log"."relation" = 'managed'));