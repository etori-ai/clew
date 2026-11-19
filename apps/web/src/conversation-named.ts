import { answersWithRows, type MenuIcon, type MessageMeta, type ViewEntry } from '@clew/contracts';
import { withCard, withView } from './panel-address';
import { ASSISTANT_PARAM, assistantHref } from './conversation-about';
import { NOTHING_SHOWN, viewKey, withShown, type Shown, type ShownView } from './conversation-shown';

/** One thing a conversation has named that can stand beside its transcript. */
export interface NamedThing {
  /** Stable among the rows: the kind and what names the thing. */
  key: string;
  label: string;
  /** The row's second line: what kind of thing it is and whose. */
  detail: string;
  /** The same conversation with this thing beside it. */
  href: string;
  /** Whether it is the thing beside the transcript now. */
  current: boolean;
  icon?: MenuIcon;
}
export interface NamedSection {
  id: 'items' | 'views' | 'assistants';
  /** The section's word with how many it holds: "Ärenden · 2". */
  title: string;
  things: NamedThing[];
}
/** A work item as the menu needs it: the stream's own thread and its mark, resolved by the caller. */
export interface NamedItem {
  title: string;
  /** A calendar proposal is said as one ("Förslag"), every other item as "Ärende". */
  proposal: boolean;
  source: string;
  icon?: MenuIcon;
}

const sameInput = (a: Record<string, unknown> | undefined, b: string | null) =>
  (a && Object.keys(a).length ? JSON.stringify(a) : null) === (b && b !== '{}' ? b : null);

/**
 * Everything a conversation has named that can stand beside its transcript, in the order it was first named: the work
 * items its answers are about (`MessageMeta.cards`, and `viewItems`: the ones an answer names among the rows of a list
 * it draws), the views whose declared kind is one thing (a record, a document, a
 * detail; one that answers with rows, declares no kind or has a page of its own is a page, D116, and is not here), and the other systems'
 * assistants that answered or were asked (D128). With them, the work items and views the person has put beside the
 * transcript themselves (`before`: from a row the answer did not name, or from an answer written before answers kept
 * `viewItems`), the thing
 * the address names among them. Each row leads to the same conversation with
 * that thing beside it, in the place of what stands there: one panel holds one thing.
 */
export function namedInConversation(
  messages: readonly { meta?: MessageMeta | null | undefined }[],
  at: { pathname: string; search: string },
  known: {
    /** The work item by its id, undefined for one the person cannot be shown by name. */
    item: (threadId: string) => NamedItem | undefined;
    views: readonly ViewEntry[] | undefined;
    /** The system's word for a view the person opened, by its capability; none when the system is not one they see. */
    source?: (capability: string) => string;
  },
  /** What the person has put beside this conversation before (`conversation-shown.ts`). */
  before: Shown = NOTHING_SHOWN,
): NamedSection[] {
  const q = new URLSearchParams(at.search);
  const aside = q.get(ASSISTANT_PARAM);
  const card = aside ? null : q.get('card');
  const open = aside || card ? null : q.get('open');
  // What a row leads to stands alone beside the transcript: nothing of what stood there stays in the address.
  const bare = () => {
    const rest = new URLSearchParams(at.search);
    for (const k of [ASSISTANT_PARAM, 'card', 'open', 'open-title', 'open-input']) rest.delete(k);
    return rest;
  };

  // The thing the address names is one of them, whether or not a message names it.
  const shown = withShown(before, at.search);
  const itemIds = [
    ...new Set([...messages.flatMap(m => [...(m.meta?.cards ?? []), ...(m.meta?.viewItems ?? [])]), ...shown.items]),
  ];
  const items = itemIds.flatMap((id): NamedThing[] => {
    const item = known.item(id);
    if (!item) return [];
    return [
      {
        key: 'item:' + id,
        label: item.title,
        detail: [item.proposal ? 'Förslag' : 'Ärende', item.source].filter(Boolean).join(' · '),
        href: withCard(at.pathname, bare(), id),
        current: card === id,
        ...(item.icon ? { icon: item.icon } : {}),
      },
    ];
  });

  const refs = new Map<string, ShownView & { source?: string }>();
  // Only a read whose kind says it is one thing: one of no declared kind may answer with rows, which is a page (D116).
  const besideView = (capability: string, input?: Record<string, unknown>) => {
    const entry = known.views?.find(v => v.capability === capability);
    if (!entry?.kind || answersWithRows(entry.kind)) return false;
    return !(entry.page && !(input && Object.keys(input).length));
  };
  for (const m of messages) {
    const v = m.meta?.view;
    if (v && besideView(v.capability, v.input) && !refs.has(viewKey(v))) refs.set(viewKey(v), v);
  }
  // A view the person opened has stood beside the transcript, whatever its kind says.
  for (const v of shown.views) if (!refs.has(viewKey(v))) refs.set(viewKey(v), v);
  const views = [...refs].map(([key, v]): NamedThing => ({
    key: 'view:' + key,
    label: v.title,
    detail: ['Vy', v.source ?? known.source?.(v.capability)].filter(Boolean).join(' · '),
    href: withView(at.pathname, bare(), v),
    current: open === v.capability && sameInput(v.input, q.get('open-input')),
  }));

  const asked = new Map<string, { name: string; source: string }>();
  for (const m of messages)
    for (const a of [m.meta?.handed, m.meta?.handover]) if (a && !asked.has(a.assistant)) asked.set(a.assistant, a);
  const assistants = [...asked].map(([id, a]): NamedThing => ({
    key: 'assistant:' + id,
    label: a.name,
    detail: ['Assistent', a.source].filter(Boolean).join(' · '),
    // An assistant's exchange stands in the place of the thing the conversation is about, which stays in the address.
    href: assistantHref(at.pathname, at.search, id),
    current: aside === id,
  }));

  const section = (id: NamedSection['id'], word: string, things: NamedThing[]): NamedSection[] =>
    things.length ? [{ id, title: `${word} · ${things.length}`, things }] : [];
  return [
    ...section('items', 'Ärenden', items),
    ...section('views', 'Vyer', views),
    ...section('assistants', 'Assistenter', assistants),
  ];
}

/** Whether the menu has anywhere to lead: something named that is not what stands beside the transcript now. */
export const leadsElsewhere = (sections: readonly NamedSection[]): boolean =>
  sections.some(s => s.things.some(t => !t.current));
