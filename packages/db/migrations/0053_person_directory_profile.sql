-- As in 0030, 0032 and 0054: Drizzle runs every pending migration in one transaction, and the change-signal trigger
-- of 0019 on auth_person is deferred, so the events the UPDATE below queues for every person who holds a number would
-- make the DROP COLUMN after it fail with "pending trigger events" (55006). Fire queued events now and keep them
-- immediate through the UPDATE; the signals are notifications and lose nothing by going out earlier. A database that
-- applied this migration before the fix is unaffected: Drizzle runs only the migrations newer than the last one it
-- recorded and compares no file's hash.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "phone_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "employments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "auth_person"
SET "phone_numbers" =
  (CASE WHEN "work_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'work', 'value', "work_phone")) END)
  || (CASE WHEN "mobile_phone" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('type', 'mobile', 'value', "mobile_phone")) END)
WHERE "work_phone" IS NOT NULL OR "mobile_phone" IS NOT NULL;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "work_phone";--> statement-breakpoint
ALTER TABLE "auth_person" DROP COLUMN "mobile_phone";