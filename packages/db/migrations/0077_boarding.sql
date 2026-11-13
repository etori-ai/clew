CREATE TABLE "boarding_item" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text,
	"text_sealed" text,
	"kind" text NOT NULL,
	"owner_role" text NOT NULL,
	"owner_id" text,
	"due_on" date NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"thread_id" text,
	"source_layer_id" text,
	"tied_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_item_kind" CHECK ("boarding_item"."kind" IN ('todo', 'order', 'meeting', 'course', 'acknowledge')),
	CONSTRAINT "boarding_item_owner_role" CHECK ("boarding_item"."owner_role" IN ('manager', 'person', 'buddy')),
	CONSTRAINT "boarding_item_title" CHECK (("boarding_item"."title" IS NULL) <> ("boarding_item"."text_sealed" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "boarding_layer_item" (
	"id" text PRIMARY KEY NOT NULL,
	"layer_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"owner_role" text NOT NULL,
	"offset_days" integer NOT NULL,
	"tied_to" text,
	CONSTRAINT "boarding_layer_item_kind" CHECK ("boarding_layer_item"."kind" IN ('todo', 'order', 'meeting', 'course', 'acknowledge')),
	CONSTRAINT "boarding_layer_item_owner_role" CHECK ("boarding_layer_item"."owner_role" IN ('manager', 'person', 'buddy')),
	CONSTRAINT "boarding_layer_item_offset" CHECK ("boarding_layer_item"."offset_days" BETWEEN -365 AND 365)
);
--> statement-breakpoint
CREATE TABLE "boarding_layer" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"event" text NOT NULL,
	"name" text NOT NULL,
	"condition_kind" text NOT NULL,
	"condition_value" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boarding_layer_event" CHECK ("boarding_layer"."event" IN ('introduction', 'leaving')),
	CONSTRAINT "boarding_layer_condition" CHECK ("boarding_layer"."condition_kind" IN ('all', 'unit', 'position', 'employment_type')),
	CONSTRAINT "boarding_layer_value" CHECK (("boarding_layer"."condition_kind" = 'all') = ("boarding_layer"."condition_value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "boarding_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"person_id" text NOT NULL,
	"event" text NOT NULL,
	"anchor_on" date NOT NULL,
	"buddy_id" text,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "boarding_plan_event" CHECK ("boarding_plan"."event" IN ('introduction', 'leaving'))
);
--> statement-breakpoint
ALTER TABLE "boarding_item" ADD CONSTRAINT "boarding_item_plan_id_boarding_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."boarding_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_item" ADD CONSTRAINT "boarding_item_owner_id_auth_person_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_item" ADD CONSTRAINT "boarding_item_done_by_auth_person_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_item" ADD CONSTRAINT "boarding_item_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_item" ADD CONSTRAINT "boarding_item_source_layer_id_boarding_layer_id_fk" FOREIGN KEY ("source_layer_id") REFERENCES "public"."boarding_layer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_layer_item" ADD CONSTRAINT "boarding_layer_item_layer_id_boarding_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."boarding_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_plan" ADD CONSTRAINT "boarding_plan_person_id_auth_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_plan" ADD CONSTRAINT "boarding_plan_buddy_id_auth_person_id_fk" FOREIGN KEY ("buddy_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boarding_plan" ADD CONSTRAINT "boarding_plan_started_by_auth_person_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boarding_item_plan" ON "boarding_item" USING btree ("plan_id","position");--> statement-breakpoint
CREATE INDEX "boarding_item_thread" ON "boarding_item" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "boarding_item_owner_open" ON "boarding_item" USING btree ("owner_id") WHERE "boarding_item"."done_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_layer_item_position" ON "boarding_layer_item" USING btree ("layer_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_layer_name" ON "boarding_layer" USING btree ("organisation_id","event",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "boarding_plan_open" ON "boarding_plan" USING btree ("person_id","event") WHERE "boarding_plan"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "boarding_plan_person" ON "boarding_plan" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "boarding_plan_started_by" ON "boarding_plan" USING btree ("started_by");