import type { StatusKind } from './connector.mjs';
export type Relation = 'assigned' | 'group' | 'reported';
export interface SourceCase {
  id: string;
  number: string;
  caseType: string;
  type: string;
  status: string;
  statusLabel: string;
  closed: boolean;
  since: string;
  category?: string;
  handlerId?: string;
  groupId?: string;
  group?: string;
  customerId?: string;
  title?: string;
  suspendedTo?: string;
  /** When the errand was reported, where the source says it. */
  created?: string;
}
export type Match = { status: 'none' } | { status: 'ambiguous' } | { status: 'one'; id: string; groups?: string[] };
export interface Found {
  handler: Match;
  customer: Match;
}
export interface Person {
  handler?: { id: string; groups: string[] };
  customer?: { id: string };
}
export interface Memo {
  text: string;
  extension?: string;
}
export interface CaseSource {
  person(account: string): Promise<Found>;
  list(person: Person, relation: Relation, caseTypes: string[]): Promise<{ cases: unknown[]; complete: boolean }>;
  one(id: string): Promise<unknown>;
  memo(id: string, type: string): Promise<Memo | null>;
  create?(fault: Fault, operationId?: string): Promise<unknown>;
  /**
   * D148: the service agreements booked on an account that begins with this code. Only with the cost read on. A code
   * is `COST_CODE`; a source refuses anything else, so a short value is never a prefix to list accounts by.
   */
  agreements?(code: string): Promise<{ agreements: unknown[]; complete: boolean }>;
}
export interface SourceAgreement {
  id: string;
  account: string;
  amount?: number;
}
export interface Fault {
  customerId: string;
  title: string;
  description: string;
  caseType: string;
  category: string;
  groupId: string;
}
export declare class SourceUnavailable extends Error {}
/** D148: what a unit's code is at the port, whatever an installation's own pattern lets through. */
export declare const COST_CODE: RegExp;
export declare const RELATIONS: Relation[];
export declare function toSourceCase(raw: unknown): SourceCase | null;
export declare function toSourceAgreement(raw: unknown): SourceAgreement | null;
export declare const fixtureAgreements: SourceAgreement[];
export declare function resolved(found: Found): Person;
export declare function holds(errand: SourceCase, person: Person, relation: Relation): boolean;
export declare function relationOf(errand: SourceCase, person: Person): Relation | undefined;
export declare function plainText(memo: Memo | null | undefined): string | undefined;
export declare const fixtureStatusKinds: Record<string, StatusKind>;
export declare const fixtureCaseTypes: string[];
export declare const FIXTURE_PROBLEM_MEMO: string;
export declare const fixtureCreate: { caseType: string; category: string; groupId: string };
export declare const fixturePeople: {
  users: Array<{ id: string; account: string; groups: string[] }>;
  customers: Array<{ id: string; account: string }>;
};
export declare function createFixtureCases(options?: {
  people?: typeof fixturePeople;
  agreements?: SourceAgreement[];
  now?: () => number;
}): CaseSource;
