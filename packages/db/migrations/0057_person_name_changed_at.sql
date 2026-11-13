-- A SCIM Group resource shows each member's name, so a member's new name is a change of every group that lists them
-- (RFC 7643 §3.1, the mirror of S13 in the 2026-11-12 users review). The person's write records when the name changed,
-- and a group's time of change is read as the later of its own and this time among its current members: a user write
-- that wrote the groups would take them after the person, against the order a group write takes them in. Null where the
-- name has not changed since the row was written; nothing is filled in, since nothing is launched.
ALTER TABLE "auth_person" ADD COLUMN "name_changed_at" timestamp with time zone;
