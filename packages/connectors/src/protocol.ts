import { Type, type Static } from 'typebox';
import {
  AboutSchema,
  EntityKind,
  PersonAccessSchema,
  PersonRelationSchema,
  UnitAccessSchema,
  UnitRelationSchema,
  ASKS_MAX,
  AskSchema,
  EffectOutputSchema,
  MenuHintSchema,
  MenuIconSchema,
  PreviewOutputSchema,
  SearchHitSchema,
  ErrandRowSchema,
  ErrandsOutputSchema,
  RequestRowSchema,
  RequestsOutputSchema,
  NewsRowSchema,
  NewsOutputSchema,
  TalkRowSchema,
  TalksOutputSchema,
  CommitmentRowSchema,
  CommitmentsOutputSchema,
  SearchKind,
  SearchOutputSchema,
  ThreadActionSchema,
  ThreadItemSchema,
  ViewSchema,
  DocumentRequestSchema,
  DocumentBundleSchema,
  ReviewEvidenceSchema,
  MetricsSchema,
  SeriesSchema,
  ActivitySchema,
  HoldingSchema,
  HoldingsInputSchema,
  HoldingsOutputSchema,
  HoldingsRowSchema,
  AssistantAskEventSchema,
  AssistantAskSchema,
  SourceAssistantsOutputSchema,
  literals,
  type ConnectorHealth,
} from '@clew/contracts';

/**
 * The Clew connector protocol (D21): how a connector that is not part of this repository plugs into a running Clew.
 * A connector is an HTTP service. Clew loads and refreshes its registered manifest and calls it as the
 * acting person. The shapes here are the contract; `docs/protocol/connector-protocol.schema.json` is generated
 * from them (`bun run protocol:schema`) so a connector can be written in any language against plain JSON Schema.
 *
 * A read capability may declare a `view` (D38): how Clew draws its output (a table, a list, one record, a text), as data.
 * The connector never sends markup; a capability without a view is drawn by Clew's generic rules. A view that
 * opens without input can be a tool in Clew's menu (D40): an administrator chooses which, and `menu` on the capability
 * says what its row is called. A capability may say what its rows are `about` (D97), a person or a unit: a read asked
 * with a batch of keys, or an action that takes one. It never says where it shows; Clew places it from the declaration.
 *
 * Routes a connector serves (all JSON, all under the base URL Clew is configured with):
 *   GET  /clew/manifest                 -> ConnectorManifest
 *   POST /clew/capabilities/{name}      CallRequest  -> CallResponse
 *   POST /clew/installation/{name}      InstallationCallRequest -> CallResponse (only for manifest.installation, D119)
 *   POST /clew/scan                     ScanRequest  -> ScanResponse        (only when manifest.scan is true)
 *   POST /clew/figure                   FigureRequest -> FigureResponse     (only for areas with figure: true)
 * Every POST carries an installation-signed RS256 bearer assertion and X-Clew-Connector-Key (transport only).
 * Verify public keys at the configured Clew URL, issuer, audience, subject/actor and bounded lifetime (D44), and that
 * the assertion was issued for this request: its `body` claim the SHA-256 of the exact body, its `capability` claim the
 * capability of the route (D117). When the input names people or units, Clew has already left out every key the caller
 * may not ask about, and the body's `about` says how the caller stands to each key sent (`CallAbout`).
 * On `/clew/installation/{name}` no person is behind the call (D119): the assertion carries no `actor`, its subject is
 * `clew:installation` and its `caller` claim `installation`, bound to the body and the name as every call is. Answer it
 * only to that assertion, and never answer a person's assertion there.
 * A callback uses the separate signed `callback` claim, never the request assertion, and only targets declared
 * in `uses`. See docs/guides/authorization.md and docs/reference/connector-protocol.md.
 */
export const PROTOCOL_VERSION = 3;
/** The route Clew posts a read it makes as the installation to (D119): never the person's route. */
export const INSTALLATION_ROUTE = '/clew/installation/';
/** The subject of the installation's own assertion (D119). Not a person's id: Clew signs a person with their id. */
export const INSTALLATION_SUBJECT = 'clew:installation';
/** The claim that says an assertion is the installation's own and not a person's (D119). */
export const INSTALLATION_CALLER = 'installation';
/**
 * The reads a connector may declare for the installation (D119), as `<id>.<profile>`: the profiles Clew reads with no
 * person behind the call. The holdings profile of D108 item 9 is the first and, for now, the only one.
 */
export const INSTALLATION_PROFILES = ['holdings'] as const;
/** The protocol before it (D60): still loaded for a stated window, its connectors shown with a warning (`PROTOCOL_DEPRECATED`). */
export const PROTOCOL_PREVIOUS = 2;
const object = <T extends Record<string, import('typebox').TSchema>>(properties: T, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const swedish = (description: string) => Type.String({ minLength: 1, maxLength: 200, description });
/** Any JSON Schema document. Clew validates inputs with it before calling the connector. */
const jsonSchema = Type.Record(Type.String(), Type.Unknown(), {
  description: 'A JSON Schema (draft 2020-12 or 7) for the value.',
});
const jsonSchemaOf = (description: string) => Type.Record(Type.String(), Type.Unknown(), { description });

export const RoleSchema = Type.Union([Type.Literal('manager'), Type.Literal('employee')]);
export const ActorSchema = object(
  {
    id: Type.String({ minLength: 1, maxLength: 80 }),
    name: Type.String(),
    unitId: Type.String(),
    unitLabel: Type.String(),
    role: RoleSchema,
    userName: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 512,
        description:
          "The person's provisioned directory user name (SCIM `userName`, D68): the key your system knows them by, and the key a read about a person is asked with (D97). Absent for a person provisioned without one.",
      }),
    ),
    units: Type.Optional(
      Type.Array(object({ unitId: Type.String({ minLength: 1, maxLength: 256 }), unitLabel: Type.String() }), {
        maxItems: 200,
        description:
          "The units a manager follows up (D117): their own, managed or placed on, and those of the managers who report to them (D99). Present on a manager's reads about a person or a unit and on the views they open; a read about a unit may answer for these units and must refuse every other. Absent means `unitId` alone.",
      }),
    ),
  },
  'The acting person as Clew knows them. Never a token.',
);
export type ProtocolActor = Static<typeof ActorSchema>;
/**
 * `about` in a call's body (D117): how the actor stands to each person or unit the call's input names, resolved by Clew
 * from its own directory before the call. The assertion binds the body, so a connector may trust it as it trusts the
 * actor, and may answer `self` differently from `managed` without a copy of the organisation. In the body rather than the
 * bearer, so a batch of long keys never makes a header too large for a proxy.
 */
export const CallAboutSchema = object(
  {
    entity: EntityKind,
    relations: Type.Record(
      Type.String({ minLength: 1, maxLength: 512 }),
      Type.Union([PersonRelationSchema, UnitRelationSchema]),
      {
        description:
          "Every key the input carries (each of `keys`, or the value of the property that takes one key), exactly as the input spells it, mapped to how the actor stands to it: a person's `self`, `managed` or `colleague`, a unit's `manages`, `member` or `below`. Clew sends no key the capability does not admit, so a key the input carries and this map does not name is one Clew did not vouch for: answer it as no row.",
      },
    ),
  },
  "How the actor stands to the people or units the input names (D117), present when the input names any. Trust it only from a body whose digest the verified assertion's `body` claim holds.",
);
export type CallAbout = Static<typeof CallAboutSchema>;
export const ScopeRuleSchema = object(
  {
    roles: Type.Optional(
      Type.Array(RoleSchema, {
        uniqueItems: true,
        description:
          '`manager`, `employee` or both. Omitted means both. A role outside the list is refused before the connector is called.',
      }),
    ),
  },
  'Who may call the capability at all. Omitted roles means every signed-in person. The connector narrows further in the call.',
);
/**
 * A fact kind a connector brings about (D55): `<connector id>:<kind>`, such as `hr:absence`. The name is its contract (D37):
 * a new optional attribute or a looser constraint keeps the name; anything else is a new kind, the old one deprecated.
 */
const FACT_KIND = '^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$';
export const FactKindName = Type.String({
  pattern: FACT_KIND,
  maxLength: 80,
  description: '`<connector id>:<kind>`, stable: the name is the contract.',
});
const capabilityName = Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$', maxLength: 80 });
export const ManifestFactSchema = object(
  {
    kind: FactKindName,
    title: swedish('Swedish. What the fact is called on a job: "Sjukfrånvaro".'),
    attributes: jsonSchemaOf(
      "JSON Schema of the fact's attributes. A follower receives exactly these; a new optional attribute keeps the kind, anything else is a new kind (D37).",
    ),
  },
  'A fact this connector creates, with the JSON Schema of its attributes. Followers receive exactly these attributes.',
);
/** What a follower is asked with (D55): the fact, with `ref` when it already exists in its source and absent when the job would create it. */
export const FactEnvelopeSchema = object(
  {
    fact: object({
      kind: FactKindName,
      ref: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
      attributes: Type.Record(Type.String(), Type.Unknown()),
    }),
  },
  'The input of every `follows` capability.',
);
export type FactEnvelope = Static<typeof FactEnvelopeSchema>;
/**
 * One step a follower proposes for a job (D55). It names a capability of the follower's own connector only: an `execute`
 * with its approved payload, or a `watch`, a read Clew repeats within a bounded window until `expect` holds. A follower
 * never writes; the person approves the job once and Clew runs each step as its own execution or watch.
 */
export const StepDraftSchema = Type.Union([
  object({
    kind: Type.Literal('execute'),
    operation: capabilityName,
    payload: Type.Unknown(),
    title: swedish('Swedish. The step on the job card.'),
    detail: Type.Optional(swedish('Swedish. One line under the title.')),
  }),
  object({
    kind: Type.Literal('watch'),
    operation: capabilityName,
    input: Type.Unknown(),
    expect: object(
      { path: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 10 }), equals: Type.Unknown() },
      "The value at `path` in the read's output must equal `equals` for the fact to count as seen.",
    ),
    within: Type.String({
      pattern: '^P(?!$)(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?)?$',
      description: 'ISO 8601 duration (days, hours, minutes) the watch lasts, e.g. `P1D`, `PT4H`.',
    }),
    title: swedish('Swedish. The step on the job card.'),
    detail: Type.Optional(swedish('Swedish. One line under the title.')),
  }),
]);
export const FollowResponseSchema = object(
  { steps: Type.Array(StepDraftSchema, { maxItems: 10 }) },
  'What a `follows` capability returns. Zero steps means nothing to do for this fact.',
);
export const ManifestCapabilitySchema = object({
  execution: Type.Optional(
    Type.Union(
      [
        object({
          strategy: Type.Literal('manual', {
            description: 'Clew never repeats a write by itself; a lost answer is an unknown outcome a person resolves.',
          }),
        }),
        object({
          strategy: Type.Literal('deduplicated', {
            description:
              'The source keeps the operation id Clew sends in `X-Clew-Operation-Id` and answers a repeat with the original result.',
          }),
          retentionSeconds: Type.Integer({
            minimum: 1,
            description: 'How long, in seconds, the source remembers an operation id.',
          }),
          lookup: Type.String({
            description:
              "This connector's read that takes `{ operationId }` and answers `{ found, result? }`, so Clew can establish what happened before it decides to replay.",
          }),
        }),
        object({
          strategy: Type.Literal('conditional', {
            description:
              'The source writes only when its revision still matches, and `lookup` tells whether the effect already holds.',
          }),
          lookup: Type.String({ description: "This connector's read that tells whether the effect already holds." }),
        }),
      ],
      {
        description:
          'How a write may be repeated safely after a lost answer (D45): `manual`, `deduplicated` (operation ids kept for `retentionSeconds`, found by `lookup`) or `conditional` (`lookup` tells whether the effect holds). Omitted means manual. Only meaningful on an `execute`.',
      },
    ),
  ),
  name: Type.String({
    pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$',
    maxLength: 80,
    description:
      '`<connector id>.<verb>`, stable. Four names are profiles Clew combines across connectors: `<id>.search`, `<id>.errands`, `<id>.requests` and `<id>.news`. `<id>.search` (D26) is a search source, see `kinds`. `<id>.errands` (D35, D89) is a read that takes `{ view?: "assigned" | "reported" }` and answers an ErrandsOutput with the errands the case system lets the person see. Its view\'s `open` names the read that shows one errand, by convention `<id>.errand`. Clew lists every `<id>.errands` in the person\'s scope as `clew.errands`. `<id>.requests` (D123) is kept apart from it: a read that takes `{}` and answers a RequestsOutput with what the person ordered or reported in a service desk and waits for; its view\'s `open` names the read that shows one request, by convention `<id>.request`. Clew lists every `<id>.requests` in the person\'s scope as `clew.requests`, what waits on the person first, under "Beställningar och felanmälningar" on Hem. `<id>.news` (D112) is a read that takes `{}` and answers a NewsOutput with the news the person may read; its view\'s `open`, when a row should open in Clew rather than by its `link`, names the read that shows one item, by convention `<id>.newsItem`. Clew lists every `<id>.news` in the person\'s scope as `clew.news`, newest first, on Hem and as "Alla nyheter"; a source that fails contributes nothing. Two more are the talks profile (D96), answered by one system per installation rather than combined: `<id>.talks`, a read that takes `{}` and answers a TalksOutput (the open round of development talks and one row per person the reader manages, keyed on the SCIM `userName`), and `<id>.commitments`, a read that takes `{ person?: <userName> }` and answers a CommitmentsOutput (that employee\'s action points for a manager of their unit, or without `person` the ones the reader owns and the ones about the reader). `<id>.talks` may be limited to managers; `<id>.commitments` should be callable by everyone who owns action points or is their subject. Clew\'s built-in `talks` connector answers while either of its reads is enabled for the person; otherwise the one connector whose `<id>.talks` or `<id>.commitments` the person may call does, and with several none does. Neither is ever offered to the model.',
  }),
  kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')], {
    description:
      '`read` answers; `propose` drafts something for a person to decide; `execute` changes the source and runs only after a human decision (D8), never as a tool and never through a callback.',
  }),
  title: swedish('Swedish. A button label.'),
  description: swedish('Swedish. What the model reads when `model` is true.'),
  input: jsonSchemaOf(
    "JSON Schema of the input. Clew validates a call against it before the connector sees it. `required` properties mean the capability needs input, which keeps it out of the menu and out of the conformance check's calls.",
  ),
  output: jsonSchemaOf(
    "JSON Schema of the output. Clew validates the answer against it; where it declares `properties`, a view's keys must be among them (D38).",
  ),
  model: Type.Boolean({
    description:
      'Offer it to the model as a tool, once an administrator has enabled tools for the connector. Must be false for execute (D8).',
  }),
  scope: ScopeRuleSchema,
  kinds: Type.Optional(
    Type.Array(SearchKind, {
      uniqueItems: true,
      description:
        'For `<id>.search` (D26): what it can find. Its output is a SearchOutput; `<id>.fetch` takes one of its refs back and returns one SearchHit.',
    }),
  ),
  view: Type.Optional(ViewSchema),
  review: Type.Optional(
    Type.String({
      maxLength: 80,
      description:
        'On an execute: the same-connector document or record read taking {ref}, whose version-bound evidence is required on approval.',
    }),
  ),
  menu: Type.Optional(MenuHintSchema),
  about: Type.Optional(AboutSchema),
  person: Type.Optional(PersonAccessSchema),
  unit: Type.Optional(UnitAccessSchema),
  follows: Type.Optional(
    Type.Array(FactKindName, {
      uniqueItems: true,
      maxItems: 20,
      description:
        'For a `propose` (D55): the fact kinds it answers for. Input is a FactEnvelope, output a FollowResponse; steps name this connector only.',
    }),
  ),
  creates: Type.Optional(
    Type.String({
      pattern: FACT_KIND,
      maxLength: 80,
      description:
        "The fact kind this `propose` or `execute` brings about (D55); must be one of the manifest's `facts`.",
    }),
  ),
  asks: Type.Optional(
    Type.Array(AskSchema, {
      minItems: 1,
      maxItems: ASKS_MAX,
      description:
        'On a `propose` or `execute` (D112): what the person fills in before it runs, each naming one property of the input. Clew draws the asks as the first step of the action\'s dialog, "Fyll i", from every place the action can be started, and merges the answers into the input; the rest comes from the selected rows (`refs`), the action\'s own `input` on a work item, or the entity (`about.param`). An answer for anything not asked is refused.',
    }),
  ),
  effect: Type.Optional(
    Type.String({
      pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$',
      maxLength: 80,
      description:
        'On an `execute` (D112): a `read` of this connector that takes the same input and answers an `EffectOutput`, what the write will do where, without writing anything. Clew calls it as the person with the input the execute would get and draws the answer as "Det här händer", the last step before anything is sent. Without it Clew names the source and shows the capability\'s `description`.',
    }),
  ),
});
export const ManifestAreaSchema = object({
  id: Type.String({
    pattern: '^[a-z][a-z0-9-]*$',
    maxLength: 40,
    description:
      "Stable and lowercase. Hem's area filter names it in its address (`/?area=<id>`), and a scan draft names it in `area`.",
  }),
  title: swedish(
    "Swedish. The area's name: a choice in Hem's area filter and the rail's search, and the word that marks its cards (D71).",
  ),
  roles: Type.Array(RoleSchema, {
    minItems: 1,
    uniqueItems: true,
    description: 'Who sees the area: at least one role.',
  }),
  standing: Type.Array(Type.String(), {
    description:
      'Capability names the area offers, each a capability of this manifest. A propose or execute among them is suggested under "Menar du" while the person types in the question box on Hem; a read among them marks its view with the area\'s word and icon and has no entry of its own.',
  }),
  schedules: Type.Array(
    object({
      label: Type.String({ description: 'Swedish. What happens: "Nya saker att göra".' }),
      when: Type.String({ description: 'Swedish. When, in words: "Varje vardag 06:00".' }),
    }),
    {
      description:
        'What the connector does for this area on its own and when. Informational text that Clew keeps with the manifest and draws nowhere today; the scan itself runs nightly and on first visit.',
    },
  ),
  figure: Type.Optional(
    Type.Boolean({
      description:
        "Clew asks POST /clew/figure for this area's figure and draws it as a tile on Hem (D54), unless an administrator switched it off.",
    }),
  ),
  icon: Type.Optional(MenuIconSchema),
});
/**
 * The connector calls its system as the person (D26): Clew trades the person's session for a token bound to this audience
 * (RFC 8693 at the IdP) and sends it in `X-Clew-Delegated-Token` beside the assertion. Absent in scans, figures, callbacks
 * and sessions without an IdP token; the connector then answers `denied`.
 */
export const DelegationSchema = object(
  {
    audience: Type.String({
      pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$',
      description: 'The OAuth audience (an IdP client id) the token must be bound to.',
    }),
  },
  'The connector acts as the person against its system with a token Clew obtains by token exchange.',
);
/**
 * A read Clew makes as the installation itself, with no person behind the call (D119). Reads only, never a tool, never
 * on a person's page: it is not a capability, so nothing a person, the model or another connector reaches can call it.
 */
export const ManifestInstallationReadSchema = object(
  {
    name: Type.String({
      pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$',
      maxLength: 80,
      description:
        "`<connector id>.<profile>`, one of the profiles Clew reads as the installation. Today only `<id>.holdings` (D108 item 9): a read that takes a HoldingsInput (`{}`, then `{ cursor }`) and answers a HoldingsOutput, one page of every account the source has with every holding it can see, the cursor of the next page in `next`, and whether a holding missing later means it was withdrawn (`withdrawalsReported`). Clew's competence register copies the pages. Unique across `capabilities` and `installation`.",
    }),
    title: swedish('Swedish. What Clew reads, as an administrator reads it: "Genomförda kurser och märken".'),
    description: swedish('Swedish. What the read answers, for the administrator.'),
    input: jsonSchemaOf(
      "JSON Schema of the input, which must fit the profile's (for `<id>.holdings`: an object whose only property is an optional string `cursor`, requiring nothing). Clew validates every call against it.",
    ),
    output: jsonSchemaOf(
      "JSON Schema of the output, which must fit the profile's (for `<id>.holdings`: HoldingsOutput, the same fields or fewer of the optional ones, constraints as tight or tighter). Clew validates every answer against it and against the profile.",
    ),
  },
  'A read Clew makes as the installation, with no person behind it (D119): posted to `/clew/installation/{name}` with an assertion whose subject is `clew:installation` and whose `caller` claim is `installation`, bound to the body and the name. Answer it to that assertion only. Never a model tool and never on a page: no person, administrator included, can call it by name, and it reaches no `capabilities` path. `model: false` and a read are implied.',
);
export const ConnectorManifestSchema = Type.Object(
  {
    protocol: Type.Union([Type.Literal(PROTOCOL_VERSION), Type.Literal(PROTOCOL_PREVIOUS)], {
      description:
        'The version of this contract the manifest is written to, not of the connector (D60). This instance loads 3, and 2 for a window: a connector on 2 is loaded, shown with a warning in administration and in the conformance check, sent no `about` in its request bodies and held to the looser rules of 2. An additive change keeps the number; a break is a new one. 3 (D117) binds the request assertion to its body and capability, sends `about` in the body of a call whose input names people or units, and refuses a manifest in which an input that names someone is not a plain string property. `installation` (D119) was added to 3 as an optional field: a manifest without it is read as before.',
    }),
    id: Type.String({
      pattern: '^[a-z][a-z0-9-]*$',
      maxLength: 40,
      description:
        'Stable and lowercase. Must match the id Clew was configured with, and prefixes every capability name.',
    }),
    kind: Type.Union([Type.Literal('passthrough'), Type.Literal('derived')], {
      description:
        "Who owns the data (D3): `passthrough` when it lives in the connected system and Clew keeps refs and audit rows only; `derived` when the connector computes it from other sources. `core` is Clew's own and never a remote connector.",
    }),
    source: swedish('Swedish. The system as shown on cards: "Personalsystemet".'),
    areas: Type.Array(ManifestAreaSchema, {
      description:
        "The areas this connector gives a person: each names and marks the connector's cards, is a choice in Hem's area filter, and holds its standing capabilities, schedules and figure. Where each shows is in docs/guides/where-things-open.md. Empty is allowed for a connector that only answers questions.",
    }),
    capabilities: Type.Array(ManifestCapabilitySchema, {
      description:
        'What the connector can do, one entry per operation. The name is the contract (D37): a break is a new name, never a changed one.',
    }),
    installation: Type.Optional(
      Type.Array(ManifestInstallationReadSchema, {
        maxItems: INSTALLATION_PROFILES.length,
        description:
          "The reads Clew makes as the installation itself, with no person behind the call (D119), one per profile: today `<id>.holdings`, every holding the source has, a page at a time, for Clew's competence register (D108 item 9). Added under protocol 3; a manifest without it is untouched, and one on 2 cannot declare it.",
      }),
    ),
    uses: Type.Optional(
      Type.Array(Type.String({ pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$' }), {
        uniqueItems: true,
        maxItems: 100,
        description:
          'The exact capability names of other connectors this one calls back through `POST /api/connectors/call` while serving a request (D37), such as `calendar.today`. A name not listed is refused; an `execute` can never be called back.',
      }),
    ),
    facts: Type.Optional(
      Type.Array(ManifestFactSchema, {
        maxItems: 50,
        description: 'The fact kinds this connector creates (D55), each prefixed with its id.',
      }),
    ),
    scan: Type.Boolean({
      description: 'Whether Clew should POST /clew/scan for each person nightly and on first visit.',
    }),
    delegation: Type.Optional(DelegationSchema),
    documents: Type.Optional(
      Type.Boolean({
        description: 'Implements POST /clew/documents for authorised, versioned binary document reads (D79).',
      }),
    ),
    assistants: Type.Optional(
      object(
        {
          list: Type.String({
            pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$',
            maxLength: 80,
            description:
              "One of this manifest's read capabilities, taking no input, `model: false`, and answering a SourceAssistantsOutput: the assistants the person behind the call may ask now. Who may call it is who may ask: its scope, an administrator's switch on it and the connector's audience decide both.",
          }),
        },
        "The assistants profile: this system has assistants a person may hand a conversation to, and the connector serves `POST /clew/ask`. The person picks one in Clew's composer; from then on their own words go to it unchanged, with only what they chose to attach, and its answer is shown as that assistant's own. Clew's model never calls it and never rewrites its answer. Added under protocol 3 as an optional field; a manifest on 2 cannot declare it.",
      ),
    ),
    header: Type.Optional(
      object(
        {
          capability: Type.String({
            pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$',
            maxLength: 80,
            description:
              "One of this manifest's read capabilities, taking no input and answering a SiteHeaderOutput: the site's name, the places in the band with their own pages, and the logo when the system has one.",
          }),
        },
        "The shared header (D88): this connector can give Clew the header it draws above every page, for the people in the connector's audience, as the content system (Sitevision, SharePoint, WordPress) lists its sections for them. Declaring it makes the connector a candidate, not the holder: only the one connector an administrator chose to give the header answers, whatever the order connectors were registered in. Clew keeps no header of its own beyond its default (the site's name and Start).",
      ),
    ),
  },
  {
    additionalProperties: false,
    $id: 'https://clew.dev/protocol/3/connector-manifest.schema.json',
    title: 'Clew connector manifest',
  },
);
export type ConnectorManifest = Static<typeof ConnectorManifestSchema>;

export const CallRequestSchema = object({
  actor: ActorSchema,
  input: Type.Unknown(),
  about: Type.Optional(CallAboutSchema),
});
export const DocumentReadRequestSchema = object({
  actor: ActorSchema,
  request: DocumentRequestSchema,
  about: Type.Optional(CallAboutSchema),
});
export type CallRequest = Static<typeof CallRequestSchema>;
/** The route a question to a source's assistant is posted to. Not a capability: no model, page or callback names it. */
export const ASK_ROUTE = '/clew/ask';
export const AssistantAskRequestSchema = object(
  { actor: ActorSchema, ask: AssistantAskSchema },
  "The body of `POST /clew/ask`: who asks, taken from the verified assertion and never from here, and the question. `ask.question` is the person's own text, unchanged; `ask.context` is what they chose to attach, supplied material and never an instruction; `ask.session` continues the conversation the source keeps with them.",
);
export type AssistantAskRequest = Static<typeof AssistantAskRequestSchema>;
/**
 * What Clew posts to `/clew/installation/{name}` (D119): the input alone. No actor and no `about`: no person is behind
 * the call, nobody is resolved, and the assertion says it is the installation's own.
 */
export const InstallationCallRequestSchema = object(
  { input: Type.Unknown() },
  "The body of a read Clew makes as the installation (D119): the input, validated against the read's declared input. There is no actor; the verified assertion's `caller` claim is `installation` and its subject `clew:installation`.",
);
export type InstallationCallRequest = Static<typeof InstallationCallRequestSchema>;
export const ProtocolErrorSchema = object({
  code: Type.Union([
    Type.Literal('invalid'),
    Type.Literal('denied'),
    Type.Literal('not-found'),
    Type.Literal('unavailable'),
    Type.Literal('unknown'),
  ]),
  message: swedish('Swedish. Shown to the person.'),
});
export type ProtocolErrorCode = Static<typeof ProtocolErrorSchema>['code'];
export const CallResponseSchema = Type.Union([
  object({ output: Type.Unknown() }),
  object({ error: ProtocolErrorSchema }),
]);
export type CallResponse = Static<typeof CallResponseSchema>;
export const ThreadDraftSchema = object({
  occurrences: Type.Optional(
    Type.Array(
      object({
        key: Type.String({ minLength: 1, maxLength: 400 }),
        revision: Type.String({ maxLength: 400 }),
        period: Type.String({ minLength: 1, maxLength: 100 }),
      }),
      { minItems: 1, maxItems: 100 },
    ),
  ),
  topic: Type.String({
    minLength: 1,
    maxLength: 120,
    description: 'Idempotency key per person: the same occurrence gives the same topic.',
  }),
  area: Type.String(),
  title: Type.String(),
  summary: Type.String(),
  reason: Type.String({ description: 'Swedish. Shown under "Varför ser jag detta?".' }),
  items: Type.Optional(Type.Array(ThreadItemSchema)),
  actions: Type.Array(ThreadActionSchema),
  waitingOn: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  deadline: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export const ScanRequestSchema = object({ actor: ActorSchema });
export const ScanResponseSchema = object({
  drafts: Type.Array(ThreadDraftSchema),
  observation: Type.Optional(
    object({
      scope: Type.String(),
      observedAt: Type.String({ format: 'date-time' }),
      version: Type.String(),
      exhausted: Type.Boolean(),
      completeness: literals(['complete', 'delta', 'partial', 'unavailable', 'authorization-required']),
      tombstones: Type.Optional(Type.Array(object({ key: Type.String(), period: Type.String() }))),
    }),
  ),
});
export type ScanResponse = Static<typeof ScanResponseSchema>;
export const FigureRequestSchema = object({ actor: ActorSchema, area: Type.String() });
/**
 * An area's figure (D54): one fact about the area that the person did not ask for, drawn by Clew as a tile on Hem, a line
 * in a text and a word in the rail. The connector says what and in which tone; Clew says the tone in its own words.
 */
export const FigureSchema = object(
  {
    label: Type.String({
      maxLength: 120,
      description:
        'Swedish. What the value is ("Sjukfrånvaro", "Förbrukat av ramen"); without a value, the whole figure as one sentence ("Inget nytt sedan i går.").',
    }),
    tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert'), Type.Literal('none')], {
      description:
        'ok, warn or alert; Clew draws them as Lugnt, Bevaka and Behöver dig. `none` when the number is the whole message.',
    }),
    value: Type.Optional(
      Type.String({
        maxLength: 40,
        description: 'Swedish, formatted by the connector: one number and its unit ("4,2 %", "14 av 23", "3").',
      }),
    ),
    comparison: Type.Optional(
      Type.String({
        maxLength: 160,
        description:
          'Swedish. A target, a change or a period, in supporting text ("mål ≤ 4,0 % · +0,3 sedan oktober").',
      }),
    ),
    progress: Type.Optional(
      object(
        { value: Type.Number({ minimum: 0 }), max: Type.Number({ exclusiveMinimum: 0 }) },
        'Progress towards a target, drawn as a bar in the tile in place of the comparison.',
      ),
    ),
    opens: Type.Optional(
      Type.String({
        maxLength: 80,
        description:
          'A read capability of this connector with a declared view that needs no input: the tile is then a link to that view, which opens in the panel beside Hem. Clew drops it when it names another connector or a capability without such a view.',
      }),
    ),
  },
  'One figure for an area.',
);
export type Figure = Static<typeof FigureSchema>;
export const FigureResponseSchema = object({ figure: Type.Union([FigureSchema, Type.Null()]) });
export type FigureResponse = Static<typeof FigureResponseSchema>;
export const ExecuteResultSchema = object(
  {
    headline: Type.String(),
    rows: Type.Array(
      object({
        ref: Type.String(),
        label: Type.String(),
        outcome: Type.Union([
          Type.Literal('done'),
          Type.Literal('unknown'),
          Type.Literal('failed'),
          Type.Literal('skipped'),
        ]),
        detail: Type.String(),
      }),
    ),
    undoCapability: Type.Optional(Type.String()),
    undoMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1440 })),
    undoInput: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  'What an execute capability returns: one outcome per ref, read back from the source.',
);
/** What a connector sends to `POST {CLEW_URL}/api/connectors/call` with its separate callback grant. */
export const CallbackRequestSchema = object({
  name: Type.String({ maxLength: 80 }),
  input: Type.Optional(Type.Unknown()),
});
export type CallbackRequest = Static<typeof CallbackRequestSchema>;

/** The whole protocol as one JSON Schema document with `$defs`, for connector authors outside this repository. */
export function protocolSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://clew.dev/protocol/3/connector-protocol.schema.json',
    title: 'Clew connector protocol',
    description: 'Shapes exchanged between Clew and a connector service. See docs/reference/connector-protocol.md.',
    $defs: {
      ConnectorManifest: ConnectorManifestSchema,
      Actor: ActorSchema,
      CallAbout: CallAboutSchema,
      CallRequest: CallRequestSchema,
      InstallationCallRequest: InstallationCallRequestSchema,
      ManifestInstallationRead: ManifestInstallationReadSchema,
      CallResponse: CallResponseSchema,
      ProtocolError: ProtocolErrorSchema,
      ExecuteResult: ExecuteResultSchema,
      Ask: AskSchema,
      EffectOutput: EffectOutputSchema,
      PreviewOutput: PreviewOutputSchema,
      DocumentReadRequest: DocumentReadRequestSchema,
      AssistantAskRequest: AssistantAskRequestSchema,
      AssistantAskEvent: AssistantAskEventSchema,
      SourceAssistantsOutput: SourceAssistantsOutputSchema,
      DocumentBundle: DocumentBundleSchema,
      ReviewEvidence: ReviewEvidenceSchema,
      Metrics: MetricsSchema,
      Series: SeriesSchema,
      Activity: ActivitySchema,
      ScanRequest: ScanRequestSchema,
      ScanResponse: ScanResponseSchema,
      ThreadDraft: ThreadDraftSchema,
      FigureRequest: FigureRequestSchema,
      Figure: FigureSchema,
      FigureResponse: FigureResponseSchema,
      CallbackRequest: CallbackRequestSchema,
      SearchHit: SearchHitSchema,
      SearchOutput: SearchOutputSchema,
      ErrandRow: ErrandRowSchema,
      ErrandsOutput: ErrandsOutputSchema,
      RequestRow: RequestRowSchema,
      RequestsOutput: RequestsOutputSchema,
      NewsRow: NewsRowSchema,
      NewsOutput: NewsOutputSchema,
      TalkRow: TalkRowSchema,
      TalksOutput: TalksOutputSchema,
      CommitmentRow: CommitmentRowSchema,
      CommitmentsOutput: CommitmentsOutputSchema,
      Holding: HoldingSchema,
      HoldingsRow: HoldingsRowSchema,
      HoldingsInput: HoldingsInputSchema,
      HoldingsOutput: HoldingsOutputSchema,
      Delegation: DelegationSchema,
      View: ViewSchema,
      Menu: MenuHintSchema,
      ManifestFact: ManifestFactSchema,
      FactEnvelope: FactEnvelopeSchema,
      StepDraft: StepDraftSchema,
      FollowResponse: FollowResponseSchema,
    },
  };
}

/**
 * Versions (D60). `protocol` is the version of this contract, not of a connector: a connector has no version, a
 * capability's name is its contract (D37). An additive change (a new optional field, a looser constraint) keeps the
 * number; views, the menu, delegation and facts all arrived under 2. A break is a new number, and Clew then accepts the
 * new number and the one before it for a stated window, loading a manifest on the older one with a warning in
 * administration rather than refusing it. The one exception is a security change, which retires the old number at
 * once with its reason recorded here; that is what happened to 1. 3 is a break (D117): the request body gained `about`
 * in closed objects, the assertion's binding is required by the verifier, and the loader refuses a named input that is
 * not a plain string; 2 stays accepted for the window in `PROTOCOL_DEPRECATED`.
 */
export const PROTOCOL_ACCEPTED: readonly number[] = [PROTOCOL_VERSION, PROTOCOL_PREVIOUS];
/**
 * A number still accepted for a window (D60), with what a connector on it must change and until when. 2 became the
 * previous number on 2026-11-12 (D117); the window closes by a decision of its own, no earlier than the first release
 * after that day.
 */
export const PROTOCOL_DEPRECATED: Readonly<Record<number, string>> = {
  2: "deprecated 2026-11-12 (D117), accepted until a decision closes the window, no earlier than the first release after that day: declare protocol 3, accept `about` in the request body (CallRequest and DocumentReadRequest gained it), verify the assertion's `body` and `capability` claims against the request (connectors/hello/verification.mjs), and make every input that names a person a plain string property, the `person` of a `<id>.commitments` read included.",
};
/**
 * What differs for a connector on the previous number (D60): the one place the loader and the transport ask, so a
 * manifest on 2 is read as a manifest on 3 with these exceptions. A connector on 2 was written against a `CallRequest`
 * without `about` (a closed object), so its bodies carry none; and the plain-string rule for inputs that name someone is
 * not a refusal for it, since the registry refuses anything but a string there at every call regardless.
 */
export function protocolTerms(protocol: number): {
  about: boolean;
  strictNamedInputs: boolean;
  /** Whether the manifest may declare `installation` (D119): added under 3, so never a connector on 2. */
  installation: boolean;
  /** Whether the manifest may declare `assistants`: added under 3, so never a connector on 2. */
  assistants: boolean;
  deprecated?: string;
} {
  return protocol === PROTOCOL_PREVIOUS
    ? {
        about: false,
        strictNamedInputs: false,
        installation: false,
        assistants: false,
        deprecated: PROTOCOL_DEPRECATED[protocol],
      }
    : { about: true, strictNamedInputs: true, installation: true, assistants: true };
}
/**
 * The health of a connector that answered with a valid manifest (D60): `ok`, or on the previous protocol the warning
 * that it is loaded for a window only, with what it must change.
 */
export function healthOf(manifest: { protocol: number }, at: string): ConnectorHealth {
  const deprecated = protocolTerms(manifest.protocol).deprecated;
  return deprecated ? { status: 'protocol-outdated', at, detail: deprecated } : { status: 'ok', at };
}
export const PROTOCOL_RETIRED: Readonly<Record<number, string>> = {
  1: "retired 2026-11-05: shared-secret (HS256) identity signing was replaced by RS256 installation keys (D44). Move the verifier to the installation's public keys and declare protocol 3 (2 for its window).",
};

/**
 * What Clew makes of a manifest document before any service runs (D60): the problems it would refuse it for, else what it
 * would offer to whom. `POST /api/protocol/manifest` answers with it; `previewManifest` in preview.ts computes it.
 */
const previewRoles = Type.Array(RoleSchema, {
  description: 'Who may call it: both roles when the capability names none.',
});
/** The places Clew gives a capability that is about an entity (D97 item 2), in the order the preview lists them. */
export const ABOUT_PLACES = ['lens', 'mark', 'section', 'menu'] as const;
export type AboutPlace = (typeof ABOUT_PLACES)[number];
/** Where a person can start a propose or an execute (D112 item 11), in the order the preview lists them. */
export const ACTION_STARTS = ['work-item', 'entity', 'question-box', 'conversation', 'fact'] as const;
export type ActionStart = (typeof ACTION_STARTS)[number];
/** The steps of the one path a write passes (D112 item 10), in the order the person meets them. */
export const ACTION_STEPS = ['fill-in', 'effect', 'confirm', 'review', 'receipt'] as const;
export type ActionStep = (typeof ACTION_STEPS)[number];
/** Who fills a property of an action's input (D112 item 11). */
export const INPUT_FILLERS = ['rows', 'entity', 'person', 'fact', 'work-item', 'source'] as const;
export type InputFiller = (typeof INPUT_FILLERS)[number];
/**
 * Both halves of a write as the preview draws them (D112 item 11), from the declaration alone: where a person can start
 * it, which steps of the path it draws, and who fills each property of its input.
 */
export const ActionPathPreviewSchema = object(
  {
    starts: Type.Array(
      object({
        place: literals(ACTION_STARTS),
        state: literals(['declared', 'not-declared', 'never'], {
          description:
            '`declared`: the manifest puts it there; `not-declared`: it could, with the field in `declares`; `never`: not for this kind (an execute is never drafted by the model).',
        }),
        declares: Type.String({ description: 'The manifest field that puts it there.' }),
      }),
      {
        description:
          '`work-item`: a button on a work item a scan pushes or a propose drafts (`scan: true`, or a propose about an entity); `entity`: an action on a person or a unit (`about.param`); `question-box`: a suggestion under "Menar du" (`areas[].standing`); `conversation`: drafted by the assistant, a propose with `model: true`; `fact`: a step of a job after a fact elsewhere (`follows` on a propose; an execute is such a step when a propose of the manifest follows a fact).',
      },
    ),
    steps: Type.Array(
      object({
        step: literals(ACTION_STEPS),
        state: literals(['declared', 'not-declared', 'on-the-work-item', 'always', 'never'], {
          description:
            '`declared` or `not-declared` by this capability; `on-the-work-item`: a draft\'s action declares it (`confirm`, `review: "each"`), so the manifest cannot say; `always`: every execute has it; `never`: not for this kind.',
        }),
        declares: Type.String({ description: 'The field that draws it.' }),
      }),
      {
        description:
          '`fill-in`: the asks (`asks`); `effect`: "Det här händer", the source\'s answer from `effect`, else the source\'s name and the description; `confirm`: one question before a write; `review`: the rows one at a time, each with its document; `receipt`: one outcome per row read back, with Ångra while the source allows it.',
      },
    ),
    input: Type.Array(
      object({
        property: Type.String(),
        type: Type.String({ description: "The property's type in words, as the manifest reference says it." }),
        required: Type.Boolean({ description: 'The input schema requires it.' }),
        by: literals(INPUT_FILLERS, {
          description:
            "`rows`: the selected rows of the work item (`refs`) or the review's evidence (`reviews`); `entity`: the key of the person or unit (`about.param`); `person`: an ask; `fact`: the fact a follower is asked with; `work-item`: the action's own `input` on a draft must give it; `source`: optional, the source's default unless a draft gives it.",
        }),
        ask: Type.Optional(AskSchema),
      }),
      { description: "Each property of the input schema's `properties`, as the person will meet it." },
    ),
  },
  'Where a write can start and what the person passes through before it reaches the source (D112 item 11).',
);
export type ActionPathPreview = Static<typeof ActionPathPreviewSchema>;
export const ManifestPreviewCapabilitySchema = object({
  name: Type.String(),
  kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]),
  title: Type.String(),
  roles: previewRoles,
  tool: Type.Boolean({
    description: 'Offered to the model as a tool once an administrator enables tools for the connector.',
  }),
  needsInput: Type.Boolean({
    description:
      'Its input schema does not accept `{}`, so neither the conformance check nor a menu row can open it without a question.',
  }),
  view: Type.Union(
    [
      Type.Literal('table'),
      Type.Literal('list'),
      Type.Literal('detail'),
      Type.Literal('text'),
      Type.Literal('document'),
      Type.Literal('record'),
      Type.Literal('metrics'),
      Type.Literal('series'),
      Type.Literal('activity'),
      Type.Null(),
    ],
    { description: 'How Clew draws its output, or null for the generic rules.' },
  ),
  menu: Type.Union([MenuHintSchema, Type.Null()], {
    description:
      'The row an administrator could put in the menu under Verktyg (D40), or null when the capability cannot be one.',
  }),
  check: Type.String({
    description: 'What the conformance check (`Testa anslutning`, `connector-check.ts`) does with it.',
  }),
  follows: Type.Optional(Type.Array(FactKindName)),
  creates: Type.Optional(FactKindName),
  about: Type.Optional(AboutSchema),
  places: Type.Array(literals(ABOUT_PLACES), {
    description:
      "Where Clew would show it on the entity it is about (D97), from the declaration alone: `lens` a table or list an administrator may offer under Visa on the entity's list, `mark` a `warn` or `alert` tone that marks the entity's row where an administrator chose the source, `section` a section on the opened entity, `menu` an action in the entity's menu, run after a human decision. Empty when it is about nothing.",
  }),
  openedFrom: Type.Array(Type.String(), {
    description:
      "The reads of this manifest whose rows open it (their view's `open`). Opened from a read about an entity, it is drawn under that read's section and in full on the entity's page; from any other read, a row's name opens it in the panel beside the page, in the list's place with Tillbaka when the list is itself in the panel. Empty when nothing opens it.",
  }),
  audience: Type.Array(
    object({
      places: Type.Array(literals([...ABOUT_PLACES, 'tool']), {
        minItems: 1,
      }),
      who: Type.String({ description: 'Who would see it there, in a sentence.' }),
    }),
    {
      description:
        'Who would see a capability about an entity, place by place (D97), from its scope and the declaration alone: the lens and the mark reach a person who has a list of that kind once an administrator chooses the source, the section anyone who opens an entity the connector answers a row for, the menu anyone who opens one and may call the action; `tool` says whether the model is offered it. Empty when it is about nothing.',
    },
  ),
  samples: Type.Optional(
    Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      description:
        'For a read about an entity: rows made from the declaration alone, to draw its places with before any service runs. Each carries a synthetic `key`; a status field takes in turn each value its view gives a tone, an instant a fixed time, any other field a value its output schema allows or a placeholder. Samples, never data: no connector is called.',
    }),
  ),
  asks: Type.Optional(Type.Array(AskSchema, { description: 'The asks the capability declares (D112).' })),
  effect: Type.Optional(Type.String({ description: 'The read that says what the execute will do (D112).' })),
  path: Type.Optional(ActionPathPreviewSchema),
});
/** The places a problem points at (D60, D97): the field in the document, its entry in the manifest reference, the rule it breaks. */
export const ManifestIssueSchema = object(
  {
    problem: Type.String({ description: 'The problem as `problems` lists it.' }),
    path: Type.String({
      description:
        'Where in the document, with indices: `capabilities[0].output.properties.rows.items`. Empty for the document as a whole.',
    }),
    field: Type.String({
      description:
        'The manifest reference entry the path falls under, without indices: `capabilities[].output`. Empty when none does.',
    }),
    anchor: Type.String({
      description:
        'The element id on the manifest reference page (`/protocol/manifest#<anchor>`): the rule when there is one, else the field.',
    }),
    rule: Type.Optional(
      object(
        { id: Type.String(), title: Type.String() },
        "The rule between fields it breaks, as the manifest reference names it; absent for a problem of the schema's own.",
      ),
    ),
  },
  'One problem, placed.',
);
export type ManifestIssue = Static<typeof ManifestIssueSchema>;
export const ManifestPreviewSchema = object(
  {
    ok: Type.Boolean({ description: 'Whether Clew would load the document.' }),
    protocol: object(
      { current: Type.Integer(), accepted: Type.Array(Type.Integer()) },
      'The protocol version this instance speaks and the versions it loads.',
    ),
    problems: Type.Array(Type.String(), {
      description: 'Every reason the document would be refused, in the order Clew finds them. Empty when ok.',
    }),
    issues: Type.Array(ManifestIssueSchema, {
      description:
        'The same problems in the same order, each placed: its path in the document, its manifest reference entry and the rule it breaks. Empty when ok.',
    }),
    manifest: Type.Optional(
      object(
        {
          id: Type.String(),
          source: Type.String(),
          kind: Type.Union([Type.Literal('passthrough'), Type.Literal('derived')]),
          scan: Type.Boolean(),
          delegation: Type.Union([Type.String(), Type.Null()], {
            description: "The audience Clew would obtain the person's token for, or null.",
          }),
          uses: Type.Array(Type.String()),
          facts: Type.Array(FactKindName),
          capabilities: Type.Array(ManifestPreviewCapabilitySchema),
          areas: Type.Array(
            object({
              id: Type.String(),
              title: Type.String(),
              roles: Type.Array(RoleSchema),
              standing: Type.Array(Type.String()),
              figure: Type.Boolean(),
              icon: Type.Union([MenuIconSchema, Type.Null()]),
            }),
          ),
          menu: Type.Array(object({ capability: Type.String(), label: Type.String(), icon: MenuIconSchema }), {
            description: 'The rows an administrator could put in the menu.',
          }),
          installation: Type.Optional(
            Type.Array(
              object({
                name: Type.String(),
                title: Type.String(),
                check: Type.String({ description: 'What the conformance check does with it.' }),
              }),
              {
                description:
                  'The reads Clew would make as the installation itself (D119), present when the manifest declares any: never offered to a person, the model or another connector.',
              },
            ),
          ),
        },
        'Present when ok: the manifest as Clew would hold it.',
      ),
    ),
  },
  "A dry run of a manifest document against this instance's rules.",
);
export type ManifestPreview = Static<typeof ManifestPreviewSchema>;

export interface OpenApiOptions {
  /** The installation's public base URL. Absent, the document carries a server variable for it. */
  clewUrl?: string;
}
/**
 * The protocol as an OpenAPI 3.1 document (D60), for a viewer, a client or a server-stub generator. Two sides: the routes a
 * connector serves and Clew calls (tag Connector), and the routes Clew serves and a connector calls (tag Clew). The
 * schemas are the same TypeBox objects the instance validates with, so the document matches the instance by construction.
 */
export function openApiDocument(options: OpenApiOptions = {}) {
  const defs: Record<string, unknown> = { ...protocolSchema().$defs, ManifestPreview: ManifestPreviewSchema };
  const schemas = Object.fromEntries(
    Object.entries(defs).map(([name, schema]) => {
      const { $id: _id, ...rest } = schema as Record<string, unknown>;
      return [name, rest];
    }),
  );
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (name: string, description: string) => ({
    description,
    content: { 'application/json': { schema: ref(name) } },
  });
  const body = (name: string) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });
  const connector = [
    {
      url: '{connector}',
      description: 'The base URL the connector is registered with in Clew. Every path below is relative to it.',
      variables: { connector: { default: 'http://127.0.0.1:4020' } },
    },
  ];
  const clew = [
    options.clewUrl
      ? { url: options.clewUrl, description: 'This Clew installation.' }
      : {
          url: '{clew}',
          description: 'The Clew installation (the CLEW_URL a connector is configured with).',
          variables: { clew: { default: 'http://localhost:3020' } },
        },
  ];
  const signed = [{ clewAssertion: [], connectorKey: [] }];
  const text = (description: string) => ({ type: 'string', description });
  const refused = {
    '401': {
      description:
        'The transport key or the assertion was rejected. Required: an invalid credential is never answered with data; the conformance check probes this.',
    },
    '403': json(
      'CallResponse',
      'Denied: `error.code` is `denied`, `error.message` is Swedish and shown to the person.',
    ),
    '503': json(
      'CallResponse',
      'The source is unavailable: `error.code` is `unavailable`. For a write this does not say whether the effect happened.',
    ),
  };
  const operationId = {
    name: 'X-Clew-Operation-Id',
    in: 'header',
    required: false,
    schema: text(
      'The durable operation id of an approved write (D45). Deduplicate on it; the same id means the same approved operation.',
    ),
  };
  const delegated = {
    name: 'X-Clew-Delegated-Token',
    in: 'header',
    required: false,
    schema: text(
      "The person's own token for the connector's system (D26), present only when the manifest declares `delegation` and one of the person's live sessions is behind the call: the request's own, the session that approved a write, or the session that asked for a scan.",
    ),
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Clew connector protocol',
      version: String(PROTOCOL_VERSION),
      summary: 'How a connector service and a Clew installation talk to each other.',
      description:
        'A connector is an HTTP service of your own. It serves the routes tagged **Connector**; Clew loads its manifest and calls it as the acting person, with an RS256 assertion it can verify against the keys at the route tagged **Clew**. Shapes are the same JSON Schemas the instance validates with, published under `components.schemas` and, as one bundle, as `connector-protocol.schema.json` under `/api/protocol/`. Generate server stubs from this document or implement the paths by hand; the examples under `connectors/` in the repository are complete. Try `POST /api/protocol/manifest` with a manifest before any service exists. The manifest field by field, with examples: [manifest reference](/protocol/manifest).',
    },
    'x-clew-protocol': {
      current: PROTOCOL_VERSION,
      accepted: [...PROTOCOL_ACCEPTED],
      deprecated: PROTOCOL_DEPRECATED,
      retired: PROTOCOL_RETIRED,
    },
    tags: [
      {
        name: 'Connector',
        description:
          "Routes the connector serves and Clew calls. All JSON, all under the registered base URL. Every POST carries `Authorization: Bearer <assertion>` and `X-Clew-Connector-Key`; take the actor from the verified assertion, never from the body, and check that the assertion's `body` claim is the SHA-256 of the body received (D117). On `/clew/installation/{name}` there is no actor: the assertion is the installation's own (D119).",
      },
      {
        name: 'Clew',
        description:
          'Routes Clew serves and a connector calls: its public keys, the callback for declared dependencies, and this protocol.',
      },
    ],
    paths: {
      '/clew/manifest': {
        servers: connector,
        get: {
          tags: ['Connector'],
          operationId: 'getManifest',
          summary: 'The manifest',
          description:
            'Clew loads it at registration, on "Hämta manifest igen" and on a schedule. No assertion is sent. Keep credentials and source data out of it.',
          responses: {
            '200': json(
              'ConnectorManifest',
              'The manifest. Clew validates it against `ConnectorManifest` and the rules `POST /api/protocol/manifest` applies.',
            ),
          },
        },
      },
      '/clew/capabilities/{name}': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'callCapability',
          summary: 'Run a capability as the person',
          security: signed,
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$' },
              description: 'The full capability name from the manifest, `<id>.<verb>`.',
            },
            operationId,
            delegated,
          ],
          requestBody: body('CallRequest'),
          responses: {
            '200': json(
              'CallResponse',
              "The output, validated against the capability's declared output schema. An execute answers with an `ExecuteResult`.",
            ),
            '400': json('CallResponse', 'Invalid input: `error.code` is `invalid`.'),
            ...refused,
            '404': json('CallResponse', 'An unknown ref or capability: `error.code` is `not-found`.'),
          },
        },
      },
      '/clew/installation/{name}': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'readAsInstallation',
          summary: 'A read Clew makes as the installation, with no person behind it',
          description:
            "Only for a read the manifest declares under `installation` (D119), today `<id>.holdings`. No actor: the assertion's subject is `clew:installation`, its `caller` claim `installation`, and it carries no `actor` and no `callback`; it is bound to the body and to `{name}` as every request is. Answer only that assertion here: a person's assertion, whoever they are, is refused with 401, and the installation's assertion is never valid on `/clew/capabilities/{name}`. Clew never reaches this route on a person's behalf: the read is not a capability, so neither a page, a card, the model nor another connector's callback can name it.",
          security: [{ installationAssertion: [], connectorKey: [] }],
          parameters: [
            {
              name: 'name',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^[a-z][a-z0-9-]*\\.[a-zA-Z][a-zA-Z0-9]*$' },
              description: "The full name from the manifest's `installation`, `<id>.<profile>`.",
            },
          ],
          requestBody: body('InstallationCallRequest'),
          responses: {
            '200': json(
              'CallResponse',
              "The output, validated against the read's declared output and its profile (`HoldingsOutput` for `<id>.holdings`).",
            ),
            '400': json(
              'CallResponse',
              'Invalid input, such as a cursor the source does not know: `error.code` is `invalid`.',
            ),
            '401': {
              description:
                "The transport key or the assertion was rejected, and a person's assertion on this route. Required: the conformance check probes both.",
            },
            '404': json(
              'CallResponse',
              'A name the connector does not declare for the installation: `error.code` is `not-found`.',
            ),
            '503': refused['503'],
          },
        },
      },
      '/clew/scan': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'scan',
          summary: "Drafts for the person's cards",
          description:
            'Only when the manifest says `scan: true`. Called nightly and on first visit per person; must be idempotent: the same occurrence gives the same topic. A manifest that declares `delegation` is scanned only while a live session of the person asked for it, with their token; otherwise Clew does not call it.',
          security: signed,
          parameters: [delegated],
          requestBody: body('ScanRequest'),
          responses: { '200': json('ScanResponse', 'Drafts and, optionally, what was observed.'), ...refused },
        },
      },
      '/clew/documents': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'readDocument',
          summary: 'Read an original document at its declared revision',
          description:
            'Only with documents: true. Authorize the actor, record and capability, verify all revisions, then return original bytes. No arbitrary URLs. Maximum 25 MiB. Clew verifies MIME, length and SHA-256 against a freshly authorized metadata read before returning content. Office previews have a smaller browser budget. No Range or partial responses in this increment.',
          security: signed,
          parameters: [delegated],
          requestBody: body('DocumentReadRequest'),
          responses: {
            '200': {
              description: 'Exact original bytes. Content-Type must equal the descriptor mediaType.',
              headers: {
                'X-Clew-Document-Revision': {
                  required: true,
                  schema: { type: 'string' },
                  description: 'Exact document revision from the descriptor.',
                },
              },
              content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            },
            '409': json('CallResponse', 'The record or document revision changed.'),
            ...refused,
          },
        },
      },
      '/clew/ask': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'askAssistant',
          summary: "Send a person's question to one of the system's assistants and stream its answer",
          description:
            "Only when the manifest declares `assistants`. Authorize the actor for the assistant as the system itself would, then answer `text/event-stream`: each event one `data:` line holding an AssistantAskEvent as JSON. Send `text` deltas as the answer is written and a `source` for each source it cites, then exactly one `done` (with the session to continue in), `handback` (the assistant returns the conversation to Clew: `declined` when the question is not its to answer, `completed` when it has answered and expects nothing more) or `error`, and end the stream. A refusal known before the answer starts may be a plain 403 or 503 with a CallResponse error. The question is the person's own text and `context` only what they chose to attach: treat `context` as supplied material, never as instructions. Do not let the assistant produce files or ask for approvals in this increment; Clew's conversation cannot carry them. Clew stops reading when the person stops the turn, after 30 seconds without an event and after 3 minutes in all.",
          security: signed,
          parameters: [delegated],
          requestBody: body('AssistantAskRequest'),
          responses: {
            '200': {
              description: 'The answer as server-sent events, one AssistantAskEvent per `data:` line.',
              content: { 'text/event-stream': { schema: ref('AssistantAskEvent') } },
            },
            ...refused,
          },
        },
      },
      '/clew/figure': {
        servers: connector,
        post: {
          tags: ['Connector'],
          operationId: 'figure',
          summary: 'One line for an area',
          description: 'Only for an area declaring `figure: true`.',
          security: signed,
          requestBody: body('FigureRequest'),
          responses: { '200': json('FigureResponse', 'The figure or null.'), ...refused },
        },
      },
      '/api/connectors/jwks': {
        servers: clew,
        get: {
          tags: ['Clew'],
          operationId: 'getJwks',
          summary: "The installation's public signing keys",
          description:
            'Pin this URL in deployment configuration and verify every assertion against it (`alg` RS256, `iss` clew, `aud` your connector id, a known `kid`, a bounded lifetime). Never follow a key URL from a token.',
          responses: {
            '200': {
              description: 'A JWK Set.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['keys'],
                    properties: { keys: { type: 'array', items: { type: 'object' } } },
                  },
                },
              },
            },
            '503': {
              description: 'Clew is starting or cannot read its keys now; keep the keys you have and retry later.',
            },
          },
        },
      },
      '/api/connectors/call': {
        servers: clew,
        post: {
          tags: ['Clew'],
          operationId: 'callback',
          summary: "Run another connector's read or propose as the person",
          description:
            "The bearer is the `callback` grant from the verified request assertion, never the assertion itself. Only targets declared in the manifest's `uses`; identity is rebuilt from the person's current grant; `execute` is refused.",
          security: [{ callbackGrant: [] }],
          requestBody: body('CallbackRequest'),
          responses: {
            '200': {
              description: "The target's output.",
              content: {
                'application/json': { schema: { type: 'object', required: ['output'], properties: { output: {} } } },
              },
            },
            '400': json('CallResponse', 'Invalid request or input.'),
            '401': json('CallResponse', 'Missing or invalid grant.'),
            '403': json('CallResponse', 'Denied: the person, the origin or the target is out of scope.'),
            '404': json('CallResponse', 'Unknown capability.'),
            '503': json(
              'CallResponse',
              'Unavailable: the target or Clew cannot answer now, Clew still starting included; retry later.',
            ),
          },
        },
      },
      '/api/protocol/openapi.json': {
        servers: clew,
        get: {
          tags: ['Clew'],
          operationId: 'getOpenApi',
          summary: 'This document, as this instance speaks it',
          responses: {
            '200': { description: 'OpenAPI 3.1.', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/api/protocol/connector-protocol.schema.json': {
        servers: clew,
        get: {
          tags: ['Clew'],
          operationId: 'getProtocolSchema',
          summary: 'The JSON Schema bundle',
          description: 'Every shape under `$defs`, for a connector written in any language.',
          responses: {
            '200': {
              description: 'JSON Schema 2020-12 with `$defs`.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/protocol/manifest-reference.json': {
        servers: clew,
        get: {
          tags: ['Clew'],
          operationId: 'getManifestReference',
          summary: 'The manifest, field by field',
          description:
            'One entry per manifest field: what it does, type, presence, constraints, an example and what it must agree with, plus the rules between fields and three recipes. Generated from the same schema. The page that draws it is `/protocol/manifest` on the same origin.',
          responses: {
            '200': {
              description: 'The reference: `sections`, `fields`, `rules`, `recipes`.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/protocol/manifest': {
        servers: clew,
        post: {
          tags: ['Clew'],
          operationId: 'previewManifest',
          summary: 'Dry-run a manifest against this instance',
          description:
            'Send a manifest document and read what this instance would refuse it for, else what it would offer to whom. No service, registration or sign-in is needed. Pass `?id=` to check the id against the one you will register.',
          parameters: [{ name: 'id', in: 'query', required: false, schema: { type: 'string' } }],
          requestBody: body('ConnectorManifest'),
          responses: {
            '200': json('ManifestPreview', 'The verdict and, when ok, the manifest as Clew would hold it.'),
            '400': { description: 'The body is not JSON.' },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        clewAssertion: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            "RS256 assertion signed by the installation: who is acting (`actor`), for which connector, for at most two minutes, bound to one request (D117): `body` is the SHA-256 of the exact request body, base64url, and on `/clew/capabilities/{name}` `capability` is that name. Verify against `/api/connectors/jwks`, and recompute both from the request received; the body's `input` and `about` (`CallAbout`) are then Clew's.",
        },
        installationAssertion: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            "RS256 assertion signed by the installation for a read it makes itself (D119): `sub` is `clew:installation`, `caller` is `installation`, there is no `actor` and no `callback`, for this connector only and for at most two minutes, and it is bound to one request as every assertion is: `body` is the SHA-256 of the exact request body, base64url, and `capability` the name on `/clew/installation/{name}`. Verify against `/api/connectors/jwks`. A person's assertion never verifies as this one, and this one never verifies as a person's.",
        },
        connectorKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Clew-Connector-Key',
          description:
            'The transport secret from the registration. Transport authentication only; it never asserts a person.',
        },
        callbackGrant: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'The `callback` claim of a verified request assertion, audience `clew:connector-callback`.',
        },
      },
    },
  };
}
