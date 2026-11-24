-- One holder of the shared header (D88, DE-M5). Two administrators who took it at once could leave two rows holding it;
-- the one changed last keeps it, so the index can be made. As in 0032: the UPDATE's deferred trigger events on connector
-- would still be queued when the index is created ("pending trigger events"), so they fire as the UPDATE runs.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
UPDATE "connector" SET "header_holder" = false
WHERE "header_holder" AND "id" <> (
  SELECT "id" FROM "connector" WHERE "header_holder" ORDER BY "updated_at" DESC, "id" LIMIT 1
);--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_header_holder_one" ON "connector" USING btree ("header_holder") WHERE "connector"."header_holder";
