CREATE TABLE "module_state" (
	"module" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_state_module_key_pk" PRIMARY KEY("module","key")
);
--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "module" text DEFAULT 'calendar' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "area" text DEFAULT 'kalender' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "summary" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "actions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "deadline" text;--> statement-breakpoint
ALTER TABLE "thread" ADD COLUMN "receipt" jsonb;