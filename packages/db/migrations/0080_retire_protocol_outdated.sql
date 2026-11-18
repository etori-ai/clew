-- Protocol 2 is retired (D129) and the health status `protocol-outdated` with it. A row that still holds it is set to
-- `untested`, which the next load or check of the connector replaces.
UPDATE "connector" SET "health" = jsonb_build_object('status', 'untested', 'at', "health"->>'at') WHERE "health"->>'status' = 'protocol-outdated';
