ALTER TABLE "auth_group" ADD COLUMN "parent_unit_id" text;--> statement-breakpoint
CREATE INDEX "auth_group_parent_unit" ON "auth_group" USING btree ("parent_unit_id");