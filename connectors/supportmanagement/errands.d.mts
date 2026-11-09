import type { ErrandSource, Relation, SourceErrand } from './connector.mjs';
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
export declare function createFixtureErrands(options?: {
  audience?: string;
  namespaces?: Record<string, FixtureNamespace>;
  groups?: Record<string, string[]>;
  now?: () => number;
}): ErrandSource;
