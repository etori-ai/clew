import { Type, type Static, type TLiteral, type TSchema, type TUnion } from 'typebox';

/**
 * The holdings profile (D108 item 9, D119): what a source of competences answers when the installation itself reads
 * every holding it has, a page at a time, with no person behind the call. A connector declares it as the installation
 * read `<id>.holdings`; Clew's competence register copies the answers. Here alone, so the loader, the registry and the
 * register read one shape.
 */
const object = <T extends Record<string, TSchema>>(properties: T, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const calendarDay = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 });

/** The most rows one page of the profile may carry, whatever a connector declares. */
export const HOLDINGS_ROWS_MAX = 100;
/** The most holdings one row may carry. */
export const HOLDINGS_PER_ROW_MAX = 500;
/** The longest cursor a source may hand back. Clew keeps it and sends it unchanged with the next page. */
export const HOLDINGS_CURSOR_MAX = 512;
/**
 * What a source says a holding is: the catalogue's own kinds (D108 item 2) and `badge`, a digital badge a learning
 * platform issues (Open Badges). A closed list; a new kind is a looser constraint and keeps the profile's name.
 */
export const HOLDING_KINDS = ['certificate', 'degree', 'course', 'authorisation', 'badge'] as const;
export type HoldingKind = (typeof HOLDING_KINDS)[number];

const cursor = Type.String({
  minLength: 1,
  maxLength: HOLDINGS_CURSOR_MAX,
  description:
    "Where the next page starts, as the source wrote it in the previous page's `next`. Opaque to Clew, which sends it back unchanged.",
});

/** What the installation sends: the cursor of the page it wants, none for the first. No person and no key. */
export const HoldingsInputSchema = object(
  { cursor: Type.Optional(cursor) },
  'What `<id>.holdings` takes (D119): `{}` for the first page, then `{ cursor }` with the `next` of the page before.',
);
export type HoldingsInput = Static<typeof HoldingsInputSchema>;

/** One holding as D108 item 9 names it: the source's own row id and type id, the type's label, its kind and its days. */
export const HoldingSchema = object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        "The source's own id of this row, stable from one read to the next: a repeated read gives the same id, and two people never share one.",
    }),
    type: Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        "The source's own id of what is held (a course, a badge, a licence class), stable across reads. Clew maps it to its catalogue.",
    }),
    label: Type.String({
      minLength: 1,
      maxLength: 400,
      description: "The type's name as the source writes it. Shown until the type is mapped to the catalogue.",
    }),
    kind: Type.Union(
      HOLDING_KINDS.map(k => Type.Literal(k)),
      { description: 'What the source says the holding is.' },
    ) as unknown as TUnion<[TLiteral<HoldingKind>]>,
    issuedOn: { ...calendarDay, description: 'The day it was issued or completed, `YYYY-MM-DD`.' },
    expiresOn: Type.Optional({
      ...calendarDay,
      description: 'The day it ends, where the issuer set one. Absent when the source keeps no end.',
    }),
  },
  'One holding of one person, as the source keeps it: no name, no free text, no document.',
);
export type Holding = Static<typeof HoldingSchema>;

/** One account of the source and everything it holds that the source can see. */
export const HoldingsRowSchema = object(
  {
    key: Type.String({
      minLength: 1,
      maxLength: 512,
      description:
        "The value of the source's match field for this account: what Clew compares with a person's provisioned user name, without regard to case.",
    }),
    holdings: Type.Array(HoldingSchema, {
      maxItems: HOLDINGS_PER_ROW_MAX,
      description: 'Every holding of this account the source can see; empty when it holds nothing.',
    }),
    partial: Type.Optional(
      Type.Literal(true, {
        description:
          'Something of this account was refused or could not be dated, and is left out of this answer. Its absence does not make the row complete.',
      }),
    ),
  },
  'One account of the source: a row without holdings is an account that holds nothing, and an account with no row is one the source did not answer for.',
);
export type HoldingsRow = Static<typeof HoldingsRowSchema>;

/** One page of every holding a source has (D108 item 9, D119). */
export const HoldingsOutputSchema = object(
  {
    rows: Type.Array(HoldingsRowSchema, {
      maxItems: HOLDINGS_ROWS_MAX,
      description: 'The accounts of this page, each once.',
    }),
    next: Type.Optional({
      ...cursor,
      description: 'The cursor of the following page. Absent on the last page.',
    }),
    withdrawalsReported: Type.Boolean({
      description:
        'Whether a holding missing from a later read means it was withdrawn. When false, absence is never a revocation: the source leaves things out without saying so.',
    }),
  },
  'What `<id>.holdings` answers (D119): one page of accounts and their holdings, with the cursor of the next.',
);
export type HoldingsOutput = Static<typeof HoldingsOutputSchema>;
