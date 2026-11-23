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

export const sameManifest = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);

/**
 * What a check records as offered: nothing when the service served no manifest, `null` when it serves the approved one,
 * the served manifest when it differs. The approved manifest is never replaced here.
 */
export const offerOf = (
  approved: unknown,
  served: ConnectorManifest | undefined,
): ConnectorManifest | null | undefined =>
  served === undefined ? undefined : sameManifest(approved, served) ? null : served;

/** The top-level fields the diff names on their own lines; every other field that changed is listed in `fields`. */
const NAMED = new Set(['id', 'capabilities', 'areas', 'uses', 'delegation']);

/**
 * What changed between the approved manifest and an offered one, as the review and the audit row show it: capabilities
 * and areas, the other systems' reads the connector calls back as the person (`uses`), the audience whose token it is
 * handed (`delegation`), and every other field by name.
 */
export function manifestDiff(approved: ConnectorManifest | undefined, offered: ConnectorManifest): ManifestDiff {
  const names = (m?: ConnectorManifest) => new Set((m?.capabilities ?? []).map(c => c.name));
  const areas = (m?: ConnectorManifest) => new Set((m?.areas ?? []).map(a => a.id));
  const minus = <T>(a: Set<T>, b: Set<T>) => [...a].filter(x => !b.has(x));
  const before = names(approved),
    after = names(offered);
  const changed = [...after].filter(
    n =>
      before.has(n) &&
      !sameManifest(
        approved!.capabilities.find(c => c.name === n),
        offered.capabilities.find(c => c.name === n),
      ),
  );
  const usesBefore = new Set(approved?.uses ?? []),
    usesAfter = new Set(offered.uses ?? []);
  const from = approved?.delegation?.audience ?? null,
    to = offered.delegation?.audience ?? null;
  const keys = new Set([...Object.keys(approved ?? {}), ...Object.keys(offered)]);
  const fields = [...keys]
    .filter(
      k =>
        !NAMED.has(k) &&
        !sameManifest(
          (approved as Record<string, unknown> | undefined)?.[k],
          (offered as unknown as Record<string, unknown>)[k],
        ),
    )
    .sort();
  return {
    added: minus(after, before),
    removed: minus(before, after),
    changed,
    areasAdded: minus(areas(offered), areas(approved)),
    areasRemoved: minus(areas(approved), areas(offered)),
    usesAdded: minus(usesAfter, usesBefore),
    usesRemoved: minus(usesBefore, usesAfter),
    ...(from !== to ? { delegation: { from, to } } : {}),
    fields,
    same: sameManifest(approved, offered),
  };
}
