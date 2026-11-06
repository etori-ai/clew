/**
 * Binding a follower to a fact kind from a script (D55 item 9): what `job-bind.ts` does from the command line and
 * `dev-connectors.ts` does for the development chain. One binding per kind and capability: a second call changes the row
 * instead of adding a twin. The row and its audit row go in one transaction; the job assembler reads the rows on every
 * call, so a binding made here counts from the next job on.
 */
import { requireFixtureDevelopment } from './fixture-development';
import { randomUUID } from 'node:crypto';
import { postgresFollowBindingStore } from '../apps/server/src/modules/jobs/adapters/postgres';
import type { FollowBinding, FollowBindingInput } from '../apps/server/src/modules/jobs/contracts';

const actor = 'bootstrap:binding';
export const bindingStore = postgresFollowBindingStore();

export function bindingProblem(input: FollowBindingInput): string | undefined {
  // The same shapes as `FollowBindingInputSchema`; the admin use case validates with the schema itself.
  if (!/^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$/.test(input.kind))
    return `Invalid fact kind ${input.kind}: <connector id>:<kind>.`;
  if (!/^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(input.capability))
    return `Invalid capability ${input.capability}: <connector id>.<name>.`;
  if (input.within && !/^P(?!$)(\d+D)?(T(?=\d)(\d+H)?(\d+M)?)?$/.test(input.within))
    return `Invalid window ${input.within}: an ISO 8601 duration in days, hours and minutes.`;
  return undefined;
}

export async function bindFollower(input: FollowBindingInput, enabled = true, ifMissing = false) {
  const problem = bindingProblem(input);
  if (problem) throw new Error(problem);
  const existing = (await bindingStore.list(input.kind)).find(b => b.capability === input.capability);
  if (existing && ifMissing) return { binding: existing, existing: true, preserved: true };
  const at = new Date().toISOString();
  const binding: FollowBinding = {
    id: existing?.id ?? randomUUID(),
    ...input,
    enabled,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await bindingStore.transaction(async tx => {
    await tx.upsert(binding);
    await tx.audit({
      actor,
      action: existing ? 'job.binding_changed' : 'job.binding_added',
      subject: 'binding:' + binding.id,
      at,
      details: {
        kind: binding.kind,
        capability: binding.capability,
        audience: binding.audience,
        within: binding.within ?? null,
        enabled,
      },
    });
  });
  return { binding, existing: !!existing };
}

/**
 * The fixture connectors' offer (D55): the HR system registers the report, time reporting marks the shift, payroll is only
 * watched. The window is short in development so a watch can be seen expiring.
 */
export async function bindFixtureFollowers(within = 'PT3M', ifMissing = false) {
  requireFixtureDevelopment();
  const results = [];
  for (const input of [
    { kind: 'hr:absence', capability: 'hr.proposeAbsence', audience: { mode: 'all' as const } },
    { kind: 'hr:absence', capability: 'timesheet.followAbsence', audience: { mode: 'all' as const } },
    { kind: 'hr:absence', capability: 'payroll.followAbsence', audience: { mode: 'all' as const }, within },
  ])
    results.push(await bindFollower(input, true, ifMissing));
  return results;
}

export const describeBinding = ({ binding, existing, preserved }: Awaited<ReturnType<typeof bindFollower>>) =>
  `${preserved ? 'Kept' : existing ? 'Changed' : 'Added'} ${binding.kind} -> ${binding.capability}${binding.within ? ' within ' + binding.within : ''} (${binding.id})${binding.enabled ? '' : ', disabled'}`;
