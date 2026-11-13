CREATE TABLE "dialogue_note" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"area_key" text NOT NULL,
	"author_id" text NOT NULL,
	"text_sealed" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dialogue_note" ADD CONSTRAINT "dialogue_note_author_id_auth_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dialogue_note_author_unit" ON "dialogue_note" USING btree ("author_id","unit_id");--> statement-breakpoint
-- The browser-change signal (D46) for a note: it names only its author, whose other windows see it change at commit.
-- The function of 0054 is replaced whole so that it reads the author of a note as it reads the author of an assessment.
CREATE OR REPLACE FUNCTION clew_dialogue_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME IN ('dialogue_assessment', 'dialogue_note') THEN
      ids := ids || ARRAY[OLD.author_id];
    ELSE
      ids := ids || ARRAY[OLD.owner_id, OLD.created_by, OLD.done_by];
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME IN ('dialogue_assessment', 'dialogue_note') THEN
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
CREATE CONSTRAINT TRIGGER dialogue_note_content_changed AFTER INSERT OR UPDATE OR DELETE ON dialogue_note
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_dialogue_changed();
