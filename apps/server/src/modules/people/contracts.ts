import { Type, type Static } from '@sinclair/typebox';

/**
 * The SCIM 2.0 contract Clew serves (RFC 7643, RFC 7644; D68): what a provisioner may send. Inputs are permissive on
 * purpose, as the standard requires: unknown attributes and extension schemas are accepted and ignored. What D68 needs
 * beyond the standard (`externalId`, a display name, a work address) is checked in the use case, not the schema, so the
 * error can name the attribute. Error texts are English: a machine reads them, never a person in the product.
 */
export const SCIM = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  serviceProviderConfig: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const;
export const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';
/** The most rows one list answers (ServiceProviderConfig `filter.maxResults`). */
export const SCIM_MAX_RESULTS = 200;

const text = Type.String({ minLength: 1, maxLength: 512 });
export const ScimEmailSchema = Type.Object(
  { value: text, type: Type.Optional(Type.String()), primary: Type.Optional(Type.Boolean()) },
  { additionalProperties: true },
);
export const ScimUserInputSchema = Type.Object(
  {
    schemas: Type.Optional(Type.Array(Type.String())),
    externalId: Type.Optional(text),
    userName: text,
    displayName: Type.Optional(text),
    name: Type.Optional(
      Type.Object(
        {
          formatted: Type.Optional(Type.String()),
          givenName: Type.Optional(Type.String()),
          familyName: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
    emails: Type.Optional(Type.Array(ScimEmailSchema)),
    active: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);
export type ScimUserInput = Static<typeof ScimUserInputSchema>;
export const ScimMemberSchema = Type.Object(
  { value: text, display: Type.Optional(Type.String()), $ref: Type.Optional(Type.String()) },
  { additionalProperties: true },
);
export const ScimGroupInputSchema = Type.Object(
  {
    schemas: Type.Optional(Type.Array(Type.String())),
    externalId: Type.Optional(text),
    displayName: text,
    members: Type.Optional(Type.Array(ScimMemberSchema)),
  },
  { additionalProperties: true },
);
export type ScimGroupInput = Static<typeof ScimGroupInputSchema>;
export const ScimPatchSchema = Type.Object(
  {
    schemas: Type.Array(Type.String()),
    Operations: Type.Array(
      Type.Object(
        { op: Type.String(), path: Type.Optional(Type.String()), value: Type.Optional(Type.Unknown()) },
        { additionalProperties: true },
      ),
      { minItems: 1, maxItems: 500 },
    ),
  },
  { additionalProperties: true },
);
export type ScimPatch = Static<typeof ScimPatchSchema>;
export type ScimPatchOperation = ScimPatch['Operations'][number];

export type ScimStatus = 400 | 401 | 403 | 404 | 409 | 413 | 500 | 501;
/** RFC 7644 §3.12: `scimType` for a 400 names the kind of mistake; `detail` says which attribute. */
export type ScimType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive';
export class ScimError extends Error {
  constructor(
    readonly status: ScimStatus,
    readonly detail: string,
    readonly scimType?: ScimType,
  ) {
    super(detail);
    this.name = 'ScimError';
  }
  body() {
    return {
      schemas: [SCIM.error],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.detail,
    };
  }
}
/** What a list answers: page and total, as RFC 7644 §3.4.2 draws it. */
export interface ScimList<T> {
  schemas: [typeof SCIM.list];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}
export interface ScimMeta {
  resourceType: 'User' | 'Group';
  created: string;
  lastModified: string;
  location: string;
}
export interface ScimUser {
  schemas: [typeof SCIM.user];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  name: { formatted: string };
  emails: Array<{ value: string; type: 'work'; primary: true }>;
  active: boolean;
  groups: Array<{ value: string; display: string; $ref: string }>;
  meta: ScimMeta;
}
export interface ScimGroup {
  schemas: [typeof SCIM.group];
  id: string;
  externalId?: string;
  displayName: string;
  members: Array<{ value: string; display: string; $ref: string }>;
  meta: ScimMeta;
}
