ALTER TABLE "auth_person" ADD COLUMN "phone_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "employments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "auth_person"
SET "phone_numbers" =
  (CASE WHEN "work_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'work', 'value', "work_phone")) END)
  || (CASE WHEN "mobile_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'mobile', 'value', "mobile_phone")) END)
WHERE "work_phone" IS NOT NULL OR "mobile_phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "work_phone";--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "mobile_phone";