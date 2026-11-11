CREATE TABLE "thread_subject" (
	"thread_id" text NOT NULL,
	"person_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "thread_subject_thread_id_entity_key_pk" PRIMARY KEY("thread_id","entity","key")
);
--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "subjects" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thread_subject" ADD CONSTRAINT "thread_subject_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_subject_owner" ON "thread_subject" USING btree ("person_id","entity","key");--> statement-breakpoint
CREATE INDEX "thread_subject_entity" ON "thread_subject" USING btree ("entity","key");