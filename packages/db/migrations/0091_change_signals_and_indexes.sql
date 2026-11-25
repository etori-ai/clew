-- Indexes for the reads every page load makes (DE-L12), the name indexes folded by ICU (DE-L8), and the change signals
-- for every table the browser draws (DE-L10, D46). `changeSignals` and `unsignalledTables` in `schema.ts` list them;
-- `tests/db/postgres-changes.test.ts` holds this database to the lists. As in 0085, a deferred trigger event still queued
-- from an earlier migration in the same run would refuse an index or a trigger on its table, so they fire first.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
DROP INDEX "delivery_person_due";--> statement-breakpoint
DROP INDEX "boarding_layer_name";--> statement-breakpoint
DROP INDEX "competence_type_name";--> statement-breakpoint
CREATE INDEX "delivery_person_state" ON "attention_delivery" USING btree ("person_id","state","due_at");--> statement-breakpoint
CREATE INDEX "delivery_batch" ON "attention_delivery" USING btree ("batch","state");--> statement-breakpoint
CREATE INDEX "auth_group_organisation_key" ON "auth_group" USING btree ("organisation_id","external_id" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "refresh_person" ON "refresh_request" USING btree ("person_id","connector");--> statement-breakpoint
CREATE INDEX "thread_unresolved" ON "thread" USING btree ("person_id","created_at") WHERE "thread"."kind" = 'pushed' AND ("thread"."state" = 'open' OR coalesce("thread"."execution"->>'state' IN ('pending','running','unknown','partial','failed'), false));--> statement-breakpoint
-- The old name indexes folded with the database's own `lower`, which under the locale C folds only A to Z, so such a
-- database may hold two names that differ only in Å, Ä or Ö case. ICU's index refuses the pair: each is looked for
-- first and named, so the operator can rename one (the runbook's preflight finds them before the upgrade); nothing is
-- renamed here.
DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(format('%s in %s (%s)', names, organisation_id, event), '; ') INTO clash FROM (
    SELECT organisation_id, event, string_agg(quote_literal(name), ' and ' ORDER BY name) AS names
    FROM boarding_layer
    GROUP BY organisation_id, event, lower(name COLLATE "und-x-icu")
    HAVING count(*) > 1
  ) same;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0089 cannot fold the names of boarding_layer by ICU: these layers of one organisation and event differ only in case: %', clash
      USING ERRCODE = 'unique_violation',
        HINT = 'Rename one layer of each pair on Administration › Introduktion, then run bun run db:init again.';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_layer_name" ON "boarding_layer" USING btree ("organisation_id","event",lower("name" collate "und-x-icu"));--> statement-breakpoint
DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(format('%s in %s', names, organisation_id), '; ') INTO clash FROM (
    SELECT organisation_id, string_agg(quote_literal(name), ' and ' ORDER BY name) AS names
    FROM competence_type
    WHERE archived_at IS NULL
    GROUP BY organisation_id, lower(name COLLATE "und-x-icu")
    HAVING count(*) > 1
  ) same;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0089 cannot fold the names of competence_type by ICU: these active types of one organisation differ only in case: %', clash
      USING ERRCODE = 'unique_violation',
        HINT = 'Rename one type of each pair, or merge it into the other, on Administration › Kompetens, then run bun run db:init again.';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "competence_type_name" ON "competence_type" USING btree ("organisation_id",lower("name" collate "und-x-icu")) WHERE "competence_type"."archived_at" IS NULL;--> statement-breakpoint
-- The people a row names, by the columns its trigger's arguments name: each person's content counter, the old row's and
-- the new row's, in id order so two transactions take their counter locks in the same order. It replaces 0043's
-- `clew_talk_changed` and 0054's `clew_dialogue_changed`, which named their columns in the function, where a column
-- added later (a talk's `booked_by`) was missed.
CREATE FUNCTION clew_people_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  becomes jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  ids text[] := ARRAY[]::text[];
  person text;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    ids := ids || ARRAY[was ->> TG_ARGV[i], becomes ->> TG_ARGV[i]];
  END LOOP;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A boarding plan's rows (D124): the plan's person, buddy, starter and holders, and a row's own owner and who marked it
-- done. The plan is read as the transaction leaves it; a row whose plan went with it names only its own people.
CREATE FUNCTION clew_boarding_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  plans text[] := ARRAY[]::text[];
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME = 'boarding_plan' THEN
      ids := ids || ARRAY[OLD.person_id, OLD.buddy_id, OLD.started_by];
      plans := plans || OLD.id;
    ELSIF TG_TABLE_NAME = 'boarding_plan_holder' THEN
      ids := ids || OLD.person_id;
      plans := plans || OLD.plan_id;
    ELSE
      ids := ids || ARRAY[OLD.owner_id, OLD.done_by];
      plans := plans || OLD.plan_id;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'boarding_plan' THEN
      ids := ids || ARRAY[NEW.person_id, NEW.buddy_id, NEW.started_by];
      plans := plans || NEW.id;
    ELSIF TG_TABLE_NAME = 'boarding_plan_holder' THEN
      ids := ids || NEW.person_id;
      plans := plans || NEW.plan_id;
    ELSE
      ids := ids || ARRAY[NEW.owner_id, NEW.done_by];
      plans := plans || NEW.plan_id;
    END IF;
  END IF;
  ids := ids || ARRAY(
    SELECT unnest(ARRAY[p.person_id, p.buddy_id, p.started_by]) FROM boarding_plan p WHERE p.id = ANY(plans)
    UNION ALL
    SELECT h.person_id FROM boarding_plan_holder h WHERE h.plan_id = ANY(plans)
  );
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- An installation-wide content counter (`content_change`), named by the first argument, which `composition/changes.ts`
-- folds into the revision of those who may see it. Once a transaction: a provisioner's push of a thousand rows moves it
-- once. An update that changed only the columns the further arguments name moves nothing. It replaces 0087's
-- `clew_competence_source_changed`, whose column list is now its trigger's one argument, `lease_until`.
CREATE FUNCTION clew_shared_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  moved text := 'clew.changed_' || replace(TG_ARGV[0], '-', '_');
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - TG_ARGV[1:] IS NOT DISTINCT FROM to_jsonb(NEW) - TG_ARGV[1:] THEN
    RETURN NULL;
  END IF;
  IF current_setting(moved, true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config(moved, 'on', true);
  INSERT INTO content_change(id, revision) VALUES (TG_ARGV[0], 1)
    ON CONFLICT(id) DO UPDATE SET revision = content_change.revision + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- A connector's row moves everyone's policy counter unless only the columns its trigger's arguments name changed: the
-- whole row is compared, so its areas, its place in the rail and the shared header, which 0018's list of columns
-- missed, count, and so does a column added later.
CREATE OR REPLACE FUNCTION clew_connector_policy_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - TG_ARGV IS NOT DISTINCT FROM to_jsonb(NEW) - TG_ARGV THEN
    RETURN NULL;
  END IF;
  INSERT INTO policy_change(id, revision) VALUES ('installation', 1)
    ON CONFLICT(id) DO UPDATE SET revision = policy_change.revision + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "execution_job_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "execution_job"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "proposal_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "proposal"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "model_choice_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "model_choice"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_holding_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_holding"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('person_id', 'registered_by', 'decided_by', 'validated_by', 'revoked_by');--> statement-breakpoint
DROP TRIGGER "talk_content_changed" ON "talk";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "talk_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "talk"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('employee_id', 'held_by', 'booked_by');--> statement-breakpoint
DROP TRIGGER "talk_commitment_content_changed" ON "talk_commitment";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "talk_commitment_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "talk_commitment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('employee_id', 'owner_id', 'created_by', 'done_by');--> statement-breakpoint
DROP TRIGGER "dialogue_activity_content_changed" ON "dialogue_activity";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "dialogue_activity_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "dialogue_activity"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('owner_id', 'created_by', 'done_by');--> statement-breakpoint
DROP TRIGGER "dialogue_assessment_content_changed" ON "dialogue_assessment";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "dialogue_assessment_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "dialogue_assessment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('author_id');--> statement-breakpoint
DROP TRIGGER "dialogue_note_content_changed" ON "dialogue_note";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "dialogue_note_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "dialogue_note"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_people_changed('author_id');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "boarding_plan_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "boarding_plan"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_boarding_changed();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "boarding_plan_holder_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "boarding_plan_holder"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_boarding_changed();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "boarding_item_content_changed" AFTER INSERT OR UPDATE OR DELETE ON "boarding_item"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_boarding_changed();--> statement-breakpoint
DROP TRIGGER "connector_policy_changed" ON "connector";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "connector_policy_changed" AFTER INSERT OR UPDATE OR DELETE ON "connector"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_connector_policy_changed('health', 'manifest_offered', 'manifest_offered_at', 'manifest_at', 'secret_changed_at', 'created_by', 'updated_by', 'created_at', 'updated_at', 'version');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "talk_round_changed" AFTER INSERT OR UPDATE OR DELETE ON "talk_round"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('talk-round');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "model_provider_changed" AFTER INSERT OR UPDATE OR DELETE ON "model_provider"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('models');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "model_changed" AFTER INSERT OR UPDATE OR DELETE ON "model"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('models');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_type_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_type"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('competence-catalogue');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_requirement_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_requirement"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('competence-catalogue');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_share_target_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_share_target"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('competence-catalogue');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "dialogue_area_changed" AFTER INSERT OR UPDATE OR DELETE ON "dialogue_area"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('dialogue-setup');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "dialogue_question_changed" AFTER INSERT OR UPDATE OR DELETE ON "dialogue_question"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('dialogue-setup');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "connector_changed" AFTER INSERT OR UPDATE OR DELETE ON "connector"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('connectors');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "follow_binding_changed" AFTER INSERT OR UPDATE OR DELETE ON "follow_binding"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('connectors');--> statement-breakpoint
DROP TRIGGER "competence_source_changed" ON "competence_source";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_source_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_source"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('competence-source', 'lease_until');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competence_source_mapping_changed" AFTER INSERT OR UPDATE OR DELETE ON "competence_source_mapping"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('competence-source');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "boarding_layer_changed" AFTER INSERT OR UPDATE OR DELETE ON "boarding_layer"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('boarding-layers');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "boarding_layer_item_changed" AFTER INSERT OR UPDATE OR DELETE ON "boarding_layer_item"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('boarding-layers');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "installation_appearance_changed" AFTER INSERT OR UPDATE OR DELETE ON "installation_appearance"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('appearance');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_person_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_person"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation', 'updated_at');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_unit_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_unit"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_group_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_group"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation', 'updated_at');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_group_member_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_group_member"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_assignment_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_assignment"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_position_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_position"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_person_position_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_person_position"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_group_capability_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_group_capability"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_group_relation_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_group_relation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "auth_provisioner_changed" AFTER INSERT OR UPDATE OR DELETE ON "auth_provisioner"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_shared_changed('organisation', 'last_seen_at');--> statement-breakpoint
DROP FUNCTION clew_talk_changed();--> statement-breakpoint
DROP FUNCTION clew_dialogue_changed();--> statement-breakpoint
DROP FUNCTION clew_competence_source_changed();--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
