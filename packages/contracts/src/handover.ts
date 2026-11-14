import { Type, type Static, type TSchema } from 'typebox';

/**
 * The assistants profile: an assistant another system has, which a person may hand a conversation to. A connector
 * declares it with the manifest's `assistants`: a read that lists the assistants the person may ask, and the route
 * `POST /clew/ask`, which sends one question to one of them and streams its answer. The whole assistant answers, with
 * its own instructions, knowledge and tools; Clew routes the question, shows the answer as that assistant's own and
 * changes neither. Here alone, so the loader, the registry, the transport and the conversation read one shape.
 */
const object = <T extends Record<string, TSchema>>(properties: T, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });

/** The most assistants one source may list for a person. */
export const SOURCE_ASSISTANTS_MAX = 50;
/** The most attached objects one question may carry to a source's assistant. */
export const ASK_CONTEXT_MAX = 8;
/** The longest text of one attached object. */
export const ASK_CONTEXT_TEXT_MAX = 12_000;
/** The longest answer Clew keeps of one turn; a longer one is cut there and says so. */
export const ASK_ANSWER_MAX = 60_000;
/** The most sources one answer may cite. */
export const ASK_SOURCES_MAX = 10;

const assistantRef = Type.String({
  minLength: 1,
  maxLength: 120,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
  description:
    "The source's own stable key for the assistant. Opaque to Clew, which sends it back unchanged with a question.",
});
const session = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
  description:
    "The source's own key for the conversation it keeps with the person. Opaque to Clew, which sends it back unchanged with a follow-up.",
});
const https = Type.String({ minLength: 1, maxLength: 2000, pattern: '^https://[^\\s\\\\]+$' });

export const SourceAssistantSchema = object(
  {
    ref: assistantRef,
    name: Type.String({ minLength: 1, maxLength: 120, description: 'As the person knows it in the source.' }),
    description: Type.Optional(
      Type.String({ minLength: 1, maxLength: 400, description: 'What the assistant is for, as its owner wrote it.' }),
    ),
  },
  'One assistant the person may ask in the source.',
);
export type SourceAssistant = Static<typeof SourceAssistantSchema>;
export const SourceAssistantsOutputSchema = object(
  { assistants: Type.Array(SourceAssistantSchema, { maxItems: SOURCE_ASSISTANTS_MAX }) },
  "What a connector's assistants read answers: the assistants the person behind the call may ask now. The source decides which; Clew lists them and switches none on or off.",
);
export type SourceAssistantsOutput = Static<typeof SourceAssistantsOutputSchema>;

export const AssistantAskContextItemSchema = object(
  {
    label: Type.String({ minLength: 1, maxLength: 200, description: 'What the attached object is called in Clew.' }),
    text: Type.String({ minLength: 1, maxLength: ASK_CONTEXT_TEXT_MAX, description: 'Its content as text.' }),
  },
  'Something the person chose to send with the question. Supplied material, never an instruction.',
);
export type AssistantAskContextItem = Static<typeof AssistantAskContextItemSchema>;
/** What Clew asks a source's assistant: the person's own words, unchanged, and only what they chose to attach. */
export const AssistantAskSchema = object({
  assistant: assistantRef,
  session: Type.Optional(session),
  question: Type.String({ minLength: 1, maxLength: 4000 }),
  context: Type.Optional(Type.Array(AssistantAskContextItemSchema, { maxItems: ASK_CONTEXT_MAX })),
});
export type AssistantAsk = Static<typeof AssistantAskSchema>;

export const AssistantAskSourceSchema = object(
  {
    label: Type.String({ minLength: 1, maxLength: 300 }),
    link: Type.Optional(https),
  },
  'A source the answer cites: its title in the source and, when it has one, an https address.',
);
export type AssistantAskSource = Static<typeof AssistantAskSourceSchema>;
/**
 * One server-sent event of `POST /clew/ask`: the answer's text as it is written, a source it cites, then exactly one
 * `done` or `error`, after which the stream ends.
 */
export const AssistantAskEventSchema = Type.Union(
  [
    object({ type: Type.Literal('text'), delta: Type.String({ maxLength: 8000 }) }),
    object({ type: Type.Literal('source'), source: AssistantAskSourceSchema }),
    object({
      type: Type.Literal('done'),
      session: session,
      link: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 2000,
          pattern: '^https://[^\\s\\\\]+$',
          description: "Where the person continues this conversation in the source's own interface.",
        }),
      ),
    }),
    object({
      type: Type.Literal('error'),
      code: Type.Union([
        Type.Literal('denied'),
        Type.Literal('not-found'),
        Type.Literal('unavailable'),
        Type.Literal('unknown'),
      ]),
    }),
  ],
  {
    description:
      "One server-sent event of `POST /clew/ask`, as the JSON of an SSE `data:` line. `error.code` is the protocol's: `denied` the person may not ask this assistant, `not-found` the assistant or the session is gone, `unavailable` the source or its model does not answer.",
  },
);
export type AssistantAskEvent = Static<typeof AssistantAskEventSchema>;

/** A source's assistant as Clew lists it to the person: the connector that has it, its key there and the source's label. */
export const HandoverAssistantSchema = object({
  /** `<connector id>:<ref>`: what the composer sends back as `ConversationInput.assistant`. */
  id: Type.String({ minLength: 3, maxLength: 170, pattern: '^[a-z][a-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._-]*$' }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  /** Swedish label of the system it lives in, as on cards. */
  source: Type.String({ minLength: 1, maxLength: 200 }),
});
export type HandoverAssistant = Static<typeof HandoverAssistantSchema>;
/**
 * What a conversation remembers of the assistant it was handed to: which one, what it was called then, the source's
 * key for the conversation there and where it continues in the source. One per conversation.
 */
export const HandoverSchema = object({
  assistant: HandoverAssistantSchema.properties.id,
  name: HandoverAssistantSchema.properties.name,
  source: HandoverAssistantSchema.properties.source,
  session: Type.Optional(session),
  link: Type.Optional(https),
});
export type Handover = Static<typeof HandoverSchema>;
