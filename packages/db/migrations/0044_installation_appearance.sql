CREATE TABLE "installation_appearance" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"theme" jsonb,
	"logo_alt" text,
	"logo_light_type" text,
	"logo_light" text,
	"logo_dark_type" text,
	"logo_dark" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "installation_appearance_logo" CHECK (("installation_appearance"."logo_light" IS NULL) = ("installation_appearance"."logo_alt" IS NULL) AND ("installation_appearance"."logo_light" IS NULL) = ("installation_appearance"."logo_light_type" IS NULL) AND ("installation_appearance"."logo_dark" IS NULL) = ("installation_appearance"."logo_dark_type" IS NULL) AND ("installation_appearance"."logo_dark" IS NULL OR "installation_appearance"."logo_light" IS NOT NULL))
);
