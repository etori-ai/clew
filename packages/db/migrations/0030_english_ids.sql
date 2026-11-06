ALTER TABLE "thread" ALTER COLUMN "area" SET DEFAULT 'calendar';--> statement-breakpoint
-- English identifiers (D43): `telefonbok` is `phonebook`, `kommunikation` is `communication`, the calendar area `kalender`
-- is `calendar`. Data only, in the manner of 0027; audit rows keep history as written. The stored manifest and the
-- capability keys follow the id, so the registry can still load the row. Swedish labels ("Kommunikation", "Sök i
-- telefonboken") are capitalised or longer words and are untouched by the lowercase patterns.
UPDATE connector SET id = 'phonebook',
  manifest = CASE WHEN manifest IS NULL THEN NULL ELSE regexp_replace(manifest::text, '"telefonbok(?=["\.])', '"phonebook', 'g')::jsonb END,
  capabilities = replace(capabilities::text, '"telefonbok.', '"phonebook.')::jsonb
WHERE id = 'telefonbok' AND NOT EXISTS (SELECT 1 FROM connector WHERE id = 'phonebook');
--> statement-breakpoint
DELETE FROM connector WHERE id = 'telefonbok';
--> statement-breakpoint
UPDATE connector SET id = 'communication',
  manifest = CASE WHEN manifest IS NULL THEN NULL ELSE replace(manifest::text, '"kommunikation', '"communication')::jsonb END,
  capabilities = replace(capabilities::text, '"kommunikation.', '"communication.')::jsonb
WHERE id = 'kommunikation' AND NOT EXISTS (SELECT 1 FROM connector WHERE id = 'communication');
--> statement-breakpoint
DELETE FROM connector WHERE id = 'kommunikation';
--> statement-breakpoint
UPDATE module_state s SET module = 'communication'
WHERE s.module = 'kommunikation' AND NOT EXISTS (SELECT 1 FROM module_state n WHERE n.key = s.key AND n.module = 'communication');
--> statement-breakpoint
DELETE FROM module_state WHERE module = 'kommunikation';
--> statement-breakpoint
UPDATE thread SET
  connector = CASE connector WHEN 'kommunikation' THEN 'communication' WHEN 'telefonbok' THEN 'phonebook' ELSE connector END,
  area = CASE area WHEN 'kalender' THEN 'calendar' ELSE area END,
  topic = replace(topic, 'komm:', 'communication:'),
  items = replace(replace(replace(items::text, '"komm:', '"communication:'), '"kommunikation.', '"communication.'), '"telefonbok.', '"phonebook.')::jsonb,
  actions = replace(replace(replace(actions::text, '"komm:', '"communication:'), '"kommunikation.', '"communication.'), '"telefonbok.', '"phonebook.')::jsonb,
  receipt = CASE WHEN receipt IS NULL THEN NULL ELSE replace(replace(replace(receipt::text, '"komm:', '"communication:'), '"kommunikation.', '"communication.'), '"telefonbok.', '"phonebook.')::jsonb END
WHERE connector IN ('kommunikation', 'telefonbok') OR area = 'kalender' OR topic LIKE 'komm:%'
   OR items::text ~ '"(komm:|kommunikation\.|telefonbok\.)' OR actions::text ~ '"(komm:|kommunikation\.|telefonbok\.)' OR receipt::text ~ '"(komm:|kommunikation\.|telefonbok\.)';
--> statement-breakpoint
UPDATE thread_message SET meta = replace(replace(replace(meta::text, '"komm:', '"communication:'), '"kommunikation.', '"communication.'), '"telefonbok.', '"phonebook.')::jsonb
WHERE meta IS NOT NULL AND meta::text ~ '"(komm:|kommunikation\.|telefonbok\.)';
--> statement-breakpoint
UPDATE execution SET connector = 'communication', operation = regexp_replace(operation, '^kommunikation\.', 'communication.') WHERE connector = 'kommunikation';
--> statement-breakpoint
UPDATE refresh_request SET connector = 'communication' WHERE connector = 'kommunikation';
--> statement-breakpoint
UPDATE work_occurrence SET connector = 'communication', source_key = replace(source_key, 'komm:', 'communication:') WHERE connector = 'kommunikation';
