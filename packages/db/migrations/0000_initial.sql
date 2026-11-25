-- Initial public schema for Clew. DBOS manages its own schema.
CREATE FUNCTION public.clew_aimed_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  versions jsonb[] := ARRAY[]::jsonb[];
  r jsonb;
  ids text[] := ARRAY[]::text[];
  shared boolean := false;
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    versions := versions || to_jsonb(OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    versions := versions || to_jsonb(NEW);
  END IF;
  FOREACH r IN ARRAY versions LOOP
    IF r ->> TG_ARGV[1] IS NULL THEN
      shared := true;
    ELSE
      ids := ids || (r ->> TG_ARGV[1]);
    END IF;
  END LOOP;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  IF shared THEN
    PERFORM clew_move_counter(TG_ARGV[0]);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_boarding_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  plans text[] := ARRAY[]::text[];
  person text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_TABLE_NAME = 'boarding_plan' THEN
      ids := ids || ARRAY[OLD.person_id, OLD.buddy_id, OLD.started_by];
      plans := plans || OLD.id;
    ELSIF TG_TABLE_NAME = 'boarding_plan_holder' THEN
      ids := ids || OLD.person_id;
      plans := plans || OLD.plan_id;
    ELSE
      ids := ids || ARRAY[OLD.owner_id, OLD.done_by];
      plans := plans || OLD.plan_id;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_TABLE_NAME = 'boarding_plan' THEN
      ids := ids || ARRAY[NEW.person_id, NEW.buddy_id, NEW.started_by];
      plans := plans || NEW.id;
    ELSIF TG_TABLE_NAME = 'boarding_plan_holder' THEN
      ids := ids || NEW.person_id;
      plans := plans || NEW.plan_id;
    ELSE
      ids := ids || ARRAY[NEW.owner_id, NEW.done_by];
      plans := plans || NEW.plan_id;
    END IF;
  END IF;
  ids := ids || ARRAY(
    SELECT unnest(ARRAY[p.person_id, p.buddy_id, p.started_by]) FROM boarding_plan p WHERE p.id = ANY(plans)
    UNION ALL
    SELECT h.person_id FROM boarding_plan_holder h WHERE h.plan_id = ANY(plans)
  );
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_connector_policy_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - TG_ARGV IS NOT DISTINCT FROM to_jsonb(NEW) - TG_ARGV THEN
    RETURN NULL;
  END IF;
  INSERT INTO policy_change(id, revision) VALUES ('installation', 1)
    ON CONFLICT(id) DO UPDATE SET revision = policy_change.revision + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_content_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE owner text;
BEGIN
  owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END;
  INSERT INTO person_change(person_id, content) VALUES (owner, 1)
    ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_move_counter(counter text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  moved text := 'clew.changed_' || replace(counter, '-', '_');
BEGIN
  IF current_setting(moved, true) = 'on' THEN
    RETURN;
  END IF;
  PERFORM set_config(moved, 'on', true);
  PERFORM nextval(('content_change_' || replace(counter, '-', '_'))::regclass);
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_occurrence_disposition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('dismissed', 'open') THEN
  UPDATE work_occurrence SET disposition = CASE WHEN NEW.state = 'dismissed' THEN 'dismissed' ELSE 'visible' END WHERE thread_id = NEW.id;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_people_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  was jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  becomes jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  ids text[] := ARRAY[]::text[];
  person text;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    ids := ids || ARRAY[was ->> TG_ARGV[i], becomes ->> TG_ARGV[i]];
  END LOOP;
  FOR person IN SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL ORDER BY id LOOP
    INSERT INTO person_change(person_id, content) VALUES (person, 1)
      ON CONFLICT(person_id) DO UPDATE SET content = person_change.content + 1;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_person_policy_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE owner text;
BEGIN
  IF TG_TABLE_NAME = 'auth_person' THEN
    owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    owner := CASE WHEN TG_OP = 'DELETE' THEN OLD.person_id ELSE NEW.person_id END;
  END IF;
  INSERT INTO person_change(person_id, policy) VALUES (owner, 1)
    ON CONFLICT(person_id) DO UPDATE SET policy = person_change.policy + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_revise_card_decision() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.decision_revision := OLD.decision_revision + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.clew_shared_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - TG_ARGV[1:] IS NOT DISTINCT FROM to_jsonb(NEW) - TG_ARGV[1:] THEN
    RETURN NULL;
  END IF;
  PERFORM clew_move_counter(TG_ARGV[0]);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.clew_temporal_job_owner() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'due' THEN NEW.status := 'temporal'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TABLE public.attention_day (
    id text NOT NULL,
    person_id text NOT NULL,
    used integer NOT NULL,
    bucket text NOT NULL,
    due_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.attention_delivery (
    id text NOT NULL,
    person_id text NOT NULL,
    thread_id text NOT NULL,
    kind text NOT NULL,
    batch text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    state text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.audit (
    id bigint NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    subject text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE public.audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.audit_id_seq OWNED BY public.audit.id;
--> statement-breakpoint
CREATE TABLE public.auth_access_grant (
    person_id text NOT NULL,
    unit_id text NOT NULL,
    unit_label text NOT NULL,
    role text NOT NULL,
    capabilities jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    relations jsonb DEFAULT '[]'::jsonb NOT NULL,
    assignments jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT auth_grant_role CHECK ((role = ANY (ARRAY['manager'::text, 'employee'::text])))
);
--> statement-breakpoint
CREATE TABLE public.auth_assignment (
    person_id text NOT NULL,
    unit_id text NOT NULL,
    role text NOT NULL,
    CONSTRAINT auth_assignment_role CHECK ((role = ANY (ARRAY['manager'::text, 'employee'::text])))
);
--> statement-breakpoint
CREATE TABLE public.auth_audit (
    id bigint NOT NULL,
    actor text,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE public.auth_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.auth_audit_id_seq OWNED BY public.auth_audit.id;
--> statement-breakpoint
CREATE TABLE public.auth_group (
    id text NOT NULL,
    external_id text,
    label text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    organisation_id text NOT NULL,
    parent_unit_id text
);
--> statement-breakpoint
CREATE TABLE public.auth_group_capability (
    group_external_id text NOT NULL,
    capability text NOT NULL,
    organisation_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_group_member (
    group_id text NOT NULL,
    person_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_group_relation (
    organisation_id text NOT NULL,
    group_external_id text NOT NULL,
    relation text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_identity_binding (
    issuer text NOT NULL,
    subject text NOT NULL,
    person_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_login_transaction (
    digest text NOT NULL,
    state text NOT NULL,
    nonce text NOT NULL,
    verifier text NOT NULL,
    return_to text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_logout_receipt (
    issuer text NOT NULL,
    jti text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_person (
    id text NOT NULL,
    organisation_id text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    external_id text,
    user_name text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    phone_numbers jsonb DEFAULT '[]'::jsonb NOT NULL,
    employments jsonb DEFAULT '[]'::jsonb NOT NULL,
    name_changed_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.auth_person_position (
    person_id text NOT NULL,
    position_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_position (
    id text NOT NULL,
    organisation_id text NOT NULL,
    code text NOT NULL,
    label text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.auth_provisioner (
    id text NOT NULL,
    organisation_id text NOT NULL,
    label text NOT NULL,
    token_digest text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    previous_token_digest text,
    previous_valid_until timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE public.auth_session (
    digest text NOT NULL,
    person_id text NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    sid text,
    client_id text NOT NULL,
    csrf text NOT NULL,
    tokens text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    idle_expires_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    refresh_claim text,
    refresh_claim_until timestamp with time zone,
    CONSTRAINT auth_session_refresh_claim_pair CHECK (((refresh_claim IS NULL) = (refresh_claim_until IS NULL)))
);
--> statement-breakpoint
CREATE TABLE public.auth_unit (
    id text NOT NULL,
    organisation_id text NOT NULL,
    label text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.boarding_item (
    id text NOT NULL,
    plan_id text NOT NULL,
    "position" integer NOT NULL,
    title text,
    text_sealed text,
    kind text NOT NULL,
    owner_role text NOT NULL,
    owner_id text,
    due_on date NOT NULL,
    done_at timestamp with time zone,
    done_by text,
    thread_id text,
    source_layer_id text,
    tied_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT boarding_item_kind CHECK ((kind = ANY (ARRAY['todo'::text, 'order'::text, 'meeting'::text, 'course'::text, 'acknowledge'::text]))),
    CONSTRAINT boarding_item_owner_role CHECK ((owner_role = ANY (ARRAY['manager'::text, 'person'::text, 'buddy'::text]))),
    CONSTRAINT boarding_item_title CHECK (((title IS NULL) <> (text_sealed IS NULL)))
);
--> statement-breakpoint
CREATE TABLE public.boarding_layer (
    id text NOT NULL,
    organisation_id text NOT NULL,
    event text NOT NULL,
    name text NOT NULL,
    condition_kind text NOT NULL,
    condition_value text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT boarding_layer_condition CHECK ((condition_kind = ANY (ARRAY['all'::text, 'unit'::text, 'position'::text, 'employment_type'::text]))),
    CONSTRAINT boarding_layer_event CHECK ((event = ANY (ARRAY['introduction'::text, 'leaving'::text]))),
    CONSTRAINT boarding_layer_value CHECK (((condition_kind = 'all'::text) = (condition_value IS NULL)))
);
--> statement-breakpoint
CREATE TABLE public.boarding_layer_item (
    id text NOT NULL,
    layer_id text NOT NULL,
    "position" integer NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    owner_role text NOT NULL,
    offset_days integer NOT NULL,
    tied_to text,
    CONSTRAINT boarding_layer_item_kind CHECK ((kind = ANY (ARRAY['todo'::text, 'order'::text, 'meeting'::text, 'course'::text, 'acknowledge'::text]))),
    CONSTRAINT boarding_layer_item_offset CHECK (((offset_days >= '-365'::integer) AND (offset_days <= 365))),
    CONSTRAINT boarding_layer_item_owner_role CHECK ((owner_role = ANY (ARRAY['manager'::text, 'person'::text, 'buddy'::text])))
);
--> statement-breakpoint
CREATE TABLE public.boarding_plan (
    id text NOT NULL,
    organisation_id text NOT NULL,
    person_id text NOT NULL,
    event text NOT NULL,
    anchor_on date NOT NULL,
    buddy_id text,
    started_by text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    held_at timestamp with time zone,
    CONSTRAINT boarding_plan_event CHECK ((event = ANY (ARRAY['introduction'::text, 'leaving'::text])))
);
--> statement-breakpoint
CREATE TABLE public.boarding_plan_holder (
    plan_id text NOT NULL,
    person_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.competence_erasure (
    person_id text NOT NULL,
    organisation_id text NOT NULL,
    state text NOT NULL,
    inactive_since timestamp with time zone,
    generation integer NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT competence_erasure_generation CHECK ((generation >= 0)),
    CONSTRAINT competence_erasure_since CHECK (((state <> 'inactive'::text) OR (inactive_since IS NOT NULL))),
    CONSTRAINT competence_erasure_state CHECK ((state = ANY (ARRAY['inactive'::text, 'cancelled'::text, 'erased'::text])))
);
--> statement-breakpoint
CREATE TABLE public.competence_holding (
    id text NOT NULL,
    person_id text NOT NULL,
    type_id text,
    issued_on date NOT NULL,
    expires_on date,
    evidence text NOT NULL,
    state text NOT NULL,
    registered_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by text,
    connector_id text,
    source_id text,
    source_type text,
    source_label text,
    read_at timestamp with time zone,
    decided_by text,
    decided_at timestamp with time zone,
    thread_id text,
    level integer,
    interest boolean DEFAULT false NOT NULL,
    validated_by text,
    validated_at timestamp with time zone,
    rated_at timestamp with time zone,
    CONSTRAINT competence_holding_copy CHECK ((((connector_id IS NULL) AND (source_id IS NULL) AND (source_type IS NULL) AND (source_label IS NULL) AND (read_at IS NULL)) OR ((connector_id IS NOT NULL) AND (source_id IS NOT NULL) AND (source_type IS NOT NULL) AND (source_label IS NOT NULL) AND (read_at IS NOT NULL) AND (evidence = 'system'::text) AND (registered_by IS NULL)))),
    CONSTRAINT competence_holding_decided CHECK ((((decided_by IS NULL) OR (decided_at IS NOT NULL)) AND ((thread_id IS NULL) OR (evidence = 'self'::text)) AND
CASE
    WHEN (level IS NOT NULL) THEN (decided_at IS NULL)
    WHEN (evidence = 'self'::text) THEN ((state = 'pending'::text) = (decided_at IS NULL))
    ELSE (decided_at IS NULL)
END)),
    CONSTRAINT competence_holding_evidence CHECK ((evidence = ANY (ARRAY['system'::text, 'manager'::text, 'self'::text]))),
    CONSTRAINT competence_holding_own CHECK (((state <> ALL (ARRAY['pending'::text, 'rejected'::text])) OR (evidence = 'self'::text))),
    CONSTRAINT competence_holding_period CHECK (((expires_on IS NULL) OR (expires_on >= issued_on))),
    CONSTRAINT competence_holding_rated CHECK (((level IS NULL) = (rated_at IS NULL))),
    CONSTRAINT competence_holding_skill CHECK (level IS NULL OR (level BETWEEN 1 AND 3 AND expires_on IS NULL AND connector_id IS NULL AND evidence <> 'system' AND thread_id IS NULL AND state IN ('valid', 'revoked'))),
    CONSTRAINT competence_holding_state CHECK ((state = ANY (ARRAY['pending'::text, 'valid'::text, 'rejected'::text, 'revoked'::text]))),
    CONSTRAINT competence_holding_typed CHECK (((type_id IS NOT NULL) OR (connector_id IS NOT NULL))),
    CONSTRAINT competence_holding_validated CHECK ((((validated_by IS NULL) OR (validated_at IS NOT NULL)) AND ((validated_at IS NULL) OR (level IS NOT NULL)) AND ((NOT interest) OR (level IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE public.competence_read_log (
    id text NOT NULL,
    organisation_id text NOT NULL,
    reader_id text NOT NULL,
    relation text NOT NULL,
    kind text NOT NULL,
    type_id text,
    min_level integer,
    unit_id text,
    person_id text,
    rows integer NOT NULL,
    read_at timestamp with time zone NOT NULL,
    caller text DEFAULT 'person'::text NOT NULL,
    type_ids text[] DEFAULT '{}'::text[] NOT NULL,
    status text[] DEFAULT '{}'::text[] NOT NULL,
    until integer,
    CONSTRAINT competence_read_log_caller CHECK (((caller = 'person'::text) OR ((caller = 'assistant'::text) AND (kind = 'person'::text) AND (relation = 'managed'::text)))),
    CONSTRAINT competence_read_log_filters CHECK ((((cardinality(status) = 0) AND (until IS NULL)) OR ((relation = 'registrar'::text) AND (kind = ANY (ARRAY['search'::text, 'export'::text]))))),
    CONSTRAINT competence_read_log_kind CHECK ((kind = ANY (ARRAY['search'::text, 'person'::text, 'export'::text]))),
    CONSTRAINT competence_read_log_level CHECK (((min_level IS NULL) OR ((min_level >= 1) AND (min_level <= 3)))),
    CONSTRAINT competence_read_log_relation CHECK ((relation = ANY (ARRAY['self'::text, 'managed'::text, 'registrar'::text]))),
    CONSTRAINT competence_read_log_rows CHECK ((rows >= 0)),
    CONSTRAINT competence_read_log_status CHECK (status IN ('{}'::text[], '{valid}'::text[], '{expiring}'::text[], '{expired}'::text[], '{valid,expiring}'::text[], '{valid,expired}'::text[], '{expiring,expired}'::text[], '{valid,expiring,expired}'::text[])),
    CONSTRAINT competence_read_log_subject CHECK (
CASE
    WHEN (kind = 'person'::text) THEN ((person_id IS NOT NULL) AND (type_id IS NULL) AND (min_level IS NULL) AND (unit_id IS NULL))
    WHEN (relation = 'registrar'::text) THEN ((type_id IS NOT NULL) AND (person_id IS NULL))
    ELSE ((kind = 'export'::text) AND (relation = 'managed'::text) AND (type_id IS NULL) AND (person_id IS NULL) AND (min_level IS NULL) AND (unit_id IS NULL))
END),
    CONSTRAINT competence_read_log_types CHECK (
CASE
    WHEN (type_id IS NULL) THEN (cardinality(type_ids) = 0)
    ELSE COALESCE((type_ids[1] = type_id), false)
END),
    CONSTRAINT competence_read_log_until CHECK (((until IS NULL) OR (until = ANY (ARRAY[30, 90, 180]))))
);
--> statement-breakpoint
CREATE TABLE public.competence_requirement (
    id text NOT NULL,
    organisation_id text NOT NULL,
    type_id text NOT NULL,
    unit_id text,
    person_id text,
    min_level integer,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    position_code text,
    CONSTRAINT competence_requirement_level CHECK (((min_level IS NULL) OR ((min_level >= 1) AND (min_level <= 3)))),
    CONSTRAINT competence_requirement_target CHECK ((num_nonnulls(position_code, unit_id, person_id) = 1))
);
--> statement-breakpoint
CREATE TABLE public.competence_retention (
    organisation_id text NOT NULL,
    days integer NOT NULL,
    set_by text NOT NULL,
    set_at timestamp with time zone NOT NULL,
    CONSTRAINT competence_retention_days CHECK (((days >= 1) AND (days <= 3650)))
);
--> statement-breakpoint
CREATE TABLE public.competence_share_target (
    id text NOT NULL,
    organisation_id text NOT NULL,
    type_id text NOT NULL,
    unit_id text,
    min_share integer NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    position_code text NOT NULL,
    CONSTRAINT competence_share_target_share CHECK (((min_share >= 1) AND (min_share <= 100)))
);
--> statement-breakpoint
CREATE TABLE public.competence_source (
    connector_id text NOT NULL,
    source text NOT NULL,
    run text,
    claimed_at timestamp with time zone,
    lease_until timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    outcome text,
    counts jsonb,
    CONSTRAINT competence_source_claim CHECK ((((run IS NULL) = (claimed_at IS NULL)) AND ((run IS NULL) = (lease_until IS NULL)))),
    CONSTRAINT competence_source_last_read CHECK ((((outcome IS NULL) = (started_at IS NULL)) AND ((outcome IS NULL) = (finished_at IS NULL)) AND ((outcome IS NULL) = (counts IS NULL)))),
    CONSTRAINT competence_source_outcome CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['complete'::text, 'partial'::text, 'failed'::text]))))
);
--> statement-breakpoint
CREATE TABLE public.competence_source_mapping (
    connector_id text NOT NULL,
    organisation_id text NOT NULL,
    source_type text NOT NULL,
    type_id text NOT NULL,
    mapped_by text NOT NULL,
    mapped_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.competence_type (
    id text NOT NULL,
    organisation_id text NOT NULL,
    name text NOT NULL,
    area text NOT NULL,
    kind text NOT NULL,
    validity_months integer,
    archived_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_uri text,
    merged_into text,
    CONSTRAINT competence_type_kind CHECK ((kind = ANY (ARRAY['certificate'::text, 'degree'::text, 'course'::text, 'authorisation'::text, 'skill'::text]))),
    CONSTRAINT competence_type_merged CHECK (((merged_into IS NULL) OR ((archived_at IS NOT NULL) AND (merged_into <> id)))),
    CONSTRAINT competence_type_skill CHECK (((kind <> 'skill'::text) OR (validity_months IS NULL))),
    CONSTRAINT competence_type_validity CHECK (((validity_months IS NULL) OR ((validity_months >= 1) AND (validity_months <= 600))))
);
--> statement-breakpoint
CREATE TABLE public.connector (
    id text NOT NULL,
    url text,
    secret text,
    secret_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    state text DEFAULT 'draft'::text NOT NULL,
    audience jsonb DEFAULT '{"mode": "all"}'::jsonb NOT NULL,
    scan_enabled boolean DEFAULT true NOT NULL,
    tools_enabled boolean DEFAULT true NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    manifest jsonb,
    manifest_at timestamp with time zone,
    health jsonb DEFAULT '{"at": "1970-01-01T00:00:00.000Z", "status": "untested"}'::jsonb NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    bundled boolean DEFAULT false NOT NULL,
    ordinal integer,
    areas jsonb DEFAULT '{}'::jsonb NOT NULL,
    header_holder boolean DEFAULT false NOT NULL,
    manifest_offered jsonb,
    manifest_offered_at timestamp with time zone,
    registration_id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT connector_id CHECK ((id ~ '^[a-z][a-z0-9-]*$'::text)),
    CONSTRAINT connector_remote CHECK ((bundled OR ((url IS NOT NULL) AND (secret IS NOT NULL)))),
    CONSTRAINT connector_state CHECK ((state = ANY (ARRAY['draft'::text, 'enabled'::text, 'disabled'::text])))
);
--> statement-breakpoint
CREATE TABLE public.connector_signing_key (
    id text NOT NULL,
    kid text NOT NULL,
    sealed text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    previous jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT connector_signing_singleton CHECK ((id = 'installation'::text))
);
--> statement-breakpoint
CREATE SEQUENCE public.content_change_appearance
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_boarding_layers
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_competence_catalogue
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_competence_source
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_connectors
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_dialogue_setup
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_model_menu
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_models
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_organisation
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE public.content_change_talk_round
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
CREATE TABLE public.dialogue_activity (
    id text NOT NULL,
    organisation_id text NOT NULL,
    unit_id text NOT NULL,
    area_key text NOT NULL,
    owner_id text,
    text_sealed text NOT NULL,
    due_on date,
    done_at timestamp with time zone,
    done_by text,
    done_note_sealed text,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    thread_id text
);
--> statement-breakpoint
CREATE TABLE public.dialogue_area (
    organisation_id text NOT NULL,
    key text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    measure text,
    info text,
    dimensions jsonb DEFAULT '[]'::jsonb NOT NULL,
    ordinal integer NOT NULL,
    CONSTRAINT dialogue_area_kind CHECK ((kind = ANY (ARRAY['measured'::text, 'assessed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.dialogue_assessment (
    id text NOT NULL,
    organisation_id text NOT NULL,
    unit_id text NOT NULL,
    area_key text NOT NULL,
    dimension text DEFAULT ''::text NOT NULL,
    tone text NOT NULL,
    comment_sealed text,
    author_id text,
    at timestamp with time zone NOT NULL,
    CONSTRAINT dialogue_assessment_tone CHECK ((tone = ANY (ARRAY['ok'::text, 'warn'::text, 'alert'::text])))
);
--> statement-breakpoint
CREATE TABLE public.dialogue_note (
    id text NOT NULL,
    organisation_id text NOT NULL,
    unit_id text NOT NULL,
    area_key text NOT NULL,
    author_id text NOT NULL,
    text_sealed text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.dialogue_question (
    id text NOT NULL,
    organisation_id text NOT NULL,
    area_key text NOT NULL,
    unit_id text,
    heading text,
    text text NOT NULL,
    based_on text,
    ordinal integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.dispatch_outbox (
    id text NOT NULL,
    execution_id text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    next_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    delivered_at timestamp with time zone,
    last_error text
);
--> statement-breakpoint
CREATE TABLE public.execution (
    id text NOT NULL,
    decision_id text NOT NULL,
    person_id text NOT NULL,
    principal text NOT NULL,
    unit_id text NOT NULL,
    authorization_version text NOT NULL,
    connector text NOT NULL,
    operation text NOT NULL,
    digest text NOT NULL,
    payload text NOT NULL,
    safety jsonb NOT NULL,
    result text,
    compensates text,
    state text DEFAULT 'pending'::text NOT NULL,
    reason text,
    attempt integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    dispatched_at timestamp with time zone,
    lease_until timestamp with time zone,
    presentation jsonb,
    approving_session text,
    checking_session text,
    subject jsonb,
    CONSTRAINT execution_state CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'partial'::text, 'failed'::text, 'unknown'::text])))
);
--> statement-breakpoint
CREATE TABLE public.execution_job (
    id text NOT NULL,
    decision_id text NOT NULL,
    person_id text NOT NULL,
    principal text NOT NULL,
    unit_id text NOT NULL,
    authorization_version text NOT NULL,
    digest text NOT NULL,
    steps text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.follow_binding (
    id text NOT NULL,
    kind text NOT NULL,
    capability text NOT NULL,
    audience jsonb NOT NULL,
    within text,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.followup_policy (
    thread_id text NOT NULL,
    person_id text NOT NULL,
    unit_id text NOT NULL,
    authorization_version text NOT NULL,
    execution_id text NOT NULL,
    proposal_ids jsonb NOT NULL,
    max_reminders integer NOT NULL,
    after_workdays integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    state text NOT NULL,
    reason text,
    CONSTRAINT followup_bounds CHECK (max_reminders BETWEEN 1 AND 2 AND after_workdays >= 2)
);
--> statement-breakpoint
CREATE TABLE public.handover_turn (
    turn text NOT NULL,
    person_id text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.installation_appearance (
    id text NOT NULL,
    revision integer NOT NULL,
    theme jsonb,
    logo_alt text,
    logo_light_type text,
    logo_light text,
    logo_dark_type text,
    logo_dark text,
    updated_by text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    name text,
    CONSTRAINT installation_appearance_logo CHECK ((((logo_light IS NULL) = (logo_alt IS NULL)) AND ((logo_light IS NULL) = (logo_light_type IS NULL)) AND ((logo_dark IS NULL) = (logo_dark_type IS NULL)) AND ((logo_dark IS NULL) OR (logo_light IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE public.job (
    id text NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    run_at timestamp with time zone NOT NULL,
    status text DEFAULT 'temporal'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dispatch_attempt integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_until timestamp with time zone,
    CONSTRAINT job_status CHECK ((status = ANY (ARRAY['due'::text, 'running'::text, 'done'::text, 'failed'::text, 'temporal'::text, 'dispatched'::text, 'executing'::text, 'legacy-running'::text])))
);
--> statement-breakpoint
CREATE TABLE public.model (
    id text NOT NULL,
    provider_id text CONSTRAINT model_provider_id_not_null1 NOT NULL,
    model text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    state text DEFAULT 'disabled'::text NOT NULL,
    audience jsonb DEFAULT '{"mode": "all"}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    tools boolean DEFAULT true NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    reasoning text DEFAULT 'provider-default'::text NOT NULL,
    CONSTRAINT model_id CHECK ((id ~ '^[a-z][a-z0-9-]*$'::text)),
    CONSTRAINT model_reasoning CHECK ((reasoning = ANY (ARRAY['provider-default'::text, 'none'::text]))),
    CONSTRAINT model_state CHECK ((state = ANY (ARRAY['enabled'::text, 'disabled'::text])))
);
--> statement-breakpoint
CREATE TABLE public.model_choice (
    person_id text NOT NULL,
    model_id text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.model_provider (
    id text NOT NULL,
    title text NOT NULL,
    base_url text NOT NULL,
    api_key text,
    key_changed_at timestamp with time zone,
    health jsonb DEFAULT '{"at": "1970-01-01T00:00:00.000Z", "status": "untested"}'::jsonb NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT model_provider_id CHECK ((id ~ '^[a-z][a-z0-9-]*$'::text))
);
--> statement-breakpoint
CREATE TABLE public.person_change (
    person_id text NOT NULL,
    content bigint DEFAULT 0 NOT NULL,
    policy bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.policy_change (
    id text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.proposal (
    id text NOT NULL,
    thread_id text NOT NULL,
    person_id text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    participant_email text NOT NULL,
    participant_name text NOT NULL,
    start timestamp with time zone NOT NULL,
    "end" timestamp with time zone NOT NULL,
    event_uid text,
    event_ref text,
    event_revision text,
    confirmed_at timestamp with time zone,
    undo_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reminders integer DEFAULT 0 NOT NULL,
    reminded_at timestamp with time zone,
    participant_id text NOT NULL,
    execution_id text,
    event_ical_uid text,
    CONSTRAINT proposal_interval CHECK (("end" > start)),
    CONSTRAINT proposal_status CHECK ((status = ANY (ARRAY['proposed'::text, 'confirmed'::text, 'final'::text, 'accepted'::text, 'declined-by-invitee'::text, 'counter'::text, 'undone'::text, 'declined'::text, 'superseded'::text])))
);
--> statement-breakpoint
CREATE TABLE public.refresh_request (
    id text NOT NULL,
    person_id text NOT NULL,
    connector text NOT NULL,
    assignment text NOT NULL,
    authorization_version text NOT NULL,
    state text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    next_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    last_success timestamp with time zone,
    observed_at timestamp with time zone,
    error text,
    session text
);
--> statement-breakpoint
CREATE TABLE public.talk (
    id text NOT NULL,
    round_id text CONSTRAINT talk_round_id_not_null1 NOT NULL,
    employee_id text NOT NULL,
    held_on date,
    held_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    booked_start timestamp with time zone,
    booked_end timestamp with time zone,
    booked_by text,
    booked_at timestamp with time zone,
    invitation_id text,
    calendar_start timestamp with time zone,
    calendar_end timestamp with time zone,
    calendar_gone boolean DEFAULT false NOT NULL,
    CONSTRAINT talk_booking CHECK ((((booked_start IS NULL) AND (booked_end IS NULL) AND (booked_at IS NULL) AND (booked_by IS NULL) AND (invitation_id IS NULL)) OR ((booked_start IS NOT NULL) AND (booked_end IS NOT NULL) AND (booked_at IS NOT NULL) AND (booked_end > booked_start)))),
    CONSTRAINT talk_calendar CHECK ((((calendar_start IS NULL) = (calendar_end IS NULL)) AND (NOT (calendar_gone AND (calendar_start IS NOT NULL))) AND (((calendar_start IS NULL) AND (NOT calendar_gone)) OR (invitation_id IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE public.talk_commitment (
    id text NOT NULL,
    round_id text NOT NULL,
    employee_id text NOT NULL,
    owner_role text NOT NULL,
    owner_id text,
    text_sealed text NOT NULL,
    due_on date NOT NULL,
    done_at timestamp with time zone,
    done_by text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    thread_id text,
    CONSTRAINT talk_commitment_owner_role CHECK ((owner_role = ANY (ARRAY['employee'::text, 'manager'::text])))
);
--> statement-breakpoint
CREATE TABLE public.talk_round (
    id text NOT NULL,
    organisation_id text NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    opens_on date NOT NULL,
    due_on date NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    prepare_days integer DEFAULT 5 NOT NULL,
    CONSTRAINT talk_round_kind CHECK ((kind = 'development'::text)),
    CONSTRAINT talk_round_period CHECK ((due_on >= opens_on)),
    CONSTRAINT talk_round_prepare_days CHECK (((prepare_days >= 0) AND (prepare_days <= 30)))
);
--> statement-breakpoint
CREATE TABLE public.thread (
    id text NOT NULL,
    person_id text NOT NULL,
    kind text NOT NULL,
    topic text NOT NULL,
    title text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    trigger jsonb NOT NULL,
    week text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    handled_at timestamp with time zone,
    connector text DEFAULT 'calendar'::text CONSTRAINT thread_module_not_null NOT NULL,
    area text DEFAULT 'calendar'::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    waiting_on text,
    deadline text,
    receipt jsonb,
    reminded_at timestamp with time zone,
    snoozed_until timestamp with time zone,
    execution jsonb,
    source_authorization text,
    subjects jsonb DEFAULT '[]'::jsonb NOT NULL,
    handover jsonb,
    asked_beside jsonb,
    hand_on jsonb,
    handed_on_to text,
    handed_on_at timestamp with time zone,
    decision_revision integer DEFAULT 0 NOT NULL,
    CONSTRAINT thread_kind CHECK ((kind = ANY (ARRAY['pushed'::text, 'question'::text]))),
    CONSTRAINT thread_state CHECK ((state = ANY (ARRAY['open'::text, 'handled'::text, 'dismissed'::text])))
);
--> statement-breakpoint
CREATE TABLE public.thread_message (
    id text NOT NULL,
    thread_id text NOT NULL,
    role text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb,
    seq bigint NOT NULL,
    CONSTRAINT thread_message_role CHECK ((role = ANY (ARRAY['assistant'::text, 'user'::text])))
);
--> statement-breakpoint
CREATE SEQUENCE public.thread_message_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.thread_message_seq_seq OWNED BY public.thread_message.seq;
--> statement-breakpoint
CREATE TABLE public.thread_subject (
    thread_id text NOT NULL,
    person_id text NOT NULL,
    entity text NOT NULL,
    key text NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.timer_intent (
    id text NOT NULL,
    person_id text NOT NULL,
    thread_id text NOT NULL,
    kind text NOT NULL,
    generation integer NOT NULL,
    unit_id text NOT NULL,
    authorization_version text NOT NULL,
    due_at timestamp with time zone NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    state text NOT NULL,
    reason text,
    delivered_generation integer,
    delivered_state text,
    attempt integer DEFAULT 0 NOT NULL,
    next_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    CONSTRAINT timer_intent_state CHECK ((state = ANY (ARRAY['active'::text, 'cancelled'::text, 'fired'::text, 'blocked'::text])))
);
--> statement-breakpoint
CREATE TABLE public.watch_intent (
    id text NOT NULL,
    job_id text NOT NULL,
    step_id text NOT NULL,
    person_id text NOT NULL,
    generation integer DEFAULT 1 NOT NULL,
    checks jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    next_at timestamp with time zone NOT NULL,
    lease_until timestamp with time zone,
    delivered_at timestamp with time zone,
    last_error text
);
--> statement-breakpoint
CREATE TABLE public.work_occurrence (
    id text NOT NULL,
    person_id text NOT NULL,
    connector text NOT NULL,
    assignment text NOT NULL,
    source_key text NOT NULL,
    period text NOT NULL,
    revision text NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    source_state text NOT NULL,
    disposition text NOT NULL,
    thread_id text,
    legacy boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE ONLY public.audit ALTER COLUMN id SET DEFAULT nextval('public.audit_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_audit ALTER COLUMN id SET DEFAULT nextval('public.auth_audit_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.thread_message ALTER COLUMN seq SET DEFAULT nextval('public.thread_message_seq_seq'::regclass);
--> statement-breakpoint
SELECT pg_catalog.setval('public.audit_id_seq', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.auth_audit_id_seq', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_appearance', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_boarding_layers', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_competence_catalogue', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_competence_source', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_connectors', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_dialogue_setup', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_model_menu', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_models', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_organisation', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.content_change_talk_round', 1, false);
--> statement-breakpoint
SELECT pg_catalog.setval('public.thread_message_seq_seq', 1, true);
--> statement-breakpoint
ALTER TABLE ONLY public.attention_day
    ADD CONSTRAINT attention_day_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.attention_delivery
    ADD CONSTRAINT attention_delivery_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_access_grant
    ADD CONSTRAINT auth_access_grant_pkey PRIMARY KEY (person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_assignment
    ADD CONSTRAINT auth_assignment_person_id_unit_id_pk PRIMARY KEY (person_id, unit_id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_audit
    ADD CONSTRAINT auth_audit_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group_capability
    ADD CONSTRAINT auth_group_capability_organisation_id_group_external_id_capabil PRIMARY KEY (organisation_id, group_external_id, capability);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group_member
    ADD CONSTRAINT auth_group_member_group_id_person_id_pk PRIMARY KEY (group_id, person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group
    ADD CONSTRAINT auth_group_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group_relation
    ADD CONSTRAINT auth_group_relation_pk PRIMARY KEY (organisation_id, group_external_id, relation);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_identity_binding
    ADD CONSTRAINT auth_identity_binding_issuer_subject_pk PRIMARY KEY (issuer, subject);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_login_transaction
    ADD CONSTRAINT auth_login_transaction_pkey PRIMARY KEY (digest);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_logout_receipt
    ADD CONSTRAINT auth_logout_receipt_issuer_jti_pk PRIMARY KEY (issuer, jti);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_person
    ADD CONSTRAINT auth_person_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_person_position
    ADD CONSTRAINT auth_person_position_person_id_position_id_pk PRIMARY KEY (person_id, position_id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_position
    ADD CONSTRAINT auth_position_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_provisioner
    ADD CONSTRAINT auth_provisioner_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (digest);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_unit
    ADD CONSTRAINT auth_unit_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_layer_item
    ADD CONSTRAINT boarding_layer_item_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_layer
    ADD CONSTRAINT boarding_layer_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan_holder
    ADD CONSTRAINT boarding_plan_holder_plan_id_person_id_pk PRIMARY KEY (plan_id, person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan
    ADD CONSTRAINT boarding_plan_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_erasure
    ADD CONSTRAINT competence_erasure_pkey PRIMARY KEY (person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_read_log
    ADD CONSTRAINT competence_read_log_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_requirement
    ADD CONSTRAINT competence_requirement_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_retention
    ADD CONSTRAINT competence_retention_pkey PRIMARY KEY (organisation_id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_share_target
    ADD CONSTRAINT competence_share_target_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_source_mapping
    ADD CONSTRAINT competence_source_mapping_pk PRIMARY KEY (connector_id, organisation_id, source_type);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_source
    ADD CONSTRAINT competence_source_pkey PRIMARY KEY (connector_id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_type
    ADD CONSTRAINT competence_type_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.connector
    ADD CONSTRAINT connector_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.connector_signing_key
    ADD CONSTRAINT connector_signing_key_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_activity
    ADD CONSTRAINT dialogue_activity_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_area
    ADD CONSTRAINT dialogue_area_organisation_id_key_pk PRIMARY KEY (organisation_id, key);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_assessment
    ADD CONSTRAINT dialogue_assessment_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_note
    ADD CONSTRAINT dialogue_note_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_question
    ADD CONSTRAINT dialogue_question_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dispatch_outbox
    ADD CONSTRAINT dispatch_outbox_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.execution_job
    ADD CONSTRAINT execution_job_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.follow_binding
    ADD CONSTRAINT follow_binding_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.followup_policy
    ADD CONSTRAINT followup_policy_pkey PRIMARY KEY (thread_id);
--> statement-breakpoint
ALTER TABLE ONLY public.handover_turn
    ADD CONSTRAINT handover_turn_pkey PRIMARY KEY (turn);
--> statement-breakpoint
ALTER TABLE ONLY public.installation_appearance
    ADD CONSTRAINT installation_appearance_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.model_choice
    ADD CONSTRAINT model_choice_pkey PRIMARY KEY (person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.model
    ADD CONSTRAINT model_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.model_provider
    ADD CONSTRAINT model_provider_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.person_change
    ADD CONSTRAINT person_change_pkey PRIMARY KEY (person_id);
--> statement-breakpoint
ALTER TABLE ONLY public.policy_change
    ADD CONSTRAINT policy_change_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.proposal
    ADD CONSTRAINT proposal_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_request
    ADD CONSTRAINT refresh_request_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.talk
    ADD CONSTRAINT talk_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.talk_round
    ADD CONSTRAINT talk_round_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.thread_message
    ADD CONSTRAINT thread_message_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.thread
    ADD CONSTRAINT thread_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.thread_subject
    ADD CONSTRAINT thread_subject_thread_id_entity_key_pk PRIMARY KEY (thread_id, entity, key);
--> statement-breakpoint
ALTER TABLE ONLY public.timer_intent
    ADD CONSTRAINT timer_intent_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.watch_intent
    ADD CONSTRAINT watch_intent_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.work_occurrence
    ADD CONSTRAINT work_occurrence_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX audit_subject ON public.audit USING btree (subject, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_group_external_id ON public.auth_group USING btree (external_id);
--> statement-breakpoint
CREATE INDEX auth_group_member_person ON public.auth_group_member USING btree (person_id);
--> statement-breakpoint
CREATE INDEX auth_group_organisation_key ON public.auth_group USING btree (organisation_id, external_id text_pattern_ops);
--> statement-breakpoint
CREATE INDEX auth_group_parent_unit ON public.auth_group USING btree (parent_unit_id);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_person_external_id ON public.auth_person USING btree (external_id) WHERE (external_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_person_issuer ON public.auth_identity_binding USING btree (issuer, person_id);
--> statement-breakpoint
CREATE INDEX auth_person_position_position ON public.auth_person_position USING btree (position_id);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_person_user_name ON public.auth_person USING btree (lower((user_name COLLATE "und-x-icu")));
--> statement-breakpoint
CREATE INDEX auth_person_user_name_nfc ON public.auth_person USING btree (lower((NORMALIZE(user_name, NFC) COLLATE "und-x-icu")));
--> statement-breakpoint
CREATE UNIQUE INDEX auth_position_code ON public.auth_position USING btree (organisation_id, code);
--> statement-breakpoint
CREATE UNIQUE INDEX auth_provisioner_token_digest ON public.auth_provisioner USING btree (token_digest);
--> statement-breakpoint
CREATE INDEX auth_session_sid ON public.auth_session USING btree (issuer, client_id, sid);
--> statement-breakpoint
CREATE INDEX boarding_item_owner_open ON public.boarding_item USING btree (owner_id) WHERE (done_at IS NULL);
--> statement-breakpoint
CREATE INDEX boarding_item_plan ON public.boarding_item USING btree (plan_id, "position");
--> statement-breakpoint
CREATE INDEX boarding_item_thread ON public.boarding_item USING btree (thread_id);
--> statement-breakpoint
CREATE UNIQUE INDEX boarding_layer_item_position ON public.boarding_layer_item USING btree (layer_id, "position");
--> statement-breakpoint
CREATE UNIQUE INDEX boarding_layer_name ON public.boarding_layer USING btree (organisation_id, event, lower((name COLLATE "und-x-icu")));
--> statement-breakpoint
CREATE INDEX boarding_plan_holder_person ON public.boarding_plan_holder USING btree (person_id);
--> statement-breakpoint
CREATE UNIQUE INDEX boarding_plan_open ON public.boarding_plan USING btree (person_id, event) WHERE (closed_at IS NULL);
--> statement-breakpoint
CREATE INDEX boarding_plan_person ON public.boarding_plan USING btree (person_id);
--> statement-breakpoint
CREATE INDEX boarding_plan_started_by ON public.boarding_plan USING btree (started_by);
--> statement-breakpoint
CREATE INDEX competence_erasure_inactive ON public.competence_erasure USING btree (inactive_since) WHERE (state = 'inactive'::text);
--> statement-breakpoint
CREATE INDEX competence_erasure_organisation ON public.competence_erasure USING btree (organisation_id, state);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_holding_one_skill ON public.competence_holding USING btree (person_id, type_id) WHERE ((level IS NOT NULL) AND (state = 'valid'::text));
--> statement-breakpoint
CREATE UNIQUE INDEX competence_holding_pending ON public.competence_holding USING btree (person_id, type_id) WHERE (state = 'pending'::text);
--> statement-breakpoint
CREATE INDEX competence_holding_person ON public.competence_holding USING btree (person_id);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_holding_source ON public.competence_holding USING btree (connector_id, source_id) WHERE (connector_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX competence_holding_source_type ON public.competence_holding USING btree (connector_id, source_type);
--> statement-breakpoint
CREATE INDEX competence_holding_type ON public.competence_holding USING btree (type_id);
--> statement-breakpoint
CREATE INDEX competence_read_log_organisation ON public.competence_read_log USING btree (organisation_id, read_at);
--> statement-breakpoint
CREATE INDEX competence_read_log_person ON public.competence_read_log USING btree (person_id);
--> statement-breakpoint
CREATE INDEX competence_read_log_reader ON public.competence_read_log USING btree (reader_id);
--> statement-breakpoint
CREATE INDEX competence_requirement_organisation ON public.competence_requirement USING btree (organisation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_requirement_person ON public.competence_requirement USING btree (type_id, person_id) WHERE (person_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_requirement_position ON public.competence_requirement USING btree (type_id, position_code) WHERE (position_code IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_requirement_unit ON public.competence_requirement USING btree (type_id, unit_id) WHERE (unit_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_share_target_organisation ON public.competence_share_target USING btree (organisation_id, type_id, position_code) WHERE (unit_id IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_share_target_unit ON public.competence_share_target USING btree (type_id, position_code, unit_id) WHERE (unit_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_type_name ON public.competence_type USING btree (organisation_id, lower((name COLLATE "und-x-icu"))) WHERE (archived_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX competence_type_source_uri ON public.competence_type USING btree (organisation_id, source_uri) WHERE (source_uri IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX connector_header_holder_one ON public.connector USING btree (header_holder) WHERE header_holder;
--> statement-breakpoint
CREATE INDEX delivery_batch ON public.attention_delivery USING btree (batch, state);
--> statement-breakpoint
CREATE INDEX delivery_person_state ON public.attention_delivery USING btree (person_id, state, due_at);
--> statement-breakpoint
CREATE INDEX dialogue_activity_owner_open ON public.dialogue_activity USING btree (owner_id) WHERE (done_at IS NULL);
--> statement-breakpoint
CREATE INDEX dialogue_activity_thread ON public.dialogue_activity USING btree (thread_id);
--> statement-breakpoint
CREATE INDEX dialogue_activity_unit ON public.dialogue_activity USING btree (unit_id);
--> statement-breakpoint
CREATE INDEX dialogue_assessment_unit ON public.dialogue_assessment USING btree (unit_id, area_key, dimension, at);
--> statement-breakpoint
CREATE INDEX dialogue_note_author_unit ON public.dialogue_note USING btree (author_id, unit_id);
--> statement-breakpoint
CREATE INDEX dialogue_question_area ON public.dialogue_question USING btree (organisation_id, area_key);
--> statement-breakpoint
CREATE INDEX dispatch_outbox_due ON public.dispatch_outbox USING btree (next_at);
--> statement-breakpoint
CREATE UNIQUE INDEX execution_decision ON public.execution USING btree (person_id, decision_id);
--> statement-breakpoint
CREATE UNIQUE INDEX execution_job_decision ON public.execution_job USING btree (person_id, decision_id);
--> statement-breakpoint
CREATE INDEX execution_job_person ON public.execution_job USING btree (person_id, created_at);
--> statement-breakpoint
CREATE INDEX execution_person ON public.execution USING btree (person_id, created_at);
--> statement-breakpoint
CREATE INDEX follow_binding_kind ON public.follow_binding USING btree (kind);
--> statement-breakpoint
CREATE INDEX job_due ON public.job USING btree (status, run_at);
--> statement-breakpoint
CREATE INDEX model_by_provider ON public.model USING btree (provider_id);
--> statement-breakpoint
CREATE UNIQUE INDEX model_one_default ON public.model USING btree (is_default) WHERE is_default;
--> statement-breakpoint
CREATE INDEX occurrence_scope ON public.work_occurrence USING btree (person_id, connector, assignment);
--> statement-breakpoint
CREATE INDEX occurrence_thread ON public.work_occurrence USING btree (thread_id);
--> statement-breakpoint
CREATE INDEX proposal_participant_status ON public.proposal USING btree (participant_id, status);
--> statement-breakpoint
CREATE INDEX proposal_person_status ON public.proposal USING btree (person_id, status);
--> statement-breakpoint
CREATE INDEX proposal_thread ON public.proposal USING btree (thread_id);
--> statement-breakpoint
CREATE INDEX refresh_due ON public.refresh_request USING btree (next_at);
--> statement-breakpoint
CREATE INDEX refresh_person ON public.refresh_request USING btree (person_id, connector);
--> statement-breakpoint
CREATE INDEX talk_commitment_employee ON public.talk_commitment USING btree (employee_id);
--> statement-breakpoint
CREATE INDEX talk_commitment_owner_open ON public.talk_commitment USING btree (owner_id) WHERE (done_at IS NULL);
--> statement-breakpoint
CREATE INDEX talk_commitment_thread ON public.talk_commitment USING btree (thread_id);
--> statement-breakpoint
CREATE INDEX talk_invitation ON public.talk USING btree (invitation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX talk_round_employee ON public.talk USING btree (round_id, employee_id);
--> statement-breakpoint
CREATE UNIQUE INDEX talk_round_open ON public.talk_round USING btree (organisation_id, kind) WHERE (closed_at IS NULL);
--> statement-breakpoint
CREATE INDEX thread_competence_topic ON public.thread USING btree (topic) WHERE (connector = 'competence'::text);
--> statement-breakpoint
CREATE INDEX thread_conversation_recent ON public.thread USING btree (person_id, updated_at DESC, id DESC) WHERE (kind = 'question'::text);
--> statement-breakpoint
CREATE INDEX thread_message_thread ON public.thread_message USING btree (thread_id, created_at, seq);
--> statement-breakpoint
CREATE UNIQUE INDEX thread_message_turn ON public.thread_message USING btree (((meta ->> 'turn'::text))) WHERE ((role = 'user'::text) AND ((meta ->> 'turn'::text) IS NOT NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX thread_open_topic ON public.thread USING btree (person_id, topic) WHERE ((state = 'open'::text) AND (kind = 'pushed'::text));
--> statement-breakpoint
CREATE INDEX thread_person_state ON public.thread USING btree (person_id, state, created_at);
--> statement-breakpoint
CREATE INDEX thread_subject_entity ON public.thread_subject USING btree (entity, key);
--> statement-breakpoint
CREATE INDEX thread_subject_owner ON public.thread_subject USING btree (person_id, entity, key);
--> statement-breakpoint
CREATE INDEX thread_unresolved ON public.thread USING btree (person_id, created_at) WHERE ((kind = 'pushed'::text) AND ((state = 'open'::text) OR COALESCE(((execution ->> 'state'::text) = ANY (ARRAY['pending'::text, 'running'::text, 'unknown'::text, 'partial'::text, 'failed'::text])), false)));
--> statement-breakpoint
CREATE INDEX timer_intent_due ON public.timer_intent USING btree (next_at);
--> statement-breakpoint
CREATE UNIQUE INDEX timer_intent_slot ON public.timer_intent USING btree (thread_id, kind);
--> statement-breakpoint
CREATE INDEX watch_intent_due ON public.watch_intent USING btree (next_at);
--> statement-breakpoint
CREATE INDEX watch_intent_job ON public.watch_intent USING btree (job_id);
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_assignment_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_assignment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_group_capability_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_group_capability DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_group_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_group DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation', 'updated_at');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_group_member_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_group_member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_group_relation_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_group_relation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_person_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_person DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation', 'updated_at');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_person_position_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_person_position DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_position_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_position DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_provisioner_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_provisioner DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation', 'last_seen_at');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER auth_unit_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_unit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('organisation');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER boarding_item_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.boarding_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_boarding_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER boarding_layer_changed AFTER INSERT OR DELETE OR UPDATE ON public.boarding_layer DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('boarding-layers');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER boarding_layer_item_changed AFTER INSERT OR DELETE OR UPDATE ON public.boarding_layer_item DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('boarding-layers');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER boarding_plan_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.boarding_plan DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_boarding_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER boarding_plan_holder_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.boarding_plan_holder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_boarding_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_holding_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_holding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('person_id', 'registered_by', 'decided_by', 'validated_by', 'revoked_by');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_requirement_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_requirement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_aimed_changed('competence-catalogue', 'person_id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_share_target_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_share_target DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('competence-catalogue');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_source_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_source DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('competence-source', 'lease_until');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_source_mapping_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_source_mapping DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('competence-source');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER competence_type_changed AFTER INSERT OR DELETE OR UPDATE ON public.competence_type DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('competence-catalogue');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER connector_changed AFTER INSERT OR DELETE OR UPDATE ON public.connector DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('connectors');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER connector_policy_changed AFTER INSERT OR DELETE OR UPDATE ON public.connector DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_connector_policy_changed('health', 'manifest_offered', 'manifest_offered_at', 'manifest_at', 'secret_changed_at', 'created_by', 'updated_by', 'created_at', 'updated_at', 'version');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER delivery_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.attention_delivery DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_activity_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.dialogue_activity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('owner_id', 'created_by', 'done_by');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_area_changed AFTER INSERT OR DELETE OR UPDATE ON public.dialogue_area DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('dialogue-setup');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_assessment_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.dialogue_assessment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('author_id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_note_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.dialogue_note DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('author_id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER dialogue_question_changed AFTER INSERT OR DELETE OR UPDATE ON public.dialogue_question DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('dialogue-setup');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER execution_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.execution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER execution_job_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.execution_job DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER follow_binding_changed AFTER INSERT OR DELETE OR UPDATE ON public.follow_binding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('connectors');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER followup_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.followup_policy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_policy_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_access_grant DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_person_policy_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER installation_appearance_changed AFTER INSERT OR DELETE OR UPDATE ON public.installation_appearance DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('appearance');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER model_changed AFTER INSERT OR DELETE OR UPDATE ON public.model DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('models');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER model_choice_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.model_choice DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER model_menu_changed AFTER INSERT OR DELETE OR UPDATE ON public.model DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('model-menu', 'model', 'tools', 'reasoning', 'created_by', 'updated_by', 'created_at', 'updated_at', 'version');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER model_provider_changed AFTER INSERT OR DELETE OR UPDATE ON public.model_provider DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('models');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER person_policy_changed AFTER INSERT OR DELETE OR UPDATE ON public.auth_person DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_person_policy_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER proposal_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.proposal DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refresh_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.refresh_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER talk_commitment_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.talk_commitment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('employee_id', 'owner_id', 'created_by', 'done_by');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER talk_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.talk DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_people_changed('employee_id', 'held_by', 'booked_by');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER talk_round_changed AFTER INSERT OR DELETE OR UPDATE ON public.talk_round DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_shared_changed('talk-round');
--> statement-breakpoint
CREATE TRIGGER temporal_job_owner BEFORE INSERT ON public.job FOR EACH ROW EXECUTE FUNCTION public.clew_temporal_job_owner();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER thread_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.thread DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
CREATE TRIGGER thread_decision_revision
BEFORE UPDATE OF title, summary, actions, items, subjects, deadline, waiting_on, hand_on, handed_on_to, handed_on_at, state ON public.thread
FOR EACH ROW WHEN (
  (OLD.title, OLD.summary, OLD.actions, OLD.items, OLD.subjects, OLD.deadline, OLD.waiting_on, OLD.hand_on, OLD.handed_on_to, OLD.handed_on_at, OLD.state)
  IS DISTINCT FROM
  (NEW.title, NEW.summary, NEW.actions, NEW.items, NEW.subjects, NEW.deadline, NEW.waiting_on, NEW.hand_on, NEW.handed_on_to, NEW.handed_on_at, NEW.state)
)
EXECUTE FUNCTION public.clew_revise_card_decision();
--> statement-breakpoint
CREATE TRIGGER thread_occurrence_disposition AFTER UPDATE OF state ON public.thread FOR EACH ROW EXECUTE FUNCTION public.clew_occurrence_disposition();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER timer_content_changed AFTER INSERT OR DELETE OR UPDATE ON public.timer_intent DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.clew_content_changed();
--> statement-breakpoint
ALTER TABLE ONLY public.attention_day
    ADD CONSTRAINT attention_day_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.attention_delivery
    ADD CONSTRAINT attention_delivery_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.attention_delivery
    ADD CONSTRAINT attention_delivery_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.auth_access_grant
    ADD CONSTRAINT auth_access_grant_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_assignment
    ADD CONSTRAINT auth_assignment_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_assignment
    ADD CONSTRAINT auth_assignment_unit_id_auth_unit_id_fk FOREIGN KEY (unit_id) REFERENCES public.auth_unit(id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group_member
    ADD CONSTRAINT auth_group_member_group_id_auth_group_id_fk FOREIGN KEY (group_id) REFERENCES public.auth_group(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.auth_group_member
    ADD CONSTRAINT auth_group_member_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_identity_binding
    ADD CONSTRAINT auth_identity_binding_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.auth_person_position
    ADD CONSTRAINT auth_person_position_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.auth_person_position
    ADD CONSTRAINT auth_person_position_position_id_auth_position_id_fk FOREIGN KEY (position_id) REFERENCES public.auth_position(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_done_by_auth_person_id_fk FOREIGN KEY (done_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_owner_id_auth_person_id_fk FOREIGN KEY (owner_id) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_plan_id_boarding_plan_id_fk FOREIGN KEY (plan_id) REFERENCES public.boarding_plan(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_source_layer_id_boarding_layer_id_fk FOREIGN KEY (source_layer_id) REFERENCES public.boarding_layer(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_item
    ADD CONSTRAINT boarding_item_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_layer_item
    ADD CONSTRAINT boarding_layer_item_layer_id_boarding_layer_id_fk FOREIGN KEY (layer_id) REFERENCES public.boarding_layer(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan
    ADD CONSTRAINT boarding_plan_buddy_id_auth_person_id_fk FOREIGN KEY (buddy_id) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan_holder
    ADD CONSTRAINT boarding_plan_holder_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan_holder
    ADD CONSTRAINT boarding_plan_holder_plan_id_boarding_plan_id_fk FOREIGN KEY (plan_id) REFERENCES public.boarding_plan(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan
    ADD CONSTRAINT boarding_plan_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.boarding_plan
    ADD CONSTRAINT boarding_plan_started_by_auth_person_id_fk FOREIGN KEY (started_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_decided_by_auth_person_id_fk FOREIGN KEY (decided_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_registered_by_auth_person_id_fk FOREIGN KEY (registered_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_revoked_by_auth_person_id_fk FOREIGN KEY (revoked_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_source_fk FOREIGN KEY (connector_id) REFERENCES public.competence_source(connector_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_type_id_competence_type_id_fk FOREIGN KEY (type_id) REFERENCES public.competence_type(id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_holding
    ADD CONSTRAINT competence_holding_validated_by_auth_person_id_fk FOREIGN KEY (validated_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_requirement
    ADD CONSTRAINT competence_requirement_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_requirement
    ADD CONSTRAINT competence_requirement_type_id_competence_type_id_fk FOREIGN KEY (type_id) REFERENCES public.competence_type(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_share_target
    ADD CONSTRAINT competence_share_target_type_id_competence_type_id_fk FOREIGN KEY (type_id) REFERENCES public.competence_type(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_source
    ADD CONSTRAINT competence_source_connector_id_connector_id_fk FOREIGN KEY (connector_id) REFERENCES public.connector(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_source_mapping
    ADD CONSTRAINT competence_source_mapping_connector_id_connector_id_fk FOREIGN KEY (connector_id) REFERENCES public.connector(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.competence_source_mapping
    ADD CONSTRAINT competence_source_mapping_type_id_competence_type_id_fk FOREIGN KEY (type_id) REFERENCES public.competence_type(id);
--> statement-breakpoint
ALTER TABLE ONLY public.competence_type
    ADD CONSTRAINT competence_type_merged_into_competence_type_id_fk FOREIGN KEY (merged_into) REFERENCES public.competence_type(id);
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_activity
    ADD CONSTRAINT dialogue_activity_created_by_auth_person_id_fk FOREIGN KEY (created_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_activity
    ADD CONSTRAINT dialogue_activity_done_by_auth_person_id_fk FOREIGN KEY (done_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_activity
    ADD CONSTRAINT dialogue_activity_owner_id_auth_person_id_fk FOREIGN KEY (owner_id) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_activity
    ADD CONSTRAINT dialogue_activity_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_assessment
    ADD CONSTRAINT dialogue_assessment_author_id_auth_person_id_fk FOREIGN KEY (author_id) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.dialogue_note
    ADD CONSTRAINT dialogue_note_author_id_auth_person_id_fk FOREIGN KEY (author_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.dispatch_outbox
    ADD CONSTRAINT dispatch_outbox_execution_id_execution_id_fk FOREIGN KEY (execution_id) REFERENCES public.execution(id);
--> statement-breakpoint
ALTER TABLE ONLY public.execution_job
    ADD CONSTRAINT execution_job_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.execution
    ADD CONSTRAINT execution_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.followup_policy
    ADD CONSTRAINT followup_policy_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.followup_policy
    ADD CONSTRAINT followup_policy_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.handover_turn
    ADD CONSTRAINT handover_turn_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.model_choice
    ADD CONSTRAINT model_choice_model_id_model_id_fk FOREIGN KEY (model_id) REFERENCES public.model(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.model_choice
    ADD CONSTRAINT model_choice_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.model
    ADD CONSTRAINT model_provider_id_model_provider_id_fk FOREIGN KEY (provider_id) REFERENCES public.model_provider(id);
--> statement-breakpoint
ALTER TABLE ONLY public.proposal
    ADD CONSTRAINT proposal_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.proposal
    ADD CONSTRAINT proposal_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_request
    ADD CONSTRAINT refresh_request_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.talk
    ADD CONSTRAINT talk_booked_by_auth_person_id_fk FOREIGN KEY (booked_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_created_by_auth_person_id_fk FOREIGN KEY (created_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_done_by_auth_person_id_fk FOREIGN KEY (done_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_employee_id_auth_person_id_fk FOREIGN KEY (employee_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_owner_id_auth_person_id_fk FOREIGN KEY (owner_id) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_round_id_talk_round_id_fk FOREIGN KEY (round_id) REFERENCES public.talk_round(id);
--> statement-breakpoint
ALTER TABLE ONLY public.talk_commitment
    ADD CONSTRAINT talk_commitment_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk
    ADD CONSTRAINT talk_employee_id_auth_person_id_fk FOREIGN KEY (employee_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.talk
    ADD CONSTRAINT talk_held_by_auth_person_id_fk FOREIGN KEY (held_by) REFERENCES public.auth_person(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.talk
    ADD CONSTRAINT talk_round_id_talk_round_id_fk FOREIGN KEY (round_id) REFERENCES public.talk_round(id);
--> statement-breakpoint
ALTER TABLE ONLY public.thread_message
    ADD CONSTRAINT thread_message_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.thread
    ADD CONSTRAINT thread_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.thread_subject
    ADD CONSTRAINT thread_subject_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.timer_intent
    ADD CONSTRAINT timer_intent_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.timer_intent
    ADD CONSTRAINT timer_intent_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.watch_intent
    ADD CONSTRAINT watch_intent_job_id_execution_job_id_fk FOREIGN KEY (job_id) REFERENCES public.execution_job(id);
--> statement-breakpoint
ALTER TABLE ONLY public.watch_intent
    ADD CONSTRAINT watch_intent_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id);
--> statement-breakpoint
ALTER TABLE ONLY public.work_occurrence
    ADD CONSTRAINT work_occurrence_person_id_auth_person_id_fk FOREIGN KEY (person_id) REFERENCES public.auth_person(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.work_occurrence
    ADD CONSTRAINT work_occurrence_thread_id_thread_id_fk FOREIGN KEY (thread_id) REFERENCES public.thread(id) ON DELETE SET NULL;
