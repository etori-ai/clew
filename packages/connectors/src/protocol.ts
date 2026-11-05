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
    },
  };
}
