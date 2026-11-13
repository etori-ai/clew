export declare const CONNECTOR: 'servicedesk';
export declare const SOURCE: string;
export declare const KEYS_MAX: number;
export declare const ADMITS: readonly string[];
export declare const requestRefPattern: string;
export declare const STATES: readonly string[];
export declare const CATALOGUE: ReadonlyArray<{ value: string; label: string }>;
export declare const REQUEST_TITLE: string;
export declare const executeResult: unknown;
/** The manifest, typed as far as a reader of its views needs; the protocol's `ConnectorManifest` is the full shape. */
export declare const manifest: {
  protocol: number;
  id: 'servicedesk';
  source: string;
  capabilities: ReadonlyArray<{ name: string; kind: string; title: string; view?: Record<string, unknown> }>;
};
