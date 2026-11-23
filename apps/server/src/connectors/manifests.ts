import type { ManifestDiff } from '@clew/contracts';
import type { ConnectorManifest } from '@clew/connectors/protocol';

/**
 * Comparing manifests (D144): pure functions shared by the admin use cases, the boot loader, the reconciler and the
 * stores. A manifest is compared by content, never by its text, since a jsonb round trip reorders its keys.
 */

/** The same document whatever order its keys come back in from the store, so a jsonb round trip is not a change. */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );

/** A manifest's `uses` is a set, so its order is no change; the order of capabilities and areas is (`manifestDiff`). */
const comparable = (value: unknown): unknown =>
  isManifest(value) && Array.isArray(value.uses) ? { ...value, uses: [...value.uses].sort() } : value;

export const sameManifest = (a: unknown, b: unknown) =>
  canonical(comparable(a ?? null)) === canonical(comparable(b ?? null));

export const isManifest = (value: unknown): value is ConnectorManifest =>
  !!value && typeof value === 'object' && Array.isArray((value as ConnectorManifest).capabilities);

/**
 * The offer that waits for an administrator (D144): the manifest the service serves and since when, while it differs
 * from the approved one. An offer that came to equal the approved one waits for nothing.
 */
export const pendingOffer = (row: {
  manifest: unknown;
  offered: unknown;
  offeredAt: string | null;
}): { manifest: ConnectorManifest; at: string } | undefined =>
  isManifest(row.offered) && row.offeredAt && !sameManifest(row.manifest, row.offered)
    ? { manifest: row.offered, at: row.offeredAt }
    : undefined;

/** The top-level fields the diff names on their own lines; every other field that changed is listed in `fields`. */
const NAMED = new Set(['id', 'capabilities', 'areas', 'uses', 'delegation']);

/** The fields of two objects whose values differ, by name, sorted. */
const changedKeys = (before: object | undefined, after: object | undefined, skip: ReadonlySet<string> = new Set()) =>
  [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter(
      k =>
        !skip.has(k) &&
        !sameManifest(
          (before as Record<string, unknown> | undefined)?.[k],
          (after as Record<string, unknown> | undefined)?.[k],
        ),
    )
    .sort();

/**
 * What changed between the approved manifest and an offered one, as the review and the audit row show it: capabilities
 * and areas, each changed one with the fields that changed in it (a widened `scope` or `roles` is what an administrator
 * weighs), the other systems' reads the connector calls back as the person (`uses`), the audience whose token it is
 * handed (`delegation`), and every other field by name.
 */
export function manifestDiff(approved: ConnectorManifest | undefined, offered: ConnectorManifest): ManifestDiff {
  const names = (m?: ConnectorManifest) => new Set((m?.capabilities ?? []).map(c => c.name));
  const areas = (m?: ConnectorManifest) => new Set((m?.areas ?? []).map(a => a.id));
  const minus = <T>(a: Set<T>, b: Set<T>) => [...a].filter(x => !b.has(x));
  const before = names(approved),
    after = names(offered);
  const changed = [...after]
    .filter(n => before.has(n))
    .map(name => ({
      name,
      fields: changedKeys(
        approved!.capabilities.find(c => c.name === name),
        offered.capabilities.find(c => c.name === name),
      ),
    }))
    .filter(c => c.fields.length);
  const areasBefore = areas(approved),
    areasAfter = areas(offered);
  const areasChanged = [...areasAfter]
    .filter(id => areasBefore.has(id))
    .map(id => ({
      id,
      fields: changedKeys(
        approved!.areas.find(a => a.id === id),
        offered.areas.find(a => a.id === id),
      ),
    }))
    .filter(a => a.fields.length);
  const usesBefore = new Set(approved?.uses ?? []),
    usesAfter = new Set(offered.uses ?? []);
  const from = approved?.delegation?.audience ?? null,
    to = offered.delegation?.audience ?? null;
  // The capabilities and areas both manifests have, in another order: a change of what is drawn in which order, which
  // the review names, so an offer is never a review with nothing in it.
  const reordered = (a: string[], b: string[]) => a.join('\n') !== b.join('\n');
  const kept = <T>(list: T[], key: (x: T) => string, other: Set<string>) => list.map(key).filter(k => other.has(k));
  const fields = [
    ...changedKeys(approved, offered, NAMED),
    ...(reordered(
      kept(approved?.capabilities ?? [], c => c.name, after),
      kept(offered.capabilities, c => c.name, before),
    )
      ? ['capabilities']
      : []),
    ...(reordered(
      kept(approved?.areas ?? [], a => a.id, areasAfter),
      kept(offered.areas ?? [], a => a.id, areasBefore),
    )
      ? ['areas']
      : []),
  ].sort();
  return {
    added: minus(after, before),
    removed: minus(before, after),
    changed,
    areasAdded: minus(areasAfter, areasBefore),
    areasRemoved: minus(areasBefore, areasAfter),
    areasChanged,
    usesAdded: minus(usesAfter, usesBefore),
    usesRemoved: minus(usesBefore, usesAfter),
    ...(from !== to ? { delegation: { from, to } } : {}),
    fields,
    same: sameManifest(approved, offered),
  };
}

/** What the `connector.manifest` audit row says changed: the whole diff, every capability's and area's fields included. */
export const diffDetails = ({ same: _same, ...changes }: ManifestDiff): Record<string, unknown> => ({ ...changes });
