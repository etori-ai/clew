ALTER TABLE "connector" ADD COLUMN "ordinal" integer;--> statement-breakpoint
-- The systems registered so far take their places in the order they were added (D71); a bundled row has none.
UPDATE connector SET ordinal = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM connector WHERE NOT bundled) AS ranked
WHERE connector.id = ranked.id;
