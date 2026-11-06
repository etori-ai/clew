import { menuRowOf } from './views';
import { manifestProblems } from './remote';
import { PROTOCOL_ACCEPTED, PROTOCOL_VERSION, type ConnectorManifest, type ManifestPreview } from './protocol';

/**
 * A dry run of a manifest document (D60): the pure part of `POST /api/protocol/manifest`. The same rules the loader
 * applies, with every problem listed rather than the first thrown, and, when the document passes, what Clew would make
 * of it: who may call what, what the model is offered, what could be a row in the menu, and what the conformance check
 * would and would not exercise. No I/O; an integrator gets this before any service exists.
 */
export interface PreviewOptions {
  /** The id the connector will be registered with, when known. */
  id?: string;
  /** Validates `{}` against an input schema with a real validator. Absent, a schema that lists `required` properties is taken to need input. */
  acceptsEmptyInput?: (schema: object) => boolean;
}
const listsNothingRequired = (schema: object) => !((schema as { required?: unknown }).required as unknown[] | undefined)?.length;
const BOTH: Array<'manager' | 'employee'> = ['manager', 'employee'];

export function previewManifest(document: unknown, options: PreviewOptions = {}): ManifestPreview {
  const protocol = { current: PROTOCOL_VERSION, accepted: [...PROTOCOL_ACCEPTED] };
  const problems = manifestProblems(document, options.id);
  if (problems.length) return { ok: false, protocol, problems };
  const manifest = document as ConnectorManifest;
  const accepts = options.acceptsEmptyInput ?? listsNothingRequired;
  const capabilities = manifest.capabilities.map(c => {
    const roles = c.scope.roles ?? BOTH;
    const needsInput = !accepts(c.input as object);
    const check = c.kind === 'execute' ? 'Not called: an execute runs only after a human decision.'
      : needsInput ? 'Not called: it needs input. Test it against your own fixture.'
      : `Called with {} as ${roles.join(' and ')}${roles.length < 2 ? `; the other role must be refused by scope` : ''}${c.view ? `; the ${c.view.kind} view is checked against the answer` : ''}.`;
    return {
      name: c.name, kind: c.kind, title: c.title, roles, tool: c.model && c.kind !== 'execute', needsInput,
      view: c.view?.kind ?? null, menu: menuRowOf(c) ?? null, check,
      ...(c.follows ? { follows: c.follows } : {}), ...(c.creates ? { creates: c.creates } : {}),
    };
  });
  return {
    ok: true, protocol, problems: [],
    manifest: {
      id: manifest.id, source: manifest.source, kind: manifest.kind, scan: manifest.scan,
      delegation: manifest.delegation?.audience ?? null, uses: manifest.uses ?? [], facts: (manifest.facts ?? []).map(f => f.kind),
      capabilities,
      areas: manifest.areas.map(a => ({ id: a.id, title: a.title, roles: a.roles, standing: a.standing, figure: !!a.figure, icon: a.icon ?? null })),
      menu: capabilities.flatMap(c => c.menu ? [{ capability: c.name, label: c.menu.label, icon: c.menu.icon }] : []),
    },
  };
}
