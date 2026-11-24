-- One holder of the shared header (D88, DE-M5). Two administrators who took it at once could leave two rows holding it;
-- the one changed last keeps it, so the index can be made. Each row that gives it up is changed as the administration
-- page changes one: its version and updated_at move on, so a process still running reads the change and a page that
-- showed the row before is refused with "Anslutningen har ändrats", and it gets a `connector.header` audit row by
-- `system:migration`, as 0056 writes its rows, naming the row that kept it. The audit rows are written first, while the
-- rows still hold it. As in 0032: the UPDATE's deferred trigger events on connector would still be queued when the index
-- is created ("pending trigger events"), so they fire as the UPDATE runs.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
INSERT INTO "audit" ("actor", "action", "subject", "details")
SELECT 'system:migration', 'connector.header', 'connector:' || "connector"."id",
  jsonb_build_object('to', false, 'keptBy', "kept"."id", 'reason', 'migration')
FROM "connector",
  (SELECT "id" FROM "connector" WHERE "header_holder" ORDER BY "updated_at" DESC, "id" LIMIT 1) AS "kept"
WHERE "connector"."header_holder" AND "connector"."id" <> "kept"."id";--> statement-breakpoint
UPDATE "connector"
SET "header_holder" = false, "version" = "version" + 1, "updated_at" = now(), "updated_by" = 'system:migration'
WHERE "header_holder" AND "id" <> (
  SELECT "id" FROM "connector" WHERE "header_holder" ORDER BY "updated_at" DESC, "id" LIMIT 1
);--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_header_holder_one" ON "connector" USING btree ("header_holder") WHERE "connector"."header_holder";
