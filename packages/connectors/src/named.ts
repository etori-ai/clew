import {
  STRICT_RELATIONS,
  STRICT_UNIT_RELATIONS,
  type EntityKind,
  type PersonRelation,
  type Relation,
  type UnitRelation,
} from '@clew/contracts';

/**
 * Which inputs of a capability name a person or a unit (D117), drawn from the declarations alone: the loader holds every
 * such input to a plain string property, and the registry resolves every key in one before the connector is called. Pure
 * and shared by both, so what is checked at load time is exactly what is resolved at call time.
 */
export interface NamedInputs {
  entity: EntityKind;
  /** A read about the entity, asked with `{ keys }`. */
  keys: boolean;
  /** The input properties that each take one key. */
  params: string[];
  admits: readonly Relation[];
  /** Whether the capability declared `person.admits` or `unit.admits`; without it the strict default stands. */
  declared: boolean;
  /**
   * A core capability of Clew's own domains that also takes a person without a user name by Clew's own id (D117), as
   * the talks domain does. Never on a remote manifest: Clew's id is never sent to a connector.
   */
  ids: boolean;
}
/** What the naming reads of a capability, whether a manifest's or an in-process one's. */
export interface NamingCapability {
  name: string;
  kind: string;
  input?: unknown;
  view?: unknown;
  about?: { entity: string; param?: string };
  person?: { param?: string; admits?: readonly string[]; ids?: boolean };
  unit?: { admits?: readonly string[] };
  effect?: string;
}
type Open = { capability?: unknown; params?: Record<string, unknown> };
const openOf = (c: NamingCapability): Open | undefined => {
  const view = c.view as { kind?: unknown; open?: Open } | undefined;
  return c.kind === 'read' && (view?.kind === 'table' || view?.kind === 'list') ? view.open : undefined;
};
const both = <T>(a: readonly T[], b: readonly T[]) => a.filter(x => b.includes(x));

/**
 * Every capability of a connector whose input names a person or a unit, and what each admits (D117). A read about an
 * entity names one in `keys`; an action about one in `about.param`; any other capability names a person in
 * `person.param`. Three more name a person whether or not they declare it, so a forgotten declaration fails closed:
 * the `person` of a `<id>.commitments` read, whose shape the protocol fixes (D96 item 8); a property a row of a read
 * about a person fills from the row's `key` when it opens another read of the connector (the section's way in); and an
 * execute's effect read, which takes the execute's input (D112) and admits what the execute admits. Without `admits` a
 * capability about a person admits `self` and `managed`, one about a unit `manages`.
 */
export function namedInputs(connector: { id: string; capabilities: readonly NamingCapability[] }) {
  const out = new Map<string, NamedInputs>();
  const names = new Set(connector.capabilities.map(c => c.name));
  const params = new Map<string, Set<string>>();
  const add = (name: string, param: string) => params.set(name, (params.get(name) ?? new Set()).add(param));
  for (const c of connector.capabilities) {
    if (c.about?.entity === 'person') {
      if (c.about.param) add(c.name, c.about.param);
      const open = openOf(c);
      if (typeof open?.capability === 'string' && names.has(open.capability))
        for (const [param, from] of Object.entries(open.params ?? {})) if (from === 'key') add(open.capability, param);
    }
    if (c.about?.entity !== 'unit' && c.person?.param) add(c.name, c.person.param);
    if (c.kind === 'read' && c.name === connector.id + '.commitments') add(c.name, 'person');
  }
  for (const c of connector.capabilities) {
    if (c.about?.entity === 'unit') {
      if (c.kind === 'read' || c.about.param)
        out.set(c.name, {
          entity: 'unit',
          keys: c.kind === 'read',
          params: c.kind === 'read' || !c.about.param ? [] : [c.about.param],
          admits: (c.unit?.admits as UnitRelation[] | undefined) ?? STRICT_UNIT_RELATIONS,
          declared: !!c.unit?.admits,
          ids: false,
        });
      continue;
    }
    const keys = c.about?.entity === 'person' && c.kind === 'read';
    const named = [...(params.get(c.name) ?? [])];
    if (!keys && !named.length) continue;
    out.set(c.name, {
      entity: 'person',
      keys,
      params: named,
      admits: (c.person?.admits as PersonRelation[] | undefined) ?? STRICT_RELATIONS,
      declared: !!c.person?.admits,
      ids: !!c.person?.ids,
    });
  }
  // An effect read takes its execute's input (D112): it names what the execute names and admits no more than it does.
  for (const c of connector.capabilities) {
    const execute = c.kind === 'execute' && c.effect ? out.get(c.name) : undefined;
    if (!execute || !c.effect || !names.has(c.effect)) continue;
    const own = out.get(c.effect);
    if (own && own.entity !== execute.entity) continue;
    out.set(c.effect, {
      entity: execute.entity,
      keys: own?.keys ?? false,
      params: [...new Set([...(own?.params ?? []), ...execute.params])],
      admits: own?.declared ? both(own.admits, execute.admits) : execute.admits,
      declared: execute.declared || !!own?.declared,
      ids: !!own?.ids && execute.ids,
    });
  }
  return out;
}

type Schema = Record<string, unknown>;
const COMBINATORS = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'patternProperties'];
/**
 * Whether `param` is a plain string property of an input schema (D117): the input is an object that lists it under
 * `properties` with `type: "string"`, and nothing in the schema (a combinator, pattern properties) can give it another
 * shape. An input that names a person is checked against exactly this at load time.
 */
export function plainStringProperty(input: unknown, param: string): boolean {
  const schema = input && typeof input === 'object' ? (input as Schema) : undefined;
  if (!schema || schema.type !== 'object' || COMBINATORS.some(k => k in schema)) return false;
  const property = (schema.properties as Record<string, Schema> | undefined)?.[param];
  return (
    !!property && typeof property === 'object' && property.type === 'string' && !COMBINATORS.some(k => k in property)
  );
}
