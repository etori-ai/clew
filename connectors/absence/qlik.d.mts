import type { StatRow, Statistics } from './connector.mjs';
export interface QlikCube {
  unit: string;
  period: string;
  measures: { total: string; headcount: string; short?: string; long?: string };
}
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void, options?: { once?: boolean }): void;
}
export declare function hypercubeFor(cube: QlikCube): { measures: string[]; qProp: unknown };
export declare function toRowFromCells(
  cells: unknown,
  measures: string[],
  ratesAs?: 'fraction' | 'percent',
): StatRow | null;
export declare function createQlikStatistics(options: {
  url?: string;
  appId?: string;
  token?: string | (() => Promise<string>);
  cube?: QlikCube;
  ratesAs?: 'fraction' | 'percent';
  socket?: (url: string, headers: Record<string, string>) => SocketLike;
  timeoutMs?: number;
}): Statistics;
