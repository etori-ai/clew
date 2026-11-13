/**
 * What `scripts/connector-check.ts --as` does before it signs anything as a person of this installation. `--as` makes the
 * check sign that person's identity as Clew signs it, so the checked service and the system behind it record the reads
 * as the person's own. It therefore needs `--id`, a remote connector registered in this installation at the address
 * being checked, so that the service cannot choose the audience of the assertions or the connector a callback grant is
 * for: one of Clew's own connectors is refused, since its callback reach is unbounded and no service is registered
 * under its id, and so is a registered id at another address. It writes one audit row before the first signed request:
 * `connector.checked_as`, actor `operator:cli`, about `person:<their id>`, with the connector's id and counts only, never
 * the user name or the keys asked. The database side is the script's (`liveCheckAs` there); this file stays free of it
 * so the unit suite can run it.
 */
import type { AuthenticatedContext } from '@clew/contracts';

/** The actor an operator's script writes, as `scripts/talk-round.ts` names it. */
export const OPERATOR = 'operator:cli';
/** The audit action of a check signed as a person. */
export const CHECKED_AS = 'connector.checked_as';
export const AS_NEEDS_USER = '--as needs the user name of a person in this installation.';
export const AS_NEEDS_ID =
  '--as signs a real person of this installation, so it requires --id, the id of a connector registered here. Use a test installation or a test account, never a real colleague.';

/** Why the options cannot run, or undefined: `--as` without a user name, or without the registered connector. */
export function asProblem(options: { as?: string; id?: string }): string | undefined {
  if (options.as === undefined) return undefined;
  if (!options.as || options.as.startsWith('--')) return AS_NEEDS_USER;
  if (!options.id || options.id.startsWith('--')) return AS_NEEDS_ID;
  return undefined;
}

/** A connector row as `--as` reads it: one of Clew's own (`bundled`), or a remote service and its address. */
export interface Registration {
  bundled: boolean;
  url: string | null;
}
export interface CheckAsDeps {
  /** The connector registered in this installation under this id, in any state, or undefined. */
  registration: (id: string) => Promise<Registration | undefined>;
  /** The person with this user name, as Clew signs them: their current grant. */
  person: (userName: string) => Promise<AuthenticatedContext | undefined>;
  /** One audit row, committed on its own. */
  audit: (entry: { actor: string; action: string; subject: string; details: Record<string, unknown> }) => Promise<void>;
}
/** An address as a registration compares it: parsed where it parses, without a trailing slash. */
const address = (url: string) => {
  try {
    return new URL(url).href.replace(/\/+$/, '');
  } catch {
    return url.replace(/\/+$/, '');
  }
};

/**
 * The person `--as` names, handed back only after the audit row is written, so that no request is signed as them
 * without a trace. Refuses, writing nothing: an id this installation has not registered, one of Clew's own connectors,
 * a connector registered at another address than `url`, the one being checked, and a user name that names no person
 * with a grant. `keys` and `reads` are counts: the keys the batch asks and the reads about an entity the check signs as
 * the person.
 */
export async function checkAs(
  input: { id: string; url: string; userName: string; keys: number; reads: number },
  deps: CheckAsDeps,
): Promise<AuthenticatedContext> {
  const registered = await deps.registration(input.id);
  if (!registered)
    throw new Error(
      `--id ${input.id}: no connector with that id is registered in this installation; register it first (bun scripts/connector-add.ts).`,
    );
  if (registered.bundled || !registered.url)
    throw new Error(
      `--id ${input.id} is one of Clew's own connectors, not a registered service; pass the id the service was registered under (bun scripts/connector-add.ts).`,
    );
  if (address(registered.url) !== address(input.url))
    throw new Error(
      `--id ${input.id} is registered at ${registered.url}, not at ${input.url}; --as checks a connector only at the address it is registered at.`,
    );
  const persona = await deps.person(input.userName);
  if (!persona)
    throw new Error(`--as ${input.userName}: no person with that user name and a grant in this installation.`);
  await deps.audit({
    actor: OPERATOR,
    action: CHECKED_AS,
    subject: 'person:' + persona.id,
    details: { connector: input.id, keys: input.keys, reads: input.reads },
  });
  return persona;
}
