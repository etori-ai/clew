CREATE TABLE "dialogue_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"area_key" text NOT NULL,
	"owner_id" text,
	"text_sealed" text NOT NULL,
	"due_on" date,
	"done_at" timestamp with time zone,
	"done_by" text,
	"done_note_sealed" text,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"thread_id" text
);
--> statement-breakpoint
CREATE TABLE "dialogue_area" (
	"organisation_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"measure" text,
	"info" text,
	"dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "dialogue_area_organisation_id_key_pk" PRIMARY KEY("organisation_id","key"),
	CONSTRAINT "dialogue_area_kind" CHECK ("dialogue_area"."kind" IN ('measured', 'assessed'))
);
--> statement-breakpoint
CREATE TABLE "dialogue_assessment" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"area_key" text NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"tone" text NOT NULL,
	"comment_sealed" text,
	"author_id" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "dialogue_assessment_tone" CHECK ("dialogue_assessment"."tone" IN ('ok', 'warn', 'alert'))
);
--> statement-breakpoint
CREATE TABLE "dialogue_question" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"area_key" text NOT NULL,
	"unit_id" text,
	"heading" text,
	"text" text NOT NULL,
	"based_on" text,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dialogue_activity" ADD CONSTRAINT "dialogue_activity_owner_id_auth_person_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_activity" ADD CONSTRAINT "dialogue_activity_done_by_auth_person_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_activity" ADD CONSTRAINT "dialogue_activity_created_by_auth_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_activity" ADD CONSTRAINT "dialogue_activity_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_assessment" ADD CONSTRAINT "dialogue_assessment_author_id_auth_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dialogue_activity_unit" ON "dialogue_activity" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "dialogue_activity_thread" ON "dialogue_activity" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "dialogue_activity_owner_open" ON "dialogue_activity" USING btree ("owner_id") WHERE "dialogue_activity"."done_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dialogue_assessment_unit" ON "dialogue_assessment" USING btree ("unit_id","area_key","dimension","at");--> statement-breakpoint
CREATE INDEX "dialogue_question_area" ON "dialogue_question" USING btree ("organisation_id","area_key");--> statement-breakpoint
-- The browser-change signal (D46) for the dialogue: every person a row names sees it change at commit. An activity
-- names its owner, who added it and who marked it done; an assessment its author. Old and new rows both count, and
-- counters are bumped in id order, so two transactions that touch the same people take their locks in the same order.
CREATE FUNCTION clew_dialogue_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME = 'dialogue_assessment' THEN
      ids := ids || ARRAY[OLD.author_id];
    ELSE
      ids := ids || ARRAY[OLD.owner_id, OLD.created_by, OLD.done_by];
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'dialogue_assessment' THEN
      ids := ids || ARRAY[NEW.author_id];
    ELSE
      ids := ids || ARRAY[NEW.owner_id, NEW.created_by, NEW.done_by];
    END IF;
  END IF;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_activity_content_changed AFTER INSERT OR UPDATE OR DELETE ON dialogue_activity
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_dialogue_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_assessment_content_changed AFTER INSERT OR UPDATE OR DELETE ON dialogue_assessment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_dialogue_changed();
