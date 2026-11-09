DROP INDEX "thread_message_thread";--> statement-breakpoint
ALTER TABLE "thread_message" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "thread_message_thread" ON "thread_message" USING btree ("thread_id","created_at","seq");--> statement-breakpoint
UPDATE "thread_message" m SET "seq" = r.n FROM (SELECT "id", row_number() OVER (ORDER BY "thread_id", "created_at", ("role" = 'user') DESC, "id") AS n FROM "thread_message") r WHERE m."id" = r."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('thread_message', 'seq'), (SELECT COALESCE(max("seq"), 1) FROM "thread_message"));
