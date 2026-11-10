import type { EntityAction, EntityKind, EntitySource, View } from '@clew/contracts';
import { ApiError } from '../api-error';

/**
 * The manifest preview (D60, D97 slice 9), the pure part: what `POST /api/protocol/manifest` answers, as this page reads
 * it, and the words the page says it in. No React. The answer is computed on the server by `previewManifest`
 * (`packages/connectors/src/preview.ts`, schema `ManifestPreviewSchema`); the web app does not depend on the connector
 * package, so the fields the page reads are restated here, and a change there is a change here.
 */
export type PreviewPlace = 'lens' | 'mark' | 'section' | 'menu';
export interface PreviewCapability {
  name: string;
  kind: 'read' | 'propose' | 'execute';
  title: string;
  roles: Array<'manager' | 'employee'>;
  tool: boolean;
  needsInput: boolean;
  view: string | null;
  menu: { label: string; icon: string } | null;
  check: string;
  about?: { entity: EntityKind; param?: string };
  places: PreviewPlace[];
  openedFrom: string[];
  audience: Array<{ places: Array<PreviewPlace | 'tool'>; who: string }>;
  samples?: Array<Record<string, unknown>>;
}
export interface PreviewIssue {
  problem: string;
  path: string;
  field: string;
  anchor: string;
  rule?: { id: string; title: string };
}
export interface ManifestPreview {
  ok: boolean;
  protocol: { current: number; accepted: number[] };
  problems: string[];
  issues: PreviewIssue[];
  manifest?: {
    id: string;
    source: string;
    capabilities: PreviewCapability[];
  };
}

/** The most the page sends, as the route takes it. */
export const MANIFEST_MAX = 500_000;
/** The document as the person gave it: parsed here, so a document that is not JSON is said with the parser's own words. */
export type Parsed = { ok: true; document: unknown } | { ok: false; message: string };
export function parseDocument(text: string): Parsed {
  try {
    return { ok: true, document: JSON.parse(text) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The parser gave no reason.' };
  }
}

/** The dry run (D60): public, without a session or a token, so the plain fetch. Nothing is stored. */
export async function postManifest(text: string): Promise<ManifestPreview> {
  const response = await fetch('/api/protocol/manifest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: text,
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status, 'The dry run answered with something that is not JSON.');
  }
  if (!response.ok)
    throw new ApiError(response.status, (data as { error?: string }).error ?? 'The dry run could not be run.');
  return data as ManifestPreview;
}

/** "1 problem, the manifest would be refused" (artboard J): the summary the page moves focus to. */
export const problemsSummary = (count: number) =>
  `${count === 1 ? '1 problem' : `${count} problems`}, the manifest would be refused`;

/** A capability's view and declaration from the document, by name, once the server has said the document loads. */
type Declared = { name?: string; view?: View };
export function declarationOf(document: unknown, name: string): Declared | undefined {
  const capabilities = (document as { capabilities?: Declared[] } | null)?.capabilities;
  return Array.isArray(capabilities) ? capabilities.find(c => c?.name === name) : undefined;
}

const PLACE_WORDS: Record<PreviewPlace | 'tool', string> = {
  lens: 'lens',
  mark: 'row mark',
  section: 'section',
  menu: 'menu',
  tool: 'model tool',
};
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "Lens and row mark", "Section", "Model tool": the label of one line under "Who would see it". */
export const placesLabel = (places: Array<PreviewPlace | 'tool'>) =>
  capitalised(
    places.length < 2
      ? PLACE_WORDS[places[0]!]
      : `${places
          .slice(0, -1)
          .map(p => PLACE_WORDS[p])
          .join(', ')} and ${PLACE_WORDS[places.at(-1)!]}`,
  );

/** What a capability is about, for the table (artboard J): its entity, else what opens it, else nothing. */
export function aboutText(c: PreviewCapability, all: PreviewCapability[]): string {
  if (c.about) return c.about.entity;
  if (c.openedFrom.length) {
    const fromSection = c.openedFrom.filter(name => all.find(o => o.name === name)?.about);
    return fromSection.length
      ? `opened from the section of ${fromSection.join(', ')}`
      : `opened from a row of ${c.openedFrom.join(', ')}`;
  }
  return 'nothing';
}

/** Where a capability shows, for the table (artboard J): its places, else where it is opened, else what an administrator may make of it. */
export function placesText(c: PreviewCapability, all: PreviewCapability[]): string {
  if (c.about)
    return c.kind === 'read'
      ? capitalised(c.places.map(p => PLACE_WORDS[p]).join(', '))
      : 'Menu, after a human decision';
  if (c.openedFrom.length) {
    const entity = c.openedFrom.map(name => all.find(o => o.name === name)?.about?.entity).find(Boolean);
    return entity
      ? `Under the section, and in full on the ${entity}'s page`
      : 'Panel view, beside the list it is opened from';
  }
  const offered = [
    c.menu ? 'Menu row, once an administrator adds it' : '',
    c.tool ? 'Model tool, once an administrator enables tools' : '',
    c.kind === 'execute' ? 'Runs after a human decision' : '',
  ].filter(Boolean);
  return offered.length ? offered.join('; ') : 'No place of its own';
}

/** The connector's source as Clew holds it, for a read about an entity: what the product's section draws from. */
export const sourceOf = (
  manifest: NonNullable<ManifestPreview['manifest']>,
  c: PreviewCapability,
  view: View,
): EntitySource => ({ capability: c.name, connector: manifest.id, source: manifest.source, title: c.title, view });

/** The actions about one kind, as the product's menu takes them (`entity-actions.ts`). */
export function actionsAbout(manifest: NonNullable<ManifestPreview['manifest']>, entity: EntityKind): EntityAction[] {
  return manifest.capabilities.flatMap(c =>
    c.about?.entity === entity && c.kind !== 'read' && c.about.param
      ? [
          {
            capability: c.name,
            connector: manifest.id,
            source: manifest.source,
            title: c.title,
            kind: c.kind,
            param: c.about.param,
          },
        ]
      : [],
  );
}

/** A name for the sample entity that cannot be taken for a real one. */
export const SAMPLE_NAMES: Record<EntityKind, string> = { person: 'Exempel Person', unit: 'Exempelenheten' };
