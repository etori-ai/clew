/** The port of the development reset (D25): forget the mock connectors' state and close their open cards, audited. */
export interface MockResetStore {
  /** Delete every mock connector's remembered state. */
  resetState(): Promise<void>;
  transaction<T>(
    fn: (tx: {
      /** Dismiss every open thread pushed by these connectors, at this instant. */
      dismissOpenThreadsOf(connectorIds: string[], at: string): Promise<void>;
      writeAudit(entry: {
        actor: string;
        action: string;
        subject: string;
        at: string;
        details?: Record<string, unknown>;
      }): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
}
