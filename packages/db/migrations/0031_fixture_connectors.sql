DROP TABLE "module_state" CASCADE;--> statement-breakpoint
-- The fixture systems are connectors of their own now (D61): their bundled rows go, and `bun run dev:connectors` registers
-- the services under the same ids. Cards, executions, bindings and audit rows stay; the connector ids they carry are unchanged.
DELETE FROM connector WHERE bundled AND id IN ('hr', 'finance', 'incidents', 'communication', 'timesheet', 'payroll');
