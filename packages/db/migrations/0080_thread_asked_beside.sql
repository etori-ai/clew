-- A question conversation can be asked in the assistant's pane beside a page (D130): the subject the page gave it,
-- what it is about, and when the person opened it as a conversation. Null for every thread that was not.
ALTER TABLE "thread" ADD COLUMN "asked_beside" jsonb;