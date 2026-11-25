-- The conversation's state (batch 13). `content_change` holds installation-wide content counters (WD-L8);
-- `thread_message_turn` writes a question's turn key once, so a question sent again is answered with the turn already
-- written and never asked twice (WD-L3); `thread_conversation_recent` serves Alla samtal's pages, the latest activity
-- first (WD-L1).
CREATE TABLE "content_change" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "thread_message_turn" ON "thread_message" USING btree (("meta"->>'turn')) WHERE "thread_message"."role" = 'user' AND ("thread_message"."meta"->>'turn') IS NOT NULL;--> statement-breakpoint
CREATE INDEX "thread_conversation_recent" ON "thread" USING btree ("person_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "thread"."kind" = 'question';--> statement-breakpoint
-- A source's read under Administration › Kompetens › Källor (WD-L8): what that page draws of it (the read under way,
-- its end, its outcome and counts) moves `content_change('competence-source')` at commit, deferred as 0019 publishes
-- the other counters, and the change stream folds the counter into the revision of everyone who may see the page. A
-- lease renewed between pages draws nothing new and moves nothing. Hand-written, as 0018's triggers are.
CREATE FUNCTION clew_competence_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.source, OLD.run, OLD.claimed_at, OLD.started_at, OLD.finished_at, OLD.outcome, OLD.counts)
      IS NOT DISTINCT FROM (NEW.source, NEW.run, NEW.claimed_at, NEW.started_at, NEW.finished_at, NEW.outcome, NEW.counts)
      THEN RETURN NULL;
    END IF;
  END IF;
  INSERT INTO content_change(id, revision) VALUES ('competence-source', 1)
    ON CONFLICT(id) DO UPDATE SET revision = content_change.revision + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_source_changed AFTER INSERT OR UPDATE OR DELETE ON competence_source
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_competence_source_changed();
