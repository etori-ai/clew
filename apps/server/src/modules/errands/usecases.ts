import { CapabilityError, type Actor } from '@clew/connectors';
import { ErrandsOutputSchema, checkContract, openRef, type ErrandsInput, type ErrandsResult } from '@clew/contracts';
import { merge, systemReport, unanswered, type SystemOutcome } from './domain';
import { DEFAULT_BUDGET, type ErrandCall, type ErrandDeps, type ErrandSourceRef } from './model';

/**
 * The combined errand list (D35 item 4, D89): one read to every case system in the person's scope, all at the same
 * time, each under its own budget inside one budget for the whole. Every system answers for what it lets the person
 * see; nothing here knows a group, a namespace or an access rule. What has answered when the budget ends is listed and
 * the rest is named. Nothing of what came back is kept.
 */
export function errandUsecases(deps: ErrandDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  async function askSystem(source: ErrandSourceRef, input: ErrandsInput, call: ErrandCall): Promise<SystemOutcome> {
    const base = { id: source.connectorId, source: source.source };
    try {
      const answer = await withinBudget(call(source.name, input), budget.perSourceMs);
      if (answer === TIMEOUT) return { ...base, status: 'timeout' };
      // A row that is not an errand row is a broken source, not a row to show: the label is the promise that no name is in it.
      if (!checkContract(ErrandsOutputSchema, answer)) return { ...base, status: 'unavailable' };
      return { ...base, status: 'ok', rows: answer.rows };
    } catch {
      return { ...base, status: 'unavailable' };
    }
  }
  /** List as the actor: `call` is the registry handle for this run, so every system's scope applies to the same person. */
  async function list(actor: Actor, input: ErrandsInput, call: ErrandCall): Promise<ErrandsResult> {
    const sources = deps.sources(actor);
    const asked: ErrandsInput = input.view ? { view: input.view } : {};
    const pending = sources.map(s => askSystem(s, asked, call));
    const settled = await withinBudget(Promise.all(pending), budget.totalMs);
    let outcomes: SystemOutcome[];
    if (settled === TIMEOUT) {
      // The total budget ended first: take what has answered, call the rest timed out, and let the stragglers finish unobserved.
      outcomes = await Promise.all(
        pending.map(p => withinBudget(p, 0).then(o => (o === TIMEOUT ? undefined : o))),
      ).then(partial =>
        partial.map(
          (o, i) => o ?? { id: sources[i]!.connectorId, source: sources[i]!.source, status: 'timeout' as const },
        ),
      );
    } else outcomes = settled;
    // An empty list must mean "no errands", never "nobody answered".
    if (sources.length > 0 && outcomes.every(o => o.status !== 'ok'))
      throw new CapabilityError(
        sources.length === 1 ? `${sources[0]!.source} svarar inte just nu.` : 'Inget av ärendesystemen svarar just nu.',
        'unavailable',
      );
    // A row opens in the system it came from: the view its connector declares for one errand (D38), drawn by Clew.
    const opens = new Map(sources.filter(s => s.open).map(s => [s.connectorId, s]));
    const rows = merge(outcomes).map(row => {
      const source = opens.get(row.connector);
      const view = source?.open && openRef(source.open, row, source.source);
      return view ? { ...row, view } : row;
    });
    return { rows, systems: systemReport(outcomes), unanswered: unanswered(outcomes) };
  }
  return { list };
}
const TIMEOUT = Symbol('timeout');
export type ErrandUsecases = ReturnType<typeof errandUsecases>;
