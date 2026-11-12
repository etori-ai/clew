import { SCIM_EMPLOYMENT_SCHEMA, type DirectoryPhone, type Employment } from '@clew/contracts';

/**
 * The SCIM 2.0 contract Clew serves (RFC 7643, RFC 7644; D68): the names, the error and the resources it answers.
 * What a provisioner may send is read in `domain.ts`, attribute by attribute and the same way for a full
 * representation and for a patch, so every refusal names the attribute; unknown attributes and extension schemas are
 * accepted and ignored, as the standard requires. Error texts are English: a machine reads them, never a person in
 * the product.
 */
export const SCIM = {
  employment: SCIM_EMPLOYMENT_SCHEMA,
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  serviceProviderConfig: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
  /** D99: the extension a `unit:` group carries its place in the organisation tree in. Its one attribute is `parent`. */
  unit: 'urn:clew:params:scim:schemas:extension:unit:2.0:Group',
} as const;
export const SCIM_CONTENT_TYPE = 'application/scim+json; charset=utf-8';
/** The most rows one list answers (ServiceProviderConfig `filter.maxResults`). */
export const SCIM_MAX_RESULTS = 200;

/** One operation of a PatchOp message, as `patchOperations` in the domain reads it out of a request body. */
export interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export type ScimStatus = 400 | 401 | 403 | 404 | 405 | 409 | 413 | 500 | 501 | 503;
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
  schemas: [typeof SCIM.user] | [typeof SCIM.user, typeof SCIM.employment];
  id: string;
  externalId?: string;
  userName: string;
  displayName: string;
  name: { formatted: string };
  emails: Array<{ value: string; type: 'work'; primary: true }>;
  phoneNumbers?: DirectoryPhone[];
  [SCIM.employment]?: { employments: Employment[] };
  title?: string;
  active: boolean;
  groups: Array<{ value: string; display: string; $ref: string }>;
  meta: ScimMeta;
}
export interface ScimGroup {
  schemas: [typeof SCIM.group] | [typeof SCIM.group, typeof SCIM.unit];
  id: string;
  externalId?: string;
  displayName: string;
  members: Array<{ value: string; display: string; $ref: string }>;
  /** D99: on a `unit:` group that has a unit above it; `parent` is that unit group's `externalId`. */
  [SCIM.unit]?: { parent: string };
  meta: ScimMeta;
}
