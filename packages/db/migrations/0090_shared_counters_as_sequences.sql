-- The installation-wide content counters (D46, DE-L10) become one sequence each instead of a row of `content_change`.
-- A row's counter was locked by every transaction that moved it until that transaction's commit had been flushed, so
-- a provisioner's parallel requests, one transaction per person since SCIM has no bulk request, queued on it one by
-- one. `nextval` holds no lock to the commit and is never rolled back: a transaction that rolls back after its signal
-- fired has moved its counter, which costs its readers one read that finds nothing new. A counter's sequence is
-- `content_change_` and its id with underscores (`counterSequence` in `apps/server/src/shared-content.ts`), and the
-- change stream reads its `last_value`. A requirement of one person moves that person's counter instead of everyone's
-- catalogue, and a model moves everyone's `model-menu` only for what a person's model menu draws, while every change
-- to a model or a provider moves the `models` counter of those who administer them. As in 0089, a deferred trigger
-- event still queued from an earlier migration of the same run fires first.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
DROP TABLE "content_change" CASCADE;--> statement-breakpoint
CREATE SEQUENCE content_change_talk_round;--> statement-breakpoint
CREATE SEQUENCE content_change_model_menu;--> statement-breakpoint
CREATE SEQUENCE content_change_competence_catalogue;--> statement-breakpoint
CREATE SEQUENCE content_change_dialogue_setup;--> statement-breakpoint
CREATE SEQUENCE content_change_models;--> statement-breakpoint
CREATE SEQUENCE content_change_connectors;--> statement-breakpoint
CREATE SEQUENCE content_change_competence_source;--> statement-breakpoint
CREATE SEQUENCE content_change_boarding_layers;--> statement-breakpoint
CREATE SEQUENCE content_change_appearance;--> statement-breakpoint
CREATE SEQUENCE content_change_organisation;--> statement-breakpoint
-- Moves the installation counter `counter` at most once a transaction: the flag is the transaction's own setting.
CREATE FUNCTION clew_move_counter(counter text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  moved text := 'clew.changed_' || replace(counter, '-', '_');
BEGIN
  IF current_setting(moved, true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config(moved, 'on', true);
  PERFORM nextval(('content_change_' || replace(counter, '-', '_'))::regclass);
END $$;
--> statement-breakpoint
-- The counter the first argument names, unless an update changed only the columns the further arguments name.
CREATE OR REPLACE FUNCTION clew_shared_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - TG_ARGV[1:] IS NOT DISTINCT FROM to_jsonb(NEW) - TG_ARGV[1:] THEN
    RETURN NULL;
  END IF;
  PERFORM clew_move_counter(TG_ARGV[0]);
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A row aimed at one person, by the column the second argument names, moves that person's content counter, the old
-- row's and the new row's, in id order as `clew_people_changed` takes them; a row aimed at no one person moves the
-- installation counter the first argument names.
CREATE FUNCTION clew_aimed_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  versions jsonb[] := ARRAY[]::jsonb[];
  r jsonb;
  ids text[] := ARRAY[]::text[];
  shared boolean := false;
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    versions := versions || to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    versions := versions || to_jsonb(NEW);
  END IF;
  FOREACH r IN ARRAY versions LOOP
    IF r ->> TG_ARGV[1] IS NULL THEN
      shared := true;
    ELSE
      ids := ids || (r ->> TG_ARGV[1]);
    END IF;
  END LOOP;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  IF shared THEN
    PERFORM clew_move_counter(TG_ARGV[0]);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER "competence_requirement_changed" ON "competence_requirement";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_requirement_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_requirement"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_aimed_changed('competence-catalogue', 'person_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "model_menu_changed" AFTER INSERT OR UPDATE OR DELETE ON "model"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('model-menu', 'model', 'tools', 'reasoning', 'created_by', 'updated_by', 'created_at', 'updated_at', 'version');--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
