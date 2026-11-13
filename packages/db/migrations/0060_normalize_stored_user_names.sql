-- SCIM and sign-in normalize incoming user names to NFC before comparing them to this column.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
-- Hold writers until the check and update commit together. Readers may continue.
LOCK TABLE auth_person IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth_person
    WHERE user_name IS NOT NULL
    GROUP BY lower(normalize(user_name, NFC) COLLATE "und-x-icu")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Multiple people hold the same normalized SCIM user name.',
      HINT = 'Resolve the conflicting names by person id with the source owner, then retry. See "Upgrading SCIM user names" in the reliability operations guide.';
  END IF;
END $$;--> statement-breakpoint
WITH corrected AS (
  UPDATE auth_person
  SET user_name = normalize(user_name, NFC), updated_at = greatest(updated_at, statement_timestamp())
  WHERE user_name IS NOT NFC NORMALIZED
  RETURNING id
)
INSERT INTO audit (actor, action, subject, details)
SELECT 'system:migration', 'person.user_name_normalized', 'person:' || id, '{}'::jsonb
FROM corrected;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
