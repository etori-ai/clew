import type { Actor } from '@clew/connectors';
import { NewsOutputSchema, checkContract, openRef, type NewsResult } from '@clew/contracts';
import { merge, type SourceOutcome } from './domain';
import { DEFAULT_BUDGET, type NewsCall, type NewsDeps, type NewsSourceRef } from './model';

/**
 * The combined news list (D111, amended 2026-11-11): one read to every news source in the person's scope, all at the
 * same time, each under its own budget inside one budget for the whole. Every source answers for what it lets the
 * person read; nothing here knows an audience or a feed. A source that fails, is late or answers out of shape
 * contributes nothing and is not named: news is never an error on Hem. Nothing of what came back is kept.
 */
export function newsUsecases(deps: NewsDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  async function askSource(source: NewsSourceRef, call: NewsCall): Promise<SourceOutcome> {
    const base = { id: source.connectorId, source: source.source };
    try {
      const answer = await withinBudget(call(source.name, {}), budget.perSourceMs);
      // A row that is not a news row is a broken source, not a row to show: the shape is the promise that a row is a
      // headline, a sender and a time, and nothing else.
      if (answer === TIMEOUT || !checkContract(NewsOutputSchema, answer)) return { ...base, rows: [] };
      return { ...base, rows: answer.rows };
    } catch {
      return { ...base, rows: [] };
    }
  }
  /** List as the actor: `call` is the registry handle for this run, so every source's scope applies to the same person. */
  async function list(actor: Actor, call: NewsCall): Promise<NewsResult> {
    const sources = deps.sources(actor);
    const pending = sources.map(s => askSource(s, call));
    const settled = await withinBudget(Promise.all(pending), budget.totalMs);
    // The total budget ended first: take what has answered and let the stragglers finish unobserved.
    const outcomes =
      settled === TIMEOUT
        ? (await Promise.all(pending.map(p => withinBudget(p, 0)))).filter((o): o is SourceOutcome => o !== TIMEOUT)
        : settled;
    // A row opens in Clew in the source it came from, when it has no link out and the source declares the read (D38).
    const opens = new Map(sources.filter(s => s.open).map(s => [s.connectorId, s]));
    const rows = merge(outcomes).map(row => {
      const source = opens.get(row.connector);
      const view = !row.link && source?.open ? openRef(source.open, row, source.source) : undefined;
      return view ? { ...row, view } : row;
    });
    return { rows };
  }
  return { list };
}
const TIMEOUT = Symbol('timeout');
export type NewsUsecases = ReturnType<typeof newsUsecases>;
