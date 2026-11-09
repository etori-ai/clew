export function createStatusFixture(): {
  setDown(value: boolean): void;
  request(method: string, params?: Record<string, unknown>): Promise<any>;
};
export function statusChangeKey(result: { service: string; state: string; incidentId: string | null }): string;
