import { Type, type Static } from 'typebox';

const object = <T extends Record<string, any>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const label = Type.String({ minLength: 1, maxLength: 200 });
const ref = Type.String({ minLength: 1, maxLength: 200 });
const instant = Type.String({ format: 'date-time' });
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const DocumentMediaSchema = Type.Union([
  Type.Literal('application/pdf'),
  Type.Literal('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  Type.Literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  Type.Literal('image/png'),
  Type.Literal('image/jpeg'),
  Type.Literal('image/svg+xml'),
]);
export const DocumentSchema = object({
  id: ref,
  revision: ref,
  title: label,
  filename: label,
  mediaType: DocumentMediaSchema,
  size: Type.Integer({ minimum: 1, maximum: MAX_DOCUMENT_BYTES }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  required: Type.Boolean(),
});
export const DocumentBundleSchema = object({
  ref,
  revision: ref,
  title: label,
  documents: Type.Array(DocumentSchema, { minItems: 1, maxItems: 20 }),
});
export type DocumentDescriptor = Static<typeof DocumentSchema>;
export type DocumentBundle = Static<typeof DocumentBundleSchema>;
export const DocumentRequestSchema = object({
  capability: Type.String({ minLength: 1, maxLength: 80 }),
  input: Type.Record(Type.String(), Type.Unknown()),
  ref,
  revision: ref,
  document: ref,
  documentRevision: ref,
});
export type DocumentRequest = Static<typeof DocumentRequestSchema>;
export interface DocumentContent {
  bytes: Uint8Array;
  mediaType: DocumentDescriptor['mediaType'];
  revision: string;
  filename?: string;
}
export const ReviewEvidenceSchema = object({
  ref,
  revision: ref,
  documents: Type.Array(object({ id: ref, revision: ref }), { minItems: 1, maxItems: 20 }),
  expiresAt: instant,
  proof: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});
export type ReviewEvidence = Static<typeof ReviewEvidenceSchema>;
/** Connector-owned correction form; source revisions and execute input schemas remain authoritative. */
export const ReviewRecoverySchema = object({
  correction: Type.Optional(
    object({
      capability: Type.String({ minLength: 1, maxLength: 80 }),
      label,
      fields: Type.Array(
        object({
          key: Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,49}$' }),
          label,
          value: Type.String({ maxLength: 2000 }),
          required: Type.Boolean(),
          maxLength: Type.Integer({ minimum: 1, maximum: 2000 }),
        }),
        { minItems: 1, maxItems: 12 },
      ),
    }),
  ),
  source: Type.Optional(object({ capability: Type.String({ minLength: 1, maxLength: 80 }), label })),
});
export type ReviewRecovery = Static<typeof ReviewRecoverySchema>;
export const DocumentReviewSchema = object({
  kind: Type.Literal('documents'),
  capability: Type.String({ minLength: 1, maxLength: 80 }),
  bundle: DocumentBundleSchema,
  evidence: ReviewEvidenceSchema,
  recovery: Type.Optional(ReviewRecoverySchema),
});
export type DocumentReview = Static<typeof DocumentReviewSchema>;

export const MetricSchema = object({
  id: ref,
  label,
  value: Type.Union([Type.Number(), Type.Null()]),
  unit: Type.String({ maxLength: 24 }),
  period: label,
  dataAt: instant,
  tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert'), Type.Literal('none')]),
  comparison: Type.Optional(label),
  target: Type.Optional(Type.Number()),
});
export const MetricsSchema = Type.Array(MetricSchema, { maxItems: 12 });
export type Metric = Static<typeof MetricSchema>;
export const SeriesSchema = object({
  title: label,
  unit: Type.String({ maxLength: 24 }),
  period: label,
  dataAt: instant,
  axis: Type.Union([Type.Literal('time'), Type.Literal('category')]),
  categories: Type.Array(label, { minItems: 1, maxItems: 100 }),
  series: Type.Array(
    object({
      id: ref,
      label,
      role: Type.Union([Type.Literal('actual'), Type.Literal('forecast'), Type.Literal('target')]),
      values: Type.Array(Type.Union([Type.Number(), Type.Null()]), { minItems: 1, maxItems: 100 }),
    }),
    { minItems: 1, maxItems: 6 },
  ),
});
export type Series = Static<typeof SeriesSchema>;
export const ActivitySchema = Type.Array(
  object({
    id: ref,
    at: instant,
    title: label,
    detail: Type.Optional(Type.String({ maxLength: 1000 })),
    actor: Type.Optional(label),
  }),
  { maxItems: 100 },
);
export type Activity = Static<typeof ActivitySchema>;
