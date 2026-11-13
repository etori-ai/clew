DROP INDEX "auth_person_external_id";--> statement-breakpoint
DROP INDEX "auth_person_user_name";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_external_id" ON "auth_person" USING btree ("external_id") WHERE "auth_person"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_person_user_name" ON "auth_person" USING btree (lower("user_name" collate "und-x-icu"));