import { Type, type Static } from '@sinclair/typebox';
import { MenuHintSchema, MenuIconSchema, SearchHitSchema, SearchKind, SearchOutputSchema, ThreadActionSchema, ThreadItemSchema, ViewSchema } from '@clew/contracts';

/**
 * The Clew connector protocol (D21): how a connector that is not part of this repository plugs into a running Clew.
 * A connector is an HTTP service. Clew loads and refreshes its registered manifest and calls it as the
 * acting person. The shapes here are the contract; `docs/protocol/connector-protocol.schema.json` is generated
 * from them (`bun run protocol:schema`) so a connector can be written in any language against plain JSON Schema.
 *
 * A read capability may declare a `view` (D38): how Clew draws its output (a table, a list, one record, a text), as data.
 * The connector never sends markup; a capability without a view is drawn by Clew's generic rules. A view that
 * opens without input can be a tool in Clew's menu (D40): an administrator chooses which, and `menu` on the capability
 * says what its row is called.
 *
 * Routes a connector serves (all JSON, all under the base URL Clew is configured with):
 *   GET  /clew/manifest                 -> ConnectorManifest
 *   POST /clew/capabilities/{name}      CallRequest  -> CallResponse
 *   POST /clew/scan                     ScanRequest  -> ScanResponse        (only when manifest.scan is true)
 *   POST /clew/figure                   FigureRequest -> FigureResponse     (only for areas with figure: true)
 * Every POST carries an installation-signed RS256 bearer assertion and X-Clew-Connector-Key (transport only).
 * Verify public keys at the configured Clew URL, issuer, audience, subject/actor and bounded lifetime (D44).
 * A callback uses the separate signed `callback` claim, never the request assertion, and only targets declared
 * in `uses`. See docs/guides/authorization.md and docs/reference/connector-protocol.md.
 */
export const PROTOCOL_VERSION = 2;
const object = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T, description?: string) => Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const swedish = (description: string) => Type.String({ minLength: 1, maxLength: 200, description });
/** Any JSON Schema document. Clew validates inputs with it before calling the connector. */
const jsonSchema = Type.Record(Type.String(), Type.Unknown(), { description: 'A JSON Schema (draft 2020-12 or 7) for the value.' });

export const RoleSchema = Type.Union([Type.Literal('manager'), Type.Literal('employee')]);
export const ActorSchema = object({
  id: Type.String({ minLength: 1, maxLength: 80 }), name: Type.String(), unitId: Type.String(), unitLabel: Type.String(), role: RoleSchema,
}, 'The acting person as Clew knows them. Never a token.');
export type ProtocolActor = Static<typeof ActorSchema>;
export const ScopeRuleSchema = object({ roles: Type.Optional(Type.Array(RoleSchema, { uniqueItems: true })) },
  'Who may call the capability at all. Omitted roles means every signed-in person. The connector narrows further in the call.');
/**
 * A fact kind a connector brings about (D55): `<connector id>:<kind>`, such as `hr:absence`. The name is its contract (D37):
 * a new optional attribute or a looser constraint keeps the name; anything else is a new kind, the old one deprecated.
 */
const FACT_KIND = '^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$';
export const FactKindName = Type.String({ pattern: FACT_KIND, maxLength: 80, description: '`<connector id>:<kind>`, stable: the name is the contract.' });
const capabilityName = Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80 });
export const ManifestFactSchema = object({
  kind: FactKindName,
  title: swedish('Swedish. What the fact is called on a job: "Sjukfrånvaro".'),
  attributes: jsonSchema,
}, 'A fact this connector creates, with the JSON Schema of its attributes. Followers receive exactly these attributes.');
/** What a follower is asked with (D55): the fact, with `ref` when it already exists in its source and absent when the job would create it. */
export const FactEnvelopeSchema = object({
  fact: object({ kind: FactKindName, ref: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })), attributes: Type.Record(Type.String(), Type.Unknown()) }),
}, 'The input of every `follows` capability.');
/**
 * One step a follower proposes for a job (D55). It names a capability of the follower's own connector only: an `execute`
 * with its approved payload, or a `watch`, a read Clew repeats within a bounded window until `expect` holds. A follower
 * never writes; the person approves the job once and Clew runs each step as its own execution or watch.
 */
export const StepDraftSchema = Type.Union([
  object({ kind: Type.Literal('execute'), operation: capabilityName, payload: Type.Unknown(), title: swedish('Swedish. The step on the job card.'), detail: Type.Optional(swedish('Swedish. One line under the title.')) }),
  object({ kind: Type.Literal('watch'), operation: capabilityName, input: Type.Unknown(),
    expect: object({ path: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 10 }), equals: Type.Unknown() }, 'The value at `path` in the read\'s output must equal `equals` for the fact to count as seen.'),
    within: Type.String({ pattern: '^P(?!$)(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?)?$', description: 'ISO 8601 duration (days, hours, minutes) the watch lasts, e.g. `P1D`, `PT4H`.' }),
    title: swedish('Swedish. The step on the job card.'), detail: Type.Optional(swedish('Swedish. One line under the title.')) }),
]);
export const FollowResponseSchema = object({ steps: Type.Array(StepDraftSchema, { maxItems: 10 }) }, 'What a `follows` capability returns. Zero steps means nothing to do for this fact.');
export const ManifestCapabilitySchema = object({
  execution: Type.Optional(Type.Union([
    object({ strategy: Type.Literal('manual') }),
    object({ strategy: Type.Literal('deduplicated'), retentionSeconds: Type.Integer({ minimum: 1 }), lookup: Type.String() }),
    object({ strategy: Type.Literal('conditional'), lookup: Type.String() }),
  ])),
  name: Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80, description: '`<connector id>.<verb>`, stable.' }),
  kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]),
  title: swedish('Swedish. A button label.'),
  description: swedish('Swedish. What the model reads when `model` is true.'),
  input: jsonSchema, output: jsonSchema,
  model: Type.Boolean({ description: 'Offer it to the model as a tool. Must be false for execute (D8).' }),
  scope: ScopeRuleSchema,
  kinds: Type.Optional(Type.Array(SearchKind, { uniqueItems: true, description: 'For `<id>.search` (D26): what it can find. Its output is a SearchOutput; `<id>.fetch` takes one of its refs back and returns one SearchHit.' })),
  view: Type.Optional(ViewSchema),
  menu: Type.Optional(MenuHintSchema),
  follows: Type.Optional(Type.Array(FactKindName, { uniqueItems: true, maxItems: 20, description: 'For a `propose` (D55): the fact kinds it answers for. Input is a FactEnvelope, output a FollowResponse; steps name this connector only.' })),
  creates: Type.Optional(Type.String({ pattern: FACT_KIND, maxLength: 80, description: 'The fact kind this `propose` or `execute` brings about (D55); must be one of the manifest\'s `facts`.' })),
});
export const ManifestAreaSchema = object({
  id: Type.String({ pattern: '^[a-z][a-z0-9-]*$', maxLength: 40 }), title: swedish('Swedish. The sidebar entry.'),
  roles: Type.Array(RoleSchema, { minItems: 1, uniqueItems: true }),
  standing: Type.Array(Type.String(), { description: 'Capability names shown under "Gör själv".' }),
  schedules: Type.Array(object({ label: Type.String(), when: Type.String() })),
  figure: Type.Optional(Type.Boolean({ description: 'Clew asks POST /clew/figure for a one-line figure for this area.' })),
  icon: Type.Optional(MenuIconSchema),
});
/**
 * The connector calls its system as the person (D26): Clew trades the person's session for a token bound to this audience
 * (RFC 8693 at the IdP) and sends it in `X-Clew-Delegated-Token` beside the assertion. Absent in scans, figures, callbacks
 * and sessions without an IdP token; the connector then answers `denied`.
 */
export const DelegationSchema = object({
  audience: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$', description: 'The OAuth audience (an IdP client id) the token must be bound to.' }),
}, 'The connector acts as the person against its system with a token Clew obtains by token exchange.');
export const ConnectorManifestSchema = Type.Object({
  protocol: Type.Literal(PROTOCOL_VERSION),
  id: Type.String({ pattern: '^[a-z][a-z0-9-]*$', maxLength: 40, description: 'Must match the id Clew was configured with.' }),
  kind: Type.Union([Type.Literal('passthrough'), Type.Literal('derived')], { description: 'Core connectors live in Clew itself (D3).' }),
  source: swedish('Swedish. The system as shown on cards: "Personalsystemet".'),
  areas: Type.Array(ManifestAreaSchema),
  capabilities: Type.Array(ManifestCapabilitySchema),
  uses: Type.Optional(Type.Array(Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$' }), { uniqueItems: true, maxItems: 100 })),
  facts: Type.Optional(Type.Array(ManifestFactSchema, { maxItems: 50, description: 'The fact kinds this connector creates (D55), each prefixed with its id.' })),
  scan: Type.Boolean({ description: 'Whether Clew should POST /clew/scan for each person nightly and on first visit.' }),
  delegation: Type.Optional(DelegationSchema),
}, { additionalProperties: false, $id: 'https://clew.dev/protocol/2/connector-manifest.schema.json', title: 'Clew connector manifest' });
export type ConnectorManifest = Static<typeof ConnectorManifestSchema>;

export const CallRequestSchema = object({ actor: ActorSchema, input: Type.Unknown() });
export type CallRequest = Static<typeof CallRequestSchema>;
export const ProtocolErrorSchema = object({
  code: Type.Union([Type.Literal('invalid'), Type.Literal('denied'), Type.Literal('not-found'), Type.Literal('unavailable'), Type.Literal('unknown')]),
  message: swedish('Swedish. Shown to the person.'),
});
export const CallResponseSchema = Type.Union([object({ output: Type.Unknown() }), object({ error: ProtocolErrorSchema })]);
export type CallResponse = Static<typeof CallResponseSchema>;
export const ThreadDraftSchema = object({
  occurrences: Type.Optional(Type.Array(object({ key: Type.String({ minLength: 1, maxLength: 400 }), revision: Type.String({ maxLength: 400 }), period: Type.String({ minLength: 1, maxLength: 100 }) }), { minItems: 1, maxItems: 100 })),
  topic: Type.String({ minLength: 1, maxLength: 120, description: 'Idempotency key per person: the same occurrence gives the same topic.' }),
  area: Type.String(), title: Type.String(), summary: Type.String(),
  reason: Type.String({ description: 'Swedish. Shown under "Varför ser jag detta?".' }),
  items: Type.Optional(Type.Array(ThreadItemSchema)), actions: Type.Array(ThreadActionSchema),
  waitingOn: Type.Optional(Type.Union([Type.String(), Type.Null()])), deadline: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export const ScanRequestSchema = object({ actor: ActorSchema });
export const ScanResponseSchema = object({ drafts: Type.Array(ThreadDraftSchema), observation: Type.Optional(object({
  scope: Type.String(), observedAt: Type.String({ format: 'date-time' }), version: Type.String(), exhausted: Type.Boolean(),
  completeness: Type.Union((['complete', 'delta', 'partial', 'unavailable', 'authorization-required'] as const).map(v => Type.Literal(v))),
  tombstones: Type.Optional(Type.Array(object({ key: Type.String(), period: Type.String() }))),
})) });
export type ScanResponse = Static<typeof ScanResponseSchema>;
export const FigureRequestSchema = object({ actor: ActorSchema, area: Type.String() });
export const FigureResponseSchema = object({ figure: Type.Union([object({ label: Type.String(), tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert'), Type.Literal('none')]) }), Type.Null()]) });
export type FigureResponse = Static<typeof FigureResponseSchema>;
export const ExecuteResultSchema = object({
  headline: Type.String(),
  rows: Type.Array(object({ ref: Type.String(), label: Type.String(), outcome: Type.Union([Type.Literal('done'), Type.Literal('unknown'), Type.Literal('failed'), Type.Literal('skipped')]), detail: Type.String() })),
  undoCapability: Type.Optional(Type.String()), undoMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1440 })),
  undoInput: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, 'What an execute capability returns: one outcome per ref, read back from the source.');
/** What a connector sends to `POST {CLEW_URL}/api/connectors/call` with its separate callback grant. */
export const CallbackRequestSchema = object({ name: Type.String({ maxLength: 80 }), input: Type.Optional(Type.Unknown()) });
export type CallbackRequest = Static<typeof CallbackRequestSchema>;

/** The whole protocol as one JSON Schema document with `$defs`, for connector authors outside this repository. */
export function protocolSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://clew.dev/protocol/2/connector-protocol.schema.json',
    title: 'Clew connector protocol',
    description: 'Shapes exchanged between Clew and a connector service. See docs/reference/connector-protocol.md.',
    $defs: {
      ConnectorManifest: ConnectorManifestSchema, Actor: ActorSchema, CallRequest: CallRequestSchema, CallResponse: CallResponseSchema,
      ProtocolError: ProtocolErrorSchema, ExecuteResult: ExecuteResultSchema, ScanRequest: ScanRequestSchema, ScanResponse: ScanResponseSchema,
      ThreadDraft: ThreadDraftSchema, FigureRequest: FigureRequestSchema, FigureResponse: FigureResponseSchema, CallbackRequest: CallbackRequestSchema,
      SearchHit: SearchHitSchema, SearchOutput: SearchOutputSchema, Delegation: DelegationSchema, View: ViewSchema, Menu: MenuHintSchema,
      ManifestFact: ManifestFactSchema, FactEnvelope: FactEnvelopeSchema, StepDraft: StepDraftSchema, FollowResponse: FollowResponseSchema,
    },
  };
}

/**
 * Versions (D57). `protocol` is the version of this contract, not of a connector: a connector has no version, a
 * capability's name is its contract (D37). An additive change (a new optional field, a looser constraint) keeps the
 * number; views, the menu, delegation and facts all arrived under 2. A break is a new number, and Clew then accepts the
 * new number and the one before it for a stated window, loading a manifest on the older one with a warning in
 * administration rather than refusing it. The one exception is a security change, which retires the old number at
 * once with its reason recorded here; that is what happened to 1.
 */
export const PROTOCOL_ACCEPTED: readonly number[] = [PROTOCOL_VERSION];
export const PROTOCOL_RETIRED: Readonly<Record<number, string>> = {
  1: 'retired 2026-11-05: shared-secret (HS256) identity signing was replaced by RS256 installation keys (D44). Move the verifier to the installation\'s public keys and declare protocol 2.',
};

/**
 * What Clew makes of a manifest document before any service runs (D57): the problems it would refuse it for, else what it
 * would offer to whom. `POST /api/protocol/manifest` answers with it; `previewManifest` in preview.ts computes it.
 */
const previewRoles = Type.Array(RoleSchema, { description: 'Who may call it: both roles when the capability names none.' });
export const ManifestPreviewCapabilitySchema = object({
  name: Type.String(), kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]), title: Type.String(),
  roles: previewRoles,
  tool: Type.Boolean({ description: 'Offered to the model as a tool once an administrator enables tools for the connector.' }),
  needsInput: Type.Boolean({ description: 'Its input schema does not accept `{}`, so neither the conformance check nor a menu row can open it without a question.' }),
  view: Type.Union([Type.Literal('table'), Type.Literal('list'), Type.Literal('detail'), Type.Literal('text'), Type.Null()], { description: 'How Clew draws its output, or null for the generic rules.' }),
  menu: Type.Union([MenuHintSchema, Type.Null()], { description: 'The row an administrator could put in the menu under Verktyg (D40), or null when the capability cannot be one.' }),
  check: Type.String({ description: 'What the conformance check (`Testa anslutning`, `connector-check.ts`) does with it.' }),
  follows: Type.Optional(Type.Array(FactKindName)), creates: Type.Optional(FactKindName),
});
export const ManifestPreviewSchema = object({
  ok: Type.Boolean({ description: 'Whether Clew would load the document.' }),
  protocol: object({ current: Type.Integer(), accepted: Type.Array(Type.Integer()) }, 'The protocol version this instance speaks and the versions it loads.'),
  problems: Type.Array(Type.String(), { description: 'Every reason the document would be refused, in the order Clew finds them. Empty when ok.' }),
  manifest: Type.Optional(object({
    id: Type.String(), source: Type.String(), kind: Type.Union([Type.Literal('passthrough'), Type.Literal('derived')]), scan: Type.Boolean(),
    delegation: Type.Union([Type.String(), Type.Null()], { description: 'The audience Clew would obtain the person\'s token for, or null.' }),
    uses: Type.Array(Type.String()), facts: Type.Array(FactKindName),
    capabilities: Type.Array(ManifestPreviewCapabilitySchema),
    areas: Type.Array(object({ id: Type.String(), title: Type.String(), roles: Type.Array(RoleSchema), standing: Type.Array(Type.String()), figure: Type.Boolean(), icon: Type.Union([MenuIconSchema, Type.Null()]) })),
    menu: Type.Array(object({ capability: Type.String(), label: Type.String(), icon: MenuIconSchema }), { description: 'The rows an administrator could put in the menu.' }),
  }, 'Present when ok: the manifest as Clew would hold it.')),
}, 'A dry run of a manifest document against this instance\'s rules.');
export type ManifestPreview = Static<typeof ManifestPreviewSchema>;

export interface OpenApiOptions {
  /** The installation's public base URL. Absent, the document carries a server variable for it. */
  clewUrl?: string;
}
/**
 * The protocol as an OpenAPI 3.1 document (D57), for a viewer, a client or a server-stub generator. Two sides: the routes a
 * connector serves and Clew calls (tag Connector), and the routes Clew serves and a connector calls (tag Clew). The
 * schemas are the same TypeBox objects the instance validates with, so the document matches the instance by construction.
 */
export function openApiDocument(options: OpenApiOptions = {}) {
  const defs: Record<string, unknown> = { ...protocolSchema().$defs, ManifestPreview: ManifestPreviewSchema };
  const schemas = Object.fromEntries(Object.entries(defs).map(([name, schema]) => { const { $id: _id, ...rest } = schema as Record<string, unknown>; return [name, rest]; }));
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (name: string, description: string) => ({ description, content: { 'application/json': { schema: ref(name) } } });
  const body = (name: string) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
  const connector = [{ url: '{connector}', description: 'The base URL the connector is registered with in Clew. Every path below is relative to it.', variables: { connector: { default: 'http://127.0.0.1:4020' } } }];
  const clew = [options.clewUrl ? { url: options.clewUrl, description: 'This Clew installation.' } : { url: '{clew}', description: 'The Clew installation (the CLEW_URL a connector is configured with).', variables: { clew: { default: 'http://localhost:3020' } } }];
  const signed = [{ clewAssertion: [], connectorKey: [] }];
  const text = (description: string) => ({ type: 'string', description });
  const refused = {
    '401': { description: 'The transport key or the assertion was rejected. Required: an invalid credential is never answered with data; the conformance check probes this.' },
    '403': json('CallResponse', 'Denied: `error.code` is `denied`, `error.message` is Swedish and shown to the person.'),
    '503': json('CallResponse', 'The source is unavailable: `error.code` is `unavailable`. For a write this does not say whether the effect happened.'),
  };
  const operationId = { name: 'X-Clew-Operation-Id', in: 'header', required: false, schema: text('The durable operation id of an approved write (D45). Deduplicate on it; the same id means the same approved operation.') };
  const delegated = { name: 'X-Clew-Delegated-Token', in: 'header', required: false, schema: text('The person\'s own token for the connector\'s system (D26), present only when the manifest declares `delegation` and a session is behind the call.') };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Clew connector protocol', version: String(PROTOCOL_VERSION),
      summary: 'How a connector service and a Clew installation talk to each other.',
      description: 'A connector is an HTTP service of your own. It serves the routes tagged **Connector**; Clew loads its manifest and calls it as the acting person, with an RS256 assertion it can verify against the keys at the route tagged **Clew**. Shapes are the same JSON Schemas the instance validates with, published under `components.schemas` and, as one bundle, as `connector-protocol.schema.json` under `/api/protocol/`. Generate server stubs from this document or implement the paths by hand; the examples under `connectors/` in the repository are complete. Try `POST /api/protocol/manifest` with a manifest before any service exists.',
    },
    'x-clew-protocol': { current: PROTOCOL_VERSION, accepted: [...PROTOCOL_ACCEPTED], retired: PROTOCOL_RETIRED },
    tags: [
      { name: 'Connector', description: 'Routes the connector serves and Clew calls. All JSON, all under the registered base URL. Every POST carries `Authorization: Bearer <assertion>` and `X-Clew-Connector-Key`; take the actor from the verified assertion, never from the body.' },
      { name: 'Clew', description: 'Routes Clew serves and a connector calls: its public keys, the callback for declared dependencies, and this protocol.' },
    ],
    paths: {
      '/clew/manifest': { servers: connector, get: { tags: ['Connector'], operationId: 'getManifest', summary: 'The manifest', description: 'Clew loads it at registration, on "Hämta manifest igen" and on a schedule. No assertion is sent. Keep credentials and source data out of it.', responses: { '200': json('ConnectorManifest', 'The manifest. Clew validates it against `ConnectorManifest` and the rules `POST /api/protocol/manifest` applies.') } } },
      '/clew/capabilities/{name}': { servers: connector, post: { tags: ['Connector'], operationId: 'callCapability', summary: 'Run a capability as the person', security: signed,
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$' }, description: 'The full capability name from the manifest, `<id>.<verb>`.' }, operationId, delegated],
        requestBody: body('CallRequest'),
        responses: { '200': json('CallResponse', 'The output, validated against the capability\'s declared output schema. An execute answers with an `ExecuteResult`.'), '400': json('CallResponse', 'Invalid input: `error.code` is `invalid`.'), ...refused, '404': json('CallResponse', 'An unknown ref or capability: `error.code` is `not-found`.') } } },
      '/clew/scan': { servers: connector, post: { tags: ['Connector'], operationId: 'scan', summary: 'Drafts for the person\'s cards', description: 'Only when the manifest says `scan: true`. Called nightly and on first visit per person; must be idempotent: the same occurrence gives the same topic.', security: signed, requestBody: body('ScanRequest'), responses: { '200': json('ScanResponse', 'Drafts and, optionally, what was observed.'), ...refused } } },
      '/clew/figure': { servers: connector, post: { tags: ['Connector'], operationId: 'figure', summary: 'One line for an area', description: 'Only for an area declaring `figure: true`.', security: signed, requestBody: body('FigureRequest'), responses: { '200': json('FigureResponse', 'The figure or null.'), ...refused } } },
      '/api/connectors/jwks': { servers: clew, get: { tags: ['Clew'], operationId: 'getJwks', summary: 'The installation\'s public signing keys', description: 'Pin this URL in deployment configuration and verify every assertion against it (`alg` RS256, `iss` clew, `aud` your connector id, a known `kid`, a bounded lifetime). Never follow a key URL from a token.', responses: { '200': { description: 'A JWK Set.', content: { 'application/json': { schema: { type: 'object', required: ['keys'], properties: { keys: { type: 'array', items: { type: 'object' } } } } } } } } } },
      '/api/connectors/call': { servers: clew, post: { tags: ['Clew'], operationId: 'callback', summary: 'Run another connector\'s read or propose as the person', description: 'The bearer is the `callback` grant from the verified request assertion, never the assertion itself. Only targets declared in the manifest\'s `uses`; identity is rebuilt from the person\'s current grant; `execute` is refused.', security: [{ callbackGrant: [] }], requestBody: body('CallbackRequest'),
        responses: { '200': { description: 'The target\'s output.', content: { 'application/json': { schema: { type: 'object', required: ['output'], properties: { output: {} } } } } }, '400': json('CallResponse', 'Invalid request or input.'), '401': json('CallResponse', 'Missing or invalid grant.'), '403': json('CallResponse', 'Denied: the person, the origin or the target is out of scope.'), '404': json('CallResponse', 'Unknown capability.'), '503': json('CallResponse', 'The target is unavailable.') } } },
      '/api/protocol/openapi.json': { servers: clew, get: { tags: ['Clew'], operationId: 'getOpenApi', summary: 'This document, as this instance speaks it', responses: { '200': { description: 'OpenAPI 3.1.', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/api/protocol/connector-protocol.schema.json': { servers: clew, get: { tags: ['Clew'], operationId: 'getProtocolSchema', summary: 'The JSON Schema bundle', description: 'Every shape under `$defs`, for a connector written in any language.', responses: { '200': { description: 'JSON Schema 2020-12 with `$defs`.', content: { 'application/json': { schema: { type: 'object' } } } } } } },
      '/api/protocol/manifest': { servers: clew, post: { tags: ['Clew'], operationId: 'previewManifest', summary: 'Dry-run a manifest against this instance', description: 'Send a manifest document and read what this instance would refuse it for, else what it would offer to whom. No service, registration or sign-in is needed. Pass `?id=` to check the id against the one you will register.', parameters: [{ name: 'id', in: 'query', required: false, schema: { type: 'string' } }],
        requestBody: body('ConnectorManifest'), responses: { '200': json('ManifestPreview', 'The verdict and, when ok, the manifest as Clew would hold it.'), '400': { description: 'The body is not JSON.' } } } },
    },
    components: {
      schemas,
      securitySchemes: {
        clewAssertion: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'RS256 assertion signed by the installation: who is acting, for which connector, for at most two minutes. Verify against `/api/connectors/jwks`.' },
        connectorKey: { type: 'apiKey', in: 'header', name: 'X-Clew-Connector-Key', description: 'The transport secret from the registration. Transport authentication only; it never asserts a person.' },
        callbackGrant: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'The `callback` claim of a verified request assertion, audience `clew:connector-callback`.' },
      },
    },
  };
}
