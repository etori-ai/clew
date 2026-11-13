import { CapabilityError, type Actor } from '@clew/connectors';
import { RequestsOutputSchema, checkContract, openRef } from '@clew/contracts';
import { merge, systemReport, unanswered, type RequestList, type SystemOutcome } from './domain';
import { DEFAULT_BUDGET, type RequestCall, type RequestDeps, type RequestSourceRef } from './model';

/**
 * The combined request list (D123): one read to every service desk in the person's scope, all at the same time, each
 * under its own budget inside one budget for the whole. Every system answers for what the person ordered or reported
 * there; nothing here knows an account, a queue or an access rule. What has answered when the budget ends is listed and
 * the rest is named. Nothing of what came back is kept.
 */
export function requestUsecases(deps: RequestDeps) {
  const budget = { ...DEFAULT_BUDGET, ...deps.budget };
  const withinBudget = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(TIMEOUT), ms);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  };
  async function askSystem(source: RequestSourceRef, call: RequestCall): Promise<SystemOutcome> {
    const base = { id: source.connectorId, source: source.source };
    try {
      const answer = await withinBudget(call(source.name, {}), budget.perSourceMs);
      if (answer === TIMEOUT) return { ...base, status: 'timeout' };
      // A row that is not a request row is a broken source, not a row to show: the label is the promise that no name is in it.
      if (!checkContract(RequestsOutputSchema, answer)) return { ...base, status: 'unavailable' };
      return { ...base, status: 'ok', rows: answer.rows };
    } catch {
      return { ...base, status: 'unavailable' };
    }
  }
  /** List as the actor: `call` is the registry handle for this run, so every system's scope applies to the same person. */
  async function list(actor: Actor, call: RequestCall): Promise<RequestList> {
    const sources = deps.sources(actor);
    const pending = sources.map(s => askSystem(s, call));
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
    // An empty list must mean "nothing ordered or reported", never "nobody answered".
    if (sources.length > 0 && outcomes.every(o => o.status !== 'ok'))
      throw new CapabilityError(
        sources.length === 1
          ? `${sources[0]!.source} svarar inte just nu.`
          : 'Inget av systemen för beställningar och felanmälningar svarar just nu.',
      );
    // A row opens in the system it came from: the view its connector declares for one request (D38), drawn by Clew.
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
export type RequestUsecases = ReturnType<typeof requestUsecases>;
