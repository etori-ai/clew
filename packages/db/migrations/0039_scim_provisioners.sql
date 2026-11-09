-- SCIM (D68): a client that pushes people and groups, with the digest of its bearer token; a server id on groups so a
-- client can address a group whose externalId it did not set; timestamps for SCIM `meta`. Written by hand over the
-- generated file because drizzle-kit could not order the primary-key move on auth_group; the snapshot is the generated one.
CREATE TABLE "auth_provisioner" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"label" text NOT NULL,
	"digest" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_provisioner_digest" ON "auth_provisioner" USING btree ("digest");--> statement-breakpoint
-- Groups: the external id was the key in 0038; Clew's own id takes over and the external id becomes optional and unique.
ALTER TABLE "auth_group_member" DROP CONSTRAINT "auth_group_member_group_external_id_auth_group_external_id_fk";--> statement-breakpoint
ALTER TABLE "auth_group_member" DROP CONSTRAINT "auth_group_member_group_external_id_person_id_pk";--> statement-breakpoint
ALTER TABLE "auth_group" DROP CONSTRAINT "auth_group_pkey";--> statement-breakpoint
ALTER TABLE "auth_group" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "auth_group" SET "id" = "external_id";--> statement-breakpoint
ALTER TABLE "auth_group" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_group" ADD CONSTRAINT "auth_group_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "auth_group" ALTER COLUMN "external_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_group_external_id" ON "auth_group" USING btree ("external_id");--> statement-breakpoint
ALTER TABLE "auth_group" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_group" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_group_member" ADD COLUMN "group_id" text;--> statement-breakpoint
UPDATE "auth_group_member" SET "group_id" = "group_external_id";--> statement-breakpoint
ALTER TABLE "auth_group_member" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_group_member" ADD CONSTRAINT "auth_group_member_group_id_person_id_pk" PRIMARY KEY("group_id","person_id");--> statement-breakpoint
ALTER TABLE "auth_group_member" ADD CONSTRAINT "auth_group_member_group_id_auth_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."auth_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_group_member" DROP COLUMN "group_external_id";--> statement-breakpoint
-- auth_person carries the deferred policy-change trigger of 0018/0019; fire queued events before altering it (as 0030 did).
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_person" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
