ALTER TABLE "talk" ADD COLUMN "booked_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talk" ADD COLUMN "booked_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talk" ADD COLUMN "booked_by" text;--> statement-breakpoint
ALTER TABLE "talk" ADD COLUMN "booked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "talk" ADD COLUMN "invitation_id" text;--> statement-breakpoint
ALTER TABLE "talk" ADD CONSTRAINT "talk_booked_by_auth_person_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "talk_invitation" ON "talk" USING btree ("invitation_id");--> statement-breakpoint
ALTER TABLE "talk" ADD CONSTRAINT "talk_booking" CHECK (("talk"."booked_start" IS NULL AND "talk"."booked_end" IS NULL AND "talk"."booked_at" IS NULL AND "talk"."booked_by" IS NULL AND "talk"."invitation_id" IS NULL) OR ("talk"."booked_start" IS NOT NULL AND "talk"."booked_end" IS NOT NULL AND "talk"."booked_at" IS NOT NULL AND "talk"."booked_end" > "talk"."booked_start"));