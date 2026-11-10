CREATE TABLE "talk_commitment" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"owner_role" text NOT NULL,
	"owner_id" text,
	"text_sealed" text NOT NULL,
	"due_on" date NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"thread_id" text,
	CONSTRAINT "talk_commitment_owner_role" CHECK ("talk_commitment"."owner_role" IN ('employee', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "talk_round" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"opens_on" date NOT NULL,
	"due_on" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "talk_round_kind" CHECK ("talk_round"."kind" IN ('development')),
	CONSTRAINT "talk_round_period" CHECK ("talk_round"."due_on" >= "talk_round"."opens_on")
);
--> statement-breakpoint
CREATE TABLE "talk" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"held_on" date,
	"held_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_round_id_talk_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."talk_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_employee_id_auth_person_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_owner_id_auth_person_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_done_by_auth_person_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_created_by_auth_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_commitment" ADD CONSTRAINT "talk_commitment_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk" ADD CONSTRAINT "talk_round_id_talk_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."talk_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk" ADD CONSTRAINT "talk_employee_id_auth_person_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."auth_person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk" ADD CONSTRAINT "talk_held_by_auth_person_id_fk" FOREIGN KEY ("held_by") REFERENCES "public"."auth_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "talk_commitment_employee" ON "talk_commitment" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "talk_commitment_thread" ON "talk_commitment" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "talk_commitment_owner_open" ON "talk_commitment" USING btree ("owner_id") WHERE "talk_commitment"."done_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "talk_round_open" ON "talk_round" USING btree ("organisation_id","kind") WHERE "talk_round"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "talk_round_employee" ON "talk" USING btree ("round_id","employee_id");--> statement-breakpoint
-- The browser-change signal (D46) for talks: every person a row concerns sees it change at commit. A talk concerns its
-- employee and whoever marked it held; an action point its employee, its owner, who added it and who marked it done.
-- Old and new rows both count, so a person removed from a row sees it go. Counters are bumped in id order, so two
-- transactions that touch the same people take their counter locks in the same order.
CREATE FUNCTION clew_talk_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME = 'talk' THEN
      ids := ids || ARRAY[OLD.employee_id, OLD.held_by];
    ELSE
      ids := ids || ARRAY[OLD.employee_id, OLD.owner_id, OLD.created_by, OLD.done_by];
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'talk' THEN
      ids := ids || ARRAY[NEW.employee_id, NEW.held_by];
    ELSE
      ids := ids || ARRAY[NEW.employee_id, NEW.owner_id, NEW.created_by, NEW.done_by];
    END IF;
  END IF;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER talk_content_changed AFTER INSERT OR UPDATE OR DELETE ON talk
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_talk_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER talk_commitment_content_changed AFTER INSERT OR UPDATE OR DELETE ON talk_commitment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION clew_talk_changed();
