-- The id every copy of a sent invitation's meeting carries (WA-L5): on Microsoft 365 Clew's uid is on the organiser's
-- copy alone, so the invitee's copy is known by Exchange's iCalUId. Invitations sent before this have none and are
-- known as before.
ALTER TABLE "proposal" ADD COLUMN "event_ical_uid" text;