import type { ErrandSource, Message, OwnerSource, Relation, SourceErrand } from './connector.mjs';
export declare class SourceDenied extends Error {}
export declare class SourceNotFound extends Error {}
export declare class SourceUnavailable extends Error {}
export declare const RELATIONS: Relation[];
export declare function toSourceErrand(
  raw: unknown,
  options?: { namespace?: string; area?: string; metadata?: unknown; relation?: Relation },
): SourceErrand | null;
export interface FixtureNamespace {
  displayName: string;
  groups: string[];
  metadata: unknown;
}
export declare const fixtureNamespaces: Record<string, FixtureNamespace>;
export declare const fixtureGroups: Record<string, string[]>;
export declare const fixtureReplyAddresses: Record<string, string>;
export declare const fixtureFlowOwners: Record<string, string>;
export declare function ownerOf(raw: unknown): { username: string; email?: string } | null;
export declare function flowInstanceOf(raw: unknown): string | undefined;
export declare function toMessages(
  raw?: { communications?: unknown[]; conversations?: unknown[] },
  owner?: { username: string; email?: string } | null,
): Message[];
export interface FixtureErrands extends ErrandSource, OwnerSource {
  posted(): Array<{ flowInstanceId: string; userId: string; message: string }>;
  handlerWrites(errandNumber: string, channel?: 'email' | 'webmessage'): boolean;
  mailFiled(errandNumber: string): boolean;
}
export declare function createFixtureErrands(options?: {
  audience?: string;
  namespaces?: Record<string, FixtureNamespace>;
  groups?: Record<string, string[]>;
  now?: () => number;
}): FixtureErrands;
