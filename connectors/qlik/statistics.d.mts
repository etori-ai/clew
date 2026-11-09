import type { StatRow, Statistics } from './connector.mjs';
export declare class StatisticsUnavailable extends Error {}
export declare function toStatRow(raw: unknown): StatRow | null;
export declare const fixtureUnitMap: Record<string, string[]>;
export declare function createFixtureStatistics(options?: { now?: () => Date }): Statistics;
