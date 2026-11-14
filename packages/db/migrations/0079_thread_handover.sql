-- A question conversation can be handed to an assistant of another system: which one, what it was called then, and
-- the source's own key for the conversation it keeps with the person. Null for every thread that was not.
ALTER TABLE "thread" ADD COLUMN "handover" jsonb;