-- D101: a group-capability row belongs to the organisation whose administrator wrote it. A row takes the organisation
-- of the group it names; a row whose group is gone cannot be given one and is removed (nothing is launched, and such a
-- row is exactly what another organisation's group of the same id would have picked up).
ALTER TABLE "auth_group_capability" DROP CONSTRAINT "auth_group_capability_group_external_id_capability_pk";--> statement-breakpoint
ALTER TABLE "auth_group_capability" ADD COLUMN "organisation_id" text;--> statement-breakpoint
UPDATE "auth_group_capability" AS c SET "organisation_id" = g."organisation_id" FROM "auth_group" AS g WHERE g."external_id" = c."group_external_id";--> statement-breakpoint
DELETE FROM "auth_group_capability" WHERE "organisation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_group_capability" ALTER COLUMN "organisation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_group_capability" ADD CONSTRAINT "auth_group_capability_organisation_id_group_external_id_capability_pk" PRIMARY KEY("organisation_id","group_external_id","capability");
