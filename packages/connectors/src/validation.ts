import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { menuProblem, viewProblem, type ViewSubject } from './views';

/** Rules shared by manifest preview, remote loading and in-process registration. No installation state. */
interface Descriptor {
  id: string;
  capabilities: Array<ViewSubject & { model: boolean; follows?: string[]; creates?: string }>;
  facts?: Array<{ kind: string; attributes: object }>;
  areas: Array<{ id: string; standing: string[] }>;
  documents?: unknown;
  /** The manifest names the capability in an object; a Connector carries its name. */
  header?: string | { capability: string };
}
function schemaCompiler() {
  const ajv = addFormats(new Ajv({ strict: false, addUsedSchema: false }));
  return (schema: object) => ajv.compile(schema);
}
export function connectorProblems(
  connector: Descriptor,
  compile: (schema: object) => unknown = schemaCompiler(),
): string[] {
  const problems: string[] = [],
    names = new Set<string>(),
    facts = new Set<string>(),
    areas = new Set<string>();
  const schemaProblem = (label: string, schema: object) => {
    try {
      compile(schema);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : 'Invalid JSON Schema.'}`);
    }
  };
  for (const c of connector.capabilities) {
    if (!c.name.startsWith(connector.id + '.'))
      problems.push(`Capability ${c.name} must be prefixed with ${connector.id}.`);
    if (names.has(c.name)) problems.push(`Capability ${c.name} is already registered.`);
    names.add(c.name);
    if (c.kind === 'execute' && c.model)
      problems.push(`Capability ${c.name}: execute capabilities are never tools (D8).`);
    const view = viewProblem(c, connector.capabilities);
    if (view) problems.push(`Capability ${view} (D38).`);
    const menu = menuProblem(c);
    if (menu) problems.push(`Capability ${menu} (D40).`);
    if ((c.view?.kind === 'document' || (c.view?.kind === 'record' && c.view.document)) && !connector.documents)
      problems.push(`Capability ${c.name}: document views require the connector's documents transport.`);
    if (c.review) {
      const read = connector.capabilities.find(r => r.name === c.review);
      if (
        c.kind !== 'execute' ||
        !read ||
        read.kind !== 'read' ||
        !(read.view?.kind === 'document' || (read.view?.kind === 'record' && read.view.document))
      )
        problems.push(`Capability ${c.name}: review must name a document read of the same connector.`);
    }
    if (c.follows && c.kind !== 'propose')
      problems.push(`Capability ${c.name}: only a propose can follow a fact (D55).`);
    if (c.creates && !connector.facts?.some(f => f.kind === c.creates))
      problems.push(`Capability ${c.name} creates ${c.creates}, which ${connector.id} does not declare (D55).`);
    schemaProblem(`Capability ${c.name} input`, c.input as object);
    schemaProblem(`Capability ${c.name} output`, c.output as object);
  }
  for (const f of connector.facts ?? []) {
    if (!f.kind.startsWith(connector.id + ':'))
      problems.push(`Fact ${f.kind} must be prefixed with ${connector.id}: (D55).`);
    if (facts.has(f.kind)) problems.push(`Fact ${f.kind} is declared twice.`);
    facts.add(f.kind);
    schemaProblem(`Fact ${f.kind} attributes`, f.attributes);
  }
  for (const a of connector.areas) {
    if (areas.has(a.id)) problems.push(`Area ${a.id} is declared twice.`);
    areas.add(a.id);
    for (const s of a.standing)
      if (!names.has(s)) problems.push(`Area ${a.id} lists unknown standing capability ${s}.`);
  }
  // The shared header (D88): the capability it names must be one of the connector's reads that opens without a question.
  if (connector.header) {
    const name = typeof connector.header === 'string' ? connector.header : connector.header.capability;
    const c = connector.capabilities.find(x => x.name === name);
    if (!c) problems.push(`Header names unknown capability ${name} (D88).`);
    else if (c.kind !== 'read') problems.push(`Header capability ${c.name} must be a read (D88).`);
    else if (menuProblem({ ...c, menu: { label: 'x', icon: 'link' }, view: c.view ?? { kind: 'text', body: 'x' } }))
      problems.push(`Header capability ${c.name} must take no input (D88).`);
  }
  return problems;
}
