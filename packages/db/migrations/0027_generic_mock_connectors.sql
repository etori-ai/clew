-- The bundled mocks are generic systems (D52): `hr`, `finance` and `incidents` replace the vendor-named ids.
-- Data only; every table that names a connector or carries its refs follows, the audit log keeps history as written.
UPDATE connector SET id = 'hr' WHERE id = 'heroma' AND bundled AND NOT EXISTS (SELECT 1 FROM connector WHERE id = 'hr');
--> statement-breakpoint
UPDATE connector SET id = 'finance' WHERE id = 'raindance' AND bundled AND NOT EXISTS (SELECT 1 FROM connector WHERE id = 'finance');
--> statement-breakpoint
UPDATE connector SET id = 'incidents' WHERE id = 'treserva' AND bundled AND NOT EXISTS (SELECT 1 FROM connector WHERE id = 'incidents');
--> statement-breakpoint
DELETE FROM connector WHERE bundled AND id IN ('heroma', 'raindance', 'treserva');
--> statement-breakpoint
UPDATE module_state s SET module = CASE s.module WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' ELSE 'incidents' END
WHERE s.module IN ('heroma', 'raindance', 'treserva')
  AND NOT EXISTS (SELECT 1 FROM module_state n WHERE n.key = s.key AND n.module = CASE s.module WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' ELSE 'incidents' END);
--> statement-breakpoint
DELETE FROM module_state WHERE module IN ('heroma', 'raindance', 'treserva');
--> statement-breakpoint
UPDATE thread SET
  connector = CASE connector WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' WHEN 'treserva' THEN 'incidents' ELSE connector END,
  topic = regexp_replace(topic, '^(heroma|raindance|treserva):', CASE split_part(topic, ':', 1) WHEN 'heroma' THEN 'hr:' WHEN 'raindance' THEN 'finance:' ELSE 'incidents:' END),
  trigger = CASE trigger->>'source' WHEN 'Heroma' THEN jsonb_set(trigger, '{source}', '"Personalsystemet"') WHEN 'Raindance' THEN jsonb_set(trigger, '{source}', '"Ekonomisystemet"') WHEN 'Treserva' THEN jsonb_set(trigger, '{source}', '"Avvikelsesystemet"') ELSE trigger END,
  items = replace(replace(replace(replace(replace(replace(items::text, '"heroma:', '"hr:'), '"raindance:', '"finance:'), '"treserva:', '"incidents:'), '"heroma.', '"hr.'), '"raindance.', '"finance.'), '"treserva.', '"incidents.')::jsonb,
  actions = replace(replace(replace(replace(replace(replace(actions::text, '"heroma:', '"hr:'), '"raindance:', '"finance:'), '"treserva:', '"incidents:'), '"heroma.', '"hr.'), '"raindance.', '"finance.'), '"treserva.', '"incidents.')::jsonb,
  receipt = CASE WHEN receipt IS NULL THEN NULL ELSE replace(replace(replace(replace(replace(replace(receipt::text, '"heroma:', '"hr:'), '"raindance:', '"finance:'), '"treserva:', '"incidents:'), '"heroma.', '"hr.'), '"raindance.', '"finance.'), '"treserva.', '"incidents.')::jsonb END
WHERE connector IN ('heroma', 'raindance', 'treserva') OR topic ~ '^(heroma|raindance|treserva):'
   OR items::text ~ '"(heroma|raindance|treserva)[:.]' OR actions::text ~ '"(heroma|raindance|treserva)[:.]' OR receipt::text ~ '"(heroma|raindance|treserva)[:.]';
--> statement-breakpoint
UPDATE thread_message SET meta = replace(replace(replace(replace(replace(replace(replace(replace(replace(meta::text,
  '"heroma:', '"hr:'), '"raindance:', '"finance:'), '"treserva:', '"incidents:'), '"heroma.', '"hr.'), '"raindance.', '"finance.'), '"treserva.', '"incidents.'),
  '"source":"Heroma"', '"source":"Personalsystemet"'), '"source":"Raindance"', '"source":"Ekonomisystemet"'), '"source":"Treserva"', '"source":"Avvikelsesystemet"')::jsonb
WHERE meta IS NOT NULL AND meta::text ~ '"(heroma|raindance|treserva)[:.]|"source":"(Heroma|Raindance|Treserva)"';
--> statement-breakpoint
UPDATE execution SET
  connector = CASE connector WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' ELSE 'incidents' END,
  operation = regexp_replace(operation, '^(heroma|raindance|treserva)\.', CASE connector WHEN 'heroma' THEN 'hr.' WHEN 'raindance' THEN 'finance.' ELSE 'incidents.' END)
WHERE connector IN ('heroma', 'raindance', 'treserva');
--> statement-breakpoint
UPDATE refresh_request SET connector = CASE connector WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' ELSE 'incidents' END WHERE connector IN ('heroma', 'raindance', 'treserva');
--> statement-breakpoint
UPDATE work_occurrence SET connector = CASE connector WHEN 'heroma' THEN 'hr' WHEN 'raindance' THEN 'finance' ELSE 'incidents' END WHERE connector IN ('heroma', 'raindance', 'treserva');
