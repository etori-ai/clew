import { Value } from '@sinclair/typebox/value';
import type { Actor } from '@clew/connectors';
import { SearchHitSchema, SearchOutputSchema, type SearchHit, type SearchResult } from '@clew/contracts';
import { merge, sourceReport, type SourceOutcome } from './domain';
import { DEFAULT_BUDGET, type SearchCall, type SearchDeps, type SearchSourceRef } from './model';
import type { FetchInput, SearchInput } from './contracts';

/**
 * The composite search (D26): one query to every search source in the person's scope, all at the same time, each under
 * its own budget inside one budget for the whole. What has answered when the budget ends is merged; the rest is
 * reported by name. Clew keeps nothing of what came back except in the answer's view and the audit row's refs.
 */
export function searchUsecases(deps: SearchDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T,>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  async function askSource(source: SearchSourceRef, query: string, call: SearchCall): Promise<SourceOutcome> {
    const base = { id: source.connectorId, source: source.source };
    try {
      const answer = await withinBudget(call(source.name, { query }), budget.perSourceMs);
      if (answer === TIMEOUT) return { ...base, status: 'timeout' };
      if (!Value.Check(SearchOutputSchema, answer)) return { ...base, status: 'unavailable' };
      return { ...base, status: 'ok', rows: answer.rows };
    } catch { return { ...base, status: 'unavailable' }; }
  }
  /** Search as the actor: `call` is the registry handle for this run, so every source's scope applies to the same person. */
  async function search(actor: Actor, input: SearchInput, call: SearchCall): Promise<SearchResult> {
    const wanted = input.kinds;
    const sources = deps.sources(actor).filter(s => !wanted || !s.kinds || s.kinds.some(k => wanted.includes(k)));
    const pending = sources.map(s => askSource(s, input.query, call));
    const settled = await withinBudget(Promise.all(pending), budget.totalMs);
    let outcomes: SourceOutcome[];
    if (settled === TIMEOUT) {
      // The total budget ended first: take what has answered, call the rest timed out, and let the stragglers finish unobserved.
      outcomes = await Promise.all(pending.map(p => withinBudget(p, 0).then(o => o === TIMEOUT ? undefined : o)))
        .then(partial => partial.map((o, i) => o ?? { id: sources[i]!.connectorId, source: sources[i]!.source, status: 'timeout' as const }));
    } else outcomes = settled;
    return { rows: merge(outcomes, deps.clock().getTime()), sources: sourceReport(outcomes) };
  }
  /** One hit back by its ref, from the connector that found it: what a document chip resolves to and what a card's link opens. */
  async function fetch(actor: Actor, connectorId: string, input: FetchInput, call: SearchCall): Promise<SearchHit | undefined> {
    if (!deps.sources(actor).some(s => s.connectorId === connectorId)) return undefined;
    try {
      const answer = await call(connectorId + '.fetch', { ref: input.ref });
      return Value.Check(SearchHitSchema, answer) ? answer : undefined;
    } catch { return undefined; }
  }
  return { search, fetch };
}
const TIMEOUT = Symbol('timeout');
export type SearchUsecases = ReturnType<typeof searchUsecases>;
