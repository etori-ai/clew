-- The menu is chosen per view (D40): the connector-wide switch becomes `menu: true` on the capability the manifest's
-- row named, and the manifest's top-level `menu` (a shape that no longer exists) is taken out of the stored copy.
UPDATE "connector" SET "capabilities" = jsonb_set("capabilities", ARRAY["manifest"->'menu'->>'capability'], COALESCE("capabilities"->("manifest"->'menu'->>'capability'), '{}'::jsonb) || '{"menu": true}'::jsonb, true) WHERE "menu_enabled" AND "manifest"->'menu'->>'capability' IS NOT NULL;--> statement-breakpoint
UPDATE "connector" SET "manifest" = "manifest" - 'menu' WHERE "manifest"->'menu' IS NOT NULL;--> statement-breakpoint
ALTER TABLE "connector" DROP COLUMN "menu_enabled";
