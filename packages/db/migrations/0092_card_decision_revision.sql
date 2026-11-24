ALTER TABLE "thread" ADD COLUMN "decision_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE FUNCTION clew_revise_card_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.decision_revision := OLD.decision_revision + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER thread_decision_revision
BEFORE UPDATE OF title, summary, actions, items, subjects, deadline, waiting_on, state ON thread
FOR EACH ROW WHEN (
  (OLD.title, OLD.summary, OLD.actions, OLD.items, OLD.subjects, OLD.deadline, OLD.waiting_on, OLD.state)
  IS DISTINCT FROM
  (NEW.title, NEW.summary, NEW.actions, NEW.items, NEW.subjects, NEW.deadline, NEW.waiting_on, NEW.state)
)
EXECUTE FUNCTION clew_revise_card_decision();
