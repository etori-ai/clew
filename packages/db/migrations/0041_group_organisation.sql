ALTER TABLE "auth_group" ADD COLUMN "organisation_id" text;--> statement-breakpoint
-- Backfill (SCIM review finding 6): a group belongs to the organisation of the provisioner that pushed it. Existing rows
-- take their members' organisation, else the active provisioner's, else the one organisation the people have.
UPDATE "auth_group" g SET "organisation_id" = COALESCE(
  (SELECT p."organisation_id" FROM "auth_group_member" m JOIN "auth_person" p ON p."id" = m."person_id"
   WHERE m."group_id" = g."id" ORDER BY p."organisation_id" LIMIT 1),
  (SELECT pr."organisation_id" FROM "auth_provisioner" pr WHERE pr."revoked_at" IS NULL ORDER BY pr."created_at" LIMIT 1),
  (SELECT p."organisation_id" FROM "auth_person" p ORDER BY p."organisation_id" LIMIT 1)
) WHERE g."organisation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_group" ALTER COLUMN "organisation_id" SET NOT NULL;
