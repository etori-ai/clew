-- D108 item 6, amended: a requirement and a share target name a position by its code in the organisation and a unit by
-- the id of its `unit:` key, not by a row of `auth_position` or `auth_unit`. A position group removed and pushed again
-- (a new row) or a unit nobody is placed on (no `auth_unit` row) no longer loses or bars them. Existing rows keep their
-- position through its code.
ALTER TABLE "competence_requirement" DROP CONSTRAINT "competence_requirement_target";--> statement-breakpoint
ALTER TABLE "competence_requirement" DROP CONSTRAINT "competence_requirement_position_id_auth_position_id_fk";
--> statement-breakpoint
ALTER TABLE "competence_requirement" DROP CONSTRAINT "competence_requirement_unit_id_auth_unit_id_fk";
--> statement-breakpoint
ALTER TABLE "competence_share_target" DROP CONSTRAINT "competence_share_target_position_id_auth_position_id_fk";
--> statement-breakpoint
ALTER TABLE "competence_share_target" DROP CONSTRAINT "competence_share_target_unit_id_auth_unit_id_fk";
--> statement-breakpoint
DROP INDEX "competence_requirement_position";--> statement-breakpoint
DROP INDEX "competence_share_target_unit";--> statement-breakpoint
DROP INDEX "competence_share_target_organisation";--> statement-breakpoint
ALTER TABLE "competence_requirement" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_share_target" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD COLUMN "position_code" text;--> statement-breakpoint
ALTER TABLE "competence_share_target" ADD COLUMN "position_code" text;--> statement-breakpoint
UPDATE "competence_requirement" SET "position_code" = "auth_position"."code" FROM "auth_position" WHERE "auth_position"."id" = "competence_requirement"."position_id";--> statement-breakpoint
UPDATE "competence_share_target" SET "position_code" = "auth_position"."code" FROM "auth_position" WHERE "auth_position"."id" = "competence_share_target"."position_id";--> statement-breakpoint
ALTER TABLE "competence_share_target" ALTER COLUMN "position_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "competence_requirement" DROP COLUMN "position_id";--> statement-breakpoint
ALTER TABLE "competence_share_target" DROP COLUMN "position_id";--> statement-breakpoint
CREATE UNIQUE INDEX "competence_requirement_position" ON "competence_requirement" USING btree ("type_id","position_code") WHERE "competence_requirement"."position_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_share_target_unit" ON "competence_share_target" USING btree ("type_id","position_code","unit_id") WHERE "competence_share_target"."unit_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_share_target_organisation" ON "competence_share_target" USING btree ("organisation_id","type_id","position_code") WHERE "competence_share_target"."unit_id" IS NULL;--> statement-breakpoint
ALTER TABLE "competence_requirement" ADD CONSTRAINT "competence_requirement_target" CHECK (num_nonnulls("competence_requirement"."position_code", "competence_requirement"."unit_id", "competence_requirement"."person_id") = 1);