CREATE TABLE "auth_unit_lead" (
	"person_id" text NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "auth_unit_lead_person_id_unit_id_pk" PRIMARY KEY("person_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "auth_assignment" DROP CONSTRAINT "auth_assignment_role";--> statement-breakpoint
ALTER TABLE "auth_unit_lead" ADD CONSTRAINT "auth_unit_lead_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_unit_lead" ADD CONSTRAINT "auth_unit_lead_unit_id_auth_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."auth_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_unit_lead_unit" ON "auth_unit_lead" USING btree ("unit_id");--> statement-breakpoint
-- D149: who leads a unit is a row of its own, and an assignment says only that the person belongs to the unit.
-- Every assignment that said `manager` becomes a row here. It stays an assignment only where an employment or the
-- unit's own group says the person is of the unit: a manager who was on the unit as its manager alone leads it and
-- belongs elsewhere.
INSERT INTO "auth_unit_lead" ("person_id", "unit_id")
SELECT "person_id", "unit_id" FROM "auth_assignment" WHERE "role" = 'manager';--> statement-breakpoint
-- The table's change signal is a deferred constraint trigger (D46), and PostgreSQL refuses to alter a table that has
-- trigger events pending. It is made immediate for the rest of this transaction, so the rows removed here signal at
-- once and the column can be dropped after them.
SET CONSTRAINTS "auth_assignment_changed" IMMEDIATE;--> statement-breakpoint
DELETE FROM "auth_assignment" a
WHERE a."role" = 'manager'
	AND NOT EXISTS (
		SELECT 1 FROM "auth_employment" job WHERE job."person_id" = a."person_id" AND job."unit_id" = a."unit_id"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "auth_group_member" m
		JOIN "auth_group" g ON g."id" = m."group_id"
		WHERE m."person_id" = a."person_id" AND g."external_id" = 'unit:' || a."unit_id"
	);--> statement-breakpoint
ALTER TABLE "auth_assignment" DROP COLUMN "role";--> statement-breakpoint
-- The change signal (D46), hand-written as every such trigger is: who leads a unit is drawn wherever the organisation is.
CREATE CONSTRAINT TRIGGER auth_unit_lead_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_unit_lead DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');--> statement-breakpoint
-- D147: an employment has been a row of its own since 0001. A change of one moves only its person's time of change,
-- which the person's own signal leaves out, so a new title, or another manager named, signalled nothing and an open
-- page kept what it had drawn. The table gets the organisation's signal, as the person's list column had it.
CREATE CONSTRAINT TRIGGER auth_employment_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_employment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
-- A grant is as it was. The unit a person acts as is derived the next time they are written, and whether somebody is a
-- manager because people report to them then or at the next write of anybody whose employment names them.
