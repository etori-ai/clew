import { Type, type Static } from '@sinclair/typebox';
import { SearchKind } from '@clew/contracts';

/** The input of the composite search (D26): the person's question as it was typed, optionally narrowed to kinds. */
export const SearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 200 }),
    kinds: Type.Optional(Type.Array(SearchKind, { uniqueItems: true, minItems: 1 })),
  },
  { additionalProperties: false },
);
export type SearchInput = Static<typeof SearchInputSchema>;
/** The input of `<id>.fetch`: one ref the connector returned earlier. */
export const FetchInputSchema = Type.Object(
  { ref: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
export type FetchInput = Static<typeof FetchInputSchema>;
