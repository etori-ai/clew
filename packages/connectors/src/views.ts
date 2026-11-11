import {
  fieldTone,
  markFields,
  openRef,
  rowsKey,
  viewRows,
  type MenuHint,
  type MenuIcon,
  type View,
  type ViewField,
} from '@clew/contracts';
import {
  ActivitySchema,
  DocumentBundleSchema,
  MetricsSchema,
  SeriesSchema,
  ReviewRecoverySchema,
  checkContract,
} from '@clew/contracts';
import { Value } from 'typebox/value';
import type { AboutPlace } from './protocol';

export { fieldTone, markFields, openRef, rowsKey, viewRows };

/**
 * Declared views (D38), the pure part: the rules a declaration must keep, the rows it points at, what the model is
 * handed instead of the content, and the view a row opens. No I/O. The registry holds bundled connectors to the rules
 * when they register, the manifest loader holds remote ones to them, and the browser draws from the same declaration.
 */
type Schema = { properties?: Record<string, Schema>; items?: Schema; type?: unknown };
/** What the rules need to know about a capability: its name, kind, schemas and view. */
export interface ViewSubject {
  name: string;
  kind: string;
  input: unknown;
  output: unknown;
  view?: View;
  menu?: MenuHint;
  review?: string;
}
const props = (schema: unknown): Record<string, Schema> | undefined => (schema as Schema | undefined)?.properties;
/**
 * Why a list of fields may not be drawn as declared (D97): a field `beside` the one before it needs one before it, and
 * only one field can be the row in one value (`compact`).
 */
function placementProblem(name: string, fields: readonly ViewField[]): string | undefined {
  const first = fields[0];
  if (first?.beside) return `${name}: view field "${first.key}" is beside nothing: the first field cannot be beside`;
  const compact = fields.filter(f => f.compact);
  if (compact.length > 1)
    return `${name}: view fields ${compact.map(f => `"${f.key}"`).join(', ')} are all compact: at most one field is the row in one value`;
  return undefined;
}

/**
 * Why a capability's view may not be used, or undefined when it may. A view belongs to a read; its input controls bind
 * to properties the capability's input declares; a row opens only a read of the same connector (as a card's actions
 * are one system's, D35); and where the output schema declares its properties, every field is one of them.
 */
export function viewProblem(subject: ViewSubject, siblings: ViewSubject[]): string | undefined {
  const view = subject.view;
  if (!view) return undefined;
  if (subject.kind !== 'read') return `${subject.name}: only a read capability can declare a view`;
  if (view.kind === 'document' || view.kind === 'metrics' || view.kind === 'series' || view.kind === 'activity') {
    const key = (view as Extract<View, { body: string }>).body;
    const out = props(subject.output);
    return out && !out[key] ? `${subject.name}: view body "${key}" is not in the output schema` : undefined;
  }
  if (view.kind === 'text') {
    const out = props(subject.output);
    return out && !out[view.body] ? `${subject.name}: view body "${view.body}" is not in the output schema` : undefined;
  }
  const keys = view.fields.map(f => f.key);
  if (new Set(keys).size !== keys.length) return `${subject.name}: a view field is listed twice`;
  const unitless = view.fields.find(f => f.unit && f.format !== 'number');
  if (unitless) return `${subject.name}: view field "${unitless.key}" has a unit but is not a number`;
  const placement = placementProblem(subject.name, view.fields);
  if (placement) return placement;
  let record = props(subject.output);
  if (view.kind === 'table' || view.kind === 'list') {
    if (!keys.includes(view.title)) return `${subject.name}: view title "${view.title}" must be one of its fields`;
    const rows = rowsKey(view)!;
    if (record && !record[rows]) return `${subject.name}: view rows "${rows}" is not in the output schema`;
    record = record?.[rows]?.items?.properties;
    const input = props(subject.input);
    for (const control of [view.input?.query, view.input?.filter])
      if (control && input && !input[control.key])
        return `${subject.name}: view input "${control.key}" is not in the input schema`;
    if (view.input?.query && view.input.filter && view.input.query.key === view.input.filter.key)
      return `${subject.name}: the view's query and filter bind the same input`;
    if (view.open) {
      const target = siblings.find(c => c.name === view.open!.capability);
      if (!target || target.kind !== 'read')
        return `${subject.name}: a row opens ${view.open.capability}, which is not a read of the same connector`;
      const targetInput = props(target.input);
      for (const [param, from] of Object.entries(view.open.params)) {
        if (targetInput && !targetInput[param])
          return `${subject.name}: ${view.open.capability} takes no input "${param}"`;
        if (record && !record[from])
          return `${subject.name}: a row has no "${from}" to open ${view.open.capability} with`;
      }
    }
    if (view.ref && record && !record[view.ref])
      return `${subject.name}: view ref "${view.ref}" is not in the output schema`;
  }
  if (record)
    for (const key of view.kind === 'detail' || view.kind === 'record' ? [view.title, ...keys] : keys)
      if (!record[key]) return `${subject.name}: view field "${key}" is not in the output schema`;
  // The entity a record names (D97 item 6): a string property of the record, holding a person's user name or a unit's id.
  if ((view.kind === 'table' || view.kind === 'list' || view.kind === 'detail') && view.subject && record) {
    const property = record[view.subject.key];
    if (!property) return `${subject.name}: view subject "${view.subject.key}" is not in the output schema`;
    if (property.type !== 'string') return `${subject.name}: view subject "${view.subject.key}" is not a string`;
  }
  if (view.kind === 'record') {
    for (const key of [view.document, view.recovery, view.metrics, view.series, view.activity, view.items?.rows].filter(
      Boolean,
    ) as string[])
      if (record && !record[key]) return `${subject.name}: record section "${key}" is not in the output schema`;
    if (view.items) {
      const items = view.items;
      if (!items.fields.some(f => f.key === items.title))
        return `${subject.name}: item title must name a displayed field`;
      if (new Set(items.fields.map(f => f.key)).size !== items.fields.length)
        return `${subject.name}: item fields must be unique`;
      const itemPlacement = placementProblem(subject.name, items.fields);
      if (itemPlacement) return itemPlacement;
      const item = record?.[items.rows]?.items?.properties;
      for (const field of items.fields) {
        if (item && !item[field.key]) return `${subject.name}: unknown item field "${field.key}"`;
        if (field.unit && field.format !== 'number') return `${subject.name}: item units belong to number fields`;
      }
    }
  }
  return undefined;
}

/** Validate semantic payloads even when the source's own output schema is permissive. */
export function viewOutputProblem(view: View | undefined, output: unknown): string | undefined {
  if (!view) return;
  const data = output as Record<string, unknown> | null;
  const check = (kind: string, value: unknown): boolean => {
    if (kind === 'document') {
      if (!Value.Check(DocumentBundleSchema, value)) return false;
      return new Set(value.documents.map(d => d.id)).size === value.documents.length;
    }
    if (kind === 'metrics')
      return Value.Check(MetricsSchema, value) && new Set(value.map(m => m.id)).size === value.length;
    if (kind === 'activity')
      return Value.Check(ActivitySchema, value) && new Set(value.map(e => e.id)).size === value.length;
    if (kind === 'series')
      return (
        Value.Check(SeriesSchema, value) &&
        new Set(value.series.map(s => s.id)).size === value.series.length &&
        value.series.every(s => s.values.length === value.categories.length) &&
        (value.axis !== 'time' ||
          value.categories.every(
            (c, i) =>
              Number.isFinite(Date.parse(c)) && (i === 0 || Date.parse(c) > Date.parse(value.categories[i - 1]!)),
          ))
      );
    return true;
  };
  if ('body' in view && !check(view.kind, data?.[view.body])) return 'Källans vy kunde inte verifieras.';
  if (view.kind === 'record') {
    if (view.recovery && !checkContract(ReviewRecoverySchema, data?.[view.recovery]))
      return 'Källans rättelser kunde inte verifieras.';
    for (const kind of ['document', 'metrics', 'series', 'activity'] as const)
      if (view[kind] && !check(kind, data?.[view[kind]!])) return 'Källans vy kunde inte verifieras.';
    if (
      view.items &&
      (!Array.isArray(data?.[view.items.rows]) ||
        (data![view.items.rows] as unknown[]).length > 500 ||
        (data![view.items.rows] as unknown[]).some(row => !row || typeof row !== 'object' || Array.isArray(row)))
    )
      return 'Källans rader kunde inte verifieras.';
  }
}

/** The icon of a menu row whose capability names none. */
export const MENU_DEFAULT_ICON: MenuIcon = 'document';
const needsInput = (subject: Pick<ViewSubject, 'input'>) =>
  ((subject.input as { required?: unknown[] } | undefined)?.required ?? []).length > 0;
/**
 * Whether a capability's view can be a tool in the menu (D40): a row is one click and no question, so it is a read
 * that declares a view and whose input lists nothing as required.
 */
export const menuEligible = (subject: Pick<ViewSubject, 'kind' | 'input' | 'view'>) =>
  subject.kind === 'read' && !!subject.view && !needsInput(subject);
/** Why a capability may not say how its menu row looks, or undefined when it may: only a view that can be a tool has a row. */
export function menuProblem(subject: ViewSubject): string | undefined {
  if (!subject.menu || menuEligible(subject)) return undefined;
  if (subject.kind !== 'read') return `${subject.name}: only a read capability can be a tool in the menu`;
  if (!subject.view) return `${subject.name}: a menu row opens a view, and the capability declares none`;
  return `${subject.name}: a menu row opens without a question, and the capability needs input`;
}
/** The row a capability's view is in the menu: what the connector says, else the capability's title and a plain icon. Undefined when it cannot be a tool. */
export const menuRowOf = (
  subject: Pick<ViewSubject, 'kind' | 'input' | 'view' | 'menu'> & { title: string },
): MenuHint | undefined =>
  menuEligible(subject)
    ? { label: subject.menu?.label ?? subject.title, icon: subject.menu?.icon ?? MENU_DEFAULT_ICON }
    : undefined;

/**
 * What the model reads in place of the output when the view says `modelReads: 'summary'`: that the result is on the
 * person's screen and how much of it there is, never what it holds.
 */
export function viewSummary(
  view: View,
  title: string,
  output: unknown,
): { shown: true; view: string; rows?: number; note: string } {
  const rows = viewRows(view, output);
  return {
    shown: true,
    view: title,
    ...(rows ? { rows: rows.length } : {}),
    note: 'Resultatet visas för personen i vyn. Innehållet lämnas inte till dig: säg att uppgifterna finns i vyn och återge dem inte.',
  };
}
export const readsSummary = (view: View | undefined) => view?.modelReads === 'summary';

/**
 * Where Clew would show a capability that is about an entity (D97 item 2), from the declaration alone and in the order
 * a preview lists them: an action in the entity's menu; a read as a section on the opened entity, a lens when its view
 * is a table or list, and a mark on the row when a field gives some value a `warn` or `alert` tone. Lenses, columns and
 * marks still wait for an administrator's choice; nothing here is a place by itself.
 */
export function placesOf(subject: Pick<ViewSubject, 'kind' | 'view'> & { about?: unknown }): AboutPlace[] {
  if (!subject.about) return [];
  if (subject.kind !== 'read') return ['menu'];
  const view = subject.view;
  return [
    ...(view?.kind === 'table' || view?.kind === 'list' ? (['lens'] as const) : []),
    ...(markFields(view).length ? (['mark'] as const) : []),
    'section',
  ];
}
