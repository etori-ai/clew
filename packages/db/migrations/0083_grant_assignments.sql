SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "auth_access_grant" ADD COLUMN "assignments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill (D135): a person with more than one assignment gets every one on their grant, with the unit's label as the
-- unit table holds it, which is the label the derivation wrote there. A person with one keeps the empty list, so their
-- row is not written and their browser is not told of a change. The next derivation of anyone writes what it derives.
UPDATE "auth_access_grant" g
SET "assignments" = held."assignments"
FROM (
  SELECT a."person_id",
    jsonb_agg(jsonb_build_object('unitId', a."unit_id", 'unitLabel', u."label", 'role', a."role") ORDER BY a."unit_id")
      AS "assignments"
  FROM "auth_assignment" a JOIN "auth_unit" u ON u."id" = a."unit_id"
  GROUP BY a."person_id"
  HAVING count(*) > 1
) held
WHERE held."person_id" = g."person_id";--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
