import type { Actor } from '@clew/connectors';
import {
  AboutOutputSchema,
  checkContract,
  type AboutInput,
  type AboutQuery,
  type AboutResult,
  type AboutSection,
} from '@clew/contracts';
import { askedKeys, keptRows } from './domain';
import { DEFAULT_BUDGET, type AboutCall, type AboutDeps, type AboutSourceRef } from './model';

/**
 * The read across sources about an entity (D97 items 5 and 7): every read that declares the kind and that the person may
 * call is asked with the same keys at the same time, each under its own budget inside one budget for the whole. Only
 * keys the reader may already see are sent; the rest are dropped without a word. A source that is late, fails or answers
 * what it was not asked says so in its own section and the others stand. Nothing of what came back is kept.
 */
export function aboutUsecases(deps: AboutDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  const section = (source: AboutSourceRef, status: AboutSection['status'], rows: AboutSection['rows'] = []) => ({
    connector: source.connectorId,
    source: source.source,
    capability: source.name,
    title: source.title,
    view: source.view,
    status,
    rows,
  });
  async function askSource(source: AboutSourceRef, input: AboutInput, call: AboutCall): Promise<AboutSection> {
    try {
      const answer = await withinBudget(call(source.name, input), budget.perSourceMs);
      if (answer === TIMEOUT) return section(source, 'timeout');
      if (!checkContract(AboutOutputSchema, answer)) return section(source, 'unavailable');
      const rows = keptRows(answer.rows, input.keys);
      return rows ? section(source, 'ok', rows) : section(source, 'unavailable');
    } catch {
      return section(source, 'unavailable');
    }
  }
  /** Read as the actor: `call` is the registry handle for this run, so every source's scope applies to the same person. */
  async function read(actor: Actor, query: AboutQuery, call: AboutCall): Promise<AboutResult> {
    const sources = deps.sources(actor, query.kind);
    if (!sources.length) return { kind: query.kind, sections: [] };
    const keys = askedKeys(query.keys, await deps.reach(actor, query.kind));
    // Nobody the reader may see was asked about: every source has nothing to say, and none is called.
    if (!keys.length) return { kind: query.kind, sections: sources.map(s => section(s, 'ok')) };
    const pending = sources.map(s => askSource(s, { keys }, call));
    const settled = await withinBudget(Promise.all(pending), budget.totalMs);
    if (settled !== TIMEOUT) return { kind: query.kind, sections: settled };
    // The total budget ended first: take what has answered and let the stragglers finish unobserved.
    const partial = await Promise.all(pending.map(p => withinBudget(p, 0)));
    return {
      kind: query.kind,
      sections: partial.map((s, i) => (s === TIMEOUT ? section(sources[i]!, 'timeout') : s)),
    };
  }
  return { read };
}
const TIMEOUT = Symbol('timeout');
export type AboutUsecases = ReturnType<typeof aboutUsecases>;
