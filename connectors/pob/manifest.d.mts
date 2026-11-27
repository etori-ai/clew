export declare const CONNECTOR: 'pob';
export declare const DEFAULT_AUDIENCE: string;
export declare const DEFAULT_SOURCE: string;
export declare const errandRefParts: { id: string };
export declare const errandRefPattern: string;
export declare const requestRefPattern: string;
export declare const STATES: string[];
export declare const REQUEST_STATES: string[];
export declare const REQUEST_AREA: 'requests';
export declare const KEYS_MAX: number;
export declare function unitCostsCapability(options?: { identifier?: string; amountLabel?: string }): unknown;
export declare function createManifest(options?: {
  audience?: string;
  source?: string;
  writes?: string[];
  costs?: { identifier: string; amountLabel?: string };
}): unknown;
export declare const manifest: unknown;
