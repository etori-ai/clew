-- Timer delivery and authority changes invalidate the owner's local view at commit.
CREATE CONSTRAINT TRIGGER timer_content_changed AFTER INSERT OR UPDATE OR DELETE ON timer_intent
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_content_changed();
