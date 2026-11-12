-- D116: the person a started action is about, checked at dispatch against the user name the payload carries.
ALTER TABLE "execution" ADD COLUMN "subject" jsonb;
