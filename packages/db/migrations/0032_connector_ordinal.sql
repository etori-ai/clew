-- 0030 and 0031 change connector rows, which queues the deferred change-signal trigger of 0019, and Drizzle runs every
-- pending migration in one transaction. As in 0030, the signals fire here so that the table can be altered.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "connector" ADD COLUMN "ordinal" integer;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
-- The systems registered so far take their places in the order they were added (D71); a bundled row has none.
UPDATE connector SET ordinal = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM connector WHERE NOT bundled) AS ranked
WHERE connector.id = ranked.id;
