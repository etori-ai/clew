import type { OwnerSource } from './connector.mjs';
export declare class OwnerError extends Error {
  code: string;
  status: number;
}
export declare const REQUEST_AREA: 'requests';
export declare function createOwnerSide(options: {
  source: OwnerSource;
  verifyToken: (
    token: string,
  ) => Promise<{ status: 'ok'; claims: Record<string, unknown> } | { status: 'refused' } | { status: 'unavailable' }>;
  accountClaim?: string;
  municipalityId: string;
  sourceLabel: string;
  kindOf: (status: string) => string;
  linkOf?: (errand: unknown) => string | undefined;
  replyAddresses?: Record<string, string>;
  stateSeconds?: number;
  readLimit?: number;
  parallel?: number;
  now?: () => number;
  say?: (line: Record<string, unknown>) => void;
}): {
  names: string[];
  run(
    name: string,
    input: Record<string, unknown>,
    context: { actor: unknown; token?: string | null; operationId?: string },
  ): Promise<unknown>;
  scan(actor: unknown, token?: string | null): Promise<unknown>;
  forget(): void;
};
