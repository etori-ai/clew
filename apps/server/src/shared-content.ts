import type { Capability } from '@clew/contracts';
import { MODEL_ADMIN_CAPABILITY } from './assistant/usecases/models';

/**
 * The installation-wide content counters a person's change stream folds in (D46, DE-L10), each with the capability that
 * lets a person see what it counts, or none when everyone may. Each is a PostgreSQL sequence (`counterSequence`), moved
 * by `nextval` in the change signals that name it in `changeSignals` of `@clew/db`'s schema, at most once a
 * transaction, and read by `composition/changes.ts`. `tests/unit/shared-content.test.ts` holds this list and the
 * signals to the same counters, and `tests/db/postgres-changes.test.ts` holds the database to its sequences.
 */
export const SHARED_CONTENT = [
  // What everyone's pages draw: the talk rounds, what a person's own model menu shows, the competence catalogue (its
  // types, a requirement of a position or a unit, and the share targets) and the follow-up dialogue's areas and
  // questions. A requirement of one person reaches that person alone.
  { id: 'talk-round' },
  { id: 'model-menu' },
  { id: 'competence-catalogue' },
  { id: 'dialogue-setup' },
  // What only the administration pages draw, for those who may open them: every change to a model or its provider
  // (Administration › Modeller, under the connectors' grant), a connector's check and offers, the competence sources,
  // the boarding layers, the appearance, and the organisation a provisioner pushes.
  { id: 'models', capability: MODEL_ADMIN_CAPABILITY },
  { id: 'connectors', capability: 'admin.connectors' },
  { id: 'competence-source', capability: 'admin.competence' },
  { id: 'boarding-layers', capability: 'admin.boarding' },
  { id: 'appearance', capability: 'admin.appearance' },
  { id: 'organisation', capability: 'admin.users' },
] as const satisfies ReadonlyArray<{ id: string; capability?: Capability }>;
/** The ids of the shared counters, in the order a revision folds them in. */
export const SHARED_COUNTERS: readonly string[] = SHARED_CONTENT.map(c => c.id);
/** The sequence that holds a shared counter, as the change signals' function names it from the counter's id. */
export const counterSequence = (id: string) => 'content_change_' + id.replaceAll('-', '_');
