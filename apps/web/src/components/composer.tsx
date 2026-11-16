import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClewObject } from '@clew/contracts';
import {
  AreaChip,
  AreaGlyph,
  Button,
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  HStack,
  Text,
  TextInput,
  Token,
  TypeaheadItem,
  VisuallyHidden,
  useChatDictation,
  useEntryAnimation,
  useToast,
  type ChatComposerTrigger,
  type SearchableItem,
} from '@clew/ui';
import { api } from '../api';
import { assistantQuery, handoverAssistantsQuery, threadsQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import {
  tokenValue,
  useClaimBox,
  useConversation,
  type AskFrom,
  type ChipRef,
  type Handed,
} from './conversation-context';
import { useMarks, useObjectMark } from '../marks';

/**
 * The model choice (D24), in the composer's footer slot that Astryx keeps for a model selector: the person's models
 * with what each is good for. It is there whenever one of Clew's models answers, also when there is only one, so the
 * box always says which model the next question goes to (D36); without a model the router answers and there is nothing
 * to choose. Choosing saves their own preference on the server, which resolves the model on every question; the toast
 * says which one the next question uses. While the box talks to another system's assistant it is not drawn: no model
 * of Clew's answers then.
 */
function ModelMenu({ isDisabled }: { isDisabled: boolean }) {
  const status = useQuery(assistantQuery).data;
  const client = useQueryClient();
  const toast = useToast();
  const choose = useMutation({
    mutationFn: (modelId: string) => api.chooseModel(modelId),
    onSuccess: next => {
      client.setQueryData(keys.assistant, next);
      toast({
        body: `Nästa fråga besvaras av ${next.current?.title ?? 'den inbyggda routern'}.`,
        uniqueID: 'model-choice',
      });
    },
    onError: e =>
      toast({ body: errorMessage(e, 'Modellen kunde inte väljas.'), isAutoHide: false, uniqueID: 'model-choice' }),
  });
  if (!status?.current) return null;
  const current = status.current;
  return (
    <DropdownMenu
      button={{
        label: `Modell: ${current.title}`,
        children: current.title,
        variant: 'ghost',
        size: 'sm',
        isDisabled: isDisabled || choose.isPending,
      }}
      menuWidth={280}
    >
      <DropdownMenuRadioGroup
        label="Modell"
        value={current.id}
        onChange={id => {
          if (id !== current.id) choose.mutate(id);
        }}
      >
        {status.choices.map(c => (
          <DropdownMenuRadioItem
            key={c.id}
            value={c.id}
            label={c.isDefault ? `${c.title} (standard)` : c.title}
            description={c.description || undefined}
          />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
}

/** The value that stands for Clew's own assistant in the recipient menu. */
const CLEW = 'clew';
/** With more assistants than this the menu gets a field to narrow them by. */
const FILTER_FROM = 7;
/** The most assistants listed under "Senast". */
const RECENT_MAX = 2;
/**
 * Whom the box talks to (D125 item 5), above the field where the person sees it before they write: a button that names
 * the recipient ("Till: Clew", "Till: HR-assistenten") and opens the list. Astryx's DropdownMenu, since the list can be
 * long: Clew first, always; the assistants of the conversations the person had last ("Senast"); then every assistant
 * they may ask, grouped under the system it lives in, each with what it is for. With many, a field in the menu's header
 * narrows them by name or description. What is selected gets the next message and every one after it, until the person
 * selects another; "Tillbaka till Clew" beside the button is the one-press way back. A conversation is handed to one
 * assistant, so once it is, the list is Clew and that assistant. Nothing is drawn when the person has no assistant to
 * ask: the box is Clew's as before.
 */
function Recipient({ isDisabled, menu }: { isDisabled: boolean; menu?: RecipientMenu | undefined }) {
  const talk = useConversation();
  const listed = useQuery(handoverAssistantsQuery).data ?? [];
  const threads = useQuery(threadsQuery).data?.threads;
  const [filter, setFilter] = useState('');
  const marks = useMarks();
  const kept = talk.conversation?.handover;
  const handed = talk.handed;
  const all: (Handed & { description?: string })[] = kept
    ? [{ id: kept.assistant, name: kept.name, source: kept.source }]
    : listed.map(a => ({
        id: a.id,
        name: a.name,
        source: a.source,
        ...(a.description ? { description: a.description } : {}),
      }));
  // The assistants of the person's latest handed-over conversations, newest first, among those they may still ask.
  const recent = useMemo(() => {
    if (kept || all.length <= RECENT_MAX) return [];
    const ids = [...(threads ?? [])]
      .filter(t => t.handover)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(t => t.handover!.assistant);
    return [...new Set(ids)]
      .map(id => all.find(a => a.id === id))
      .filter((a): a is (typeof all)[number] => !!a)
      .slice(0, RECENT_MAX);
  }, [threads, kept, all.map(a => a.id).join(' ')]);
  if (all.length === 0) return null;
  const needle = filter.trim().toLocaleLowerCase('sv-SE');
  const matches = (a: (typeof all)[number]) =>
    !needle || `${a.name} ${a.description ?? ''} ${a.source}`.toLocaleLowerCase('sv-SE').includes(needle);
  const shown = all.filter(matches);
  const sources = [...new Set(shown.map(a => a.source))];
  const pick = (id: string) => {
    setFilter('');
    if (id === CLEW) {
      if (handed) talk.leaveHandover();
      return;
    }
    const picked = all.find(a => a.id === id);
    if (picked && picked.id !== handed?.id) talk.handTo(picked);
  };
  const row = (a: (typeof all)[number]) => (
    <DropdownMenuRadioItem key={a.id} value={a.id} label={a.name} description={a.description} />
  );
  const to = handed ? handed.name : 'Clew';
  // The board's `Recipient` (D126, boards Samtal and SamtalEneo): the button that names whom the box talks to, and
  // beside it, while that is another system's assistant, the one-press way back and that system's mark (D125 item 13).
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      <DropdownMenu
        button={{
          label: `Till: ${to}`,
          children: `Till: ${to}`,
          variant: 'secondary',
          size: 'sm',
          isDisabled,
        }}
        menuWidth={340}
        menuMaxHeight={460}
        {...(menu ? { isMenuOpen: menu.isOpen } : {})}
        onOpenChange={open => {
          menu?.onOpenChange(open);
          if (!open) setFilter('');
        }}
        {...(all.length >= FILTER_FROM
          ? {
              header: (
                <TextInput
                  label="Sök assistent"
                  isLabelHidden
                  size="sm"
                  placeholder={`Sök bland ${all.length} assistenter …`}
                  value={filter}
                  onChange={setFilter}
                />
              ),
            }
          : {})}
      >
        {(!needle || 'clew'.includes(needle)) && (
          <DropdownMenuRadioGroup label="Clew" value={handed ? undefined : CLEW} onChange={pick}>
            <DropdownMenuRadioItem value={CLEW} label="Clew" description="Dina ärenden, din kalender och dina system" />
          </DropdownMenuRadioGroup>
        )}
        {!needle && recent.length > 0 && (
          <DropdownMenuGroup title="Senast">
            <DropdownMenuRadioGroup label="Senast" value={handed?.id} onChange={pick}>
              {recent.map(row)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        )}
        {sources.map(source => (
          <DropdownMenuGroup key={source} title={source}>
            <DropdownMenuRadioGroup label={`Assistenter i ${source}`} value={handed?.id} onChange={pick}>
              {shown.filter(a => a.source === source).map(row)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ))}
        {needle && shown.length === 0 && !'clew'.includes(needle) && (
          <DropdownMenuItem label="Ingen assistent matchar" isDisabled />
        )}
      </DropdownMenu>
      {handed && <Button size="sm" variant="ghost" label="Tillbaka till Clew" onClick={() => talk.leaveHandover()} />}
      {handed && (
        <AreaChip
          ordinal={marks.system(handed.id.slice(0, handed.id.indexOf(':')))?.ordinal ?? null}
          label={handed.source}
        />
      )}
    </HStack>
  );
}

/**
 * What goes into the box enters, it does not pop (D92). Pressing "Lägg till i samtalet" changes four things in one frame,
 * a card's button far from the box among them, so the drawer slides open, the chip scales in and the verbs fade in, each
 * on Astryx's own entry motion: its tokens, nothing when the element was on the page from the first paint, and still
 * under reduced motion. Nothing waits for it; the field has the focus from the same click.
 */
function Drawer(props: ComponentProps<typeof ChatComposerDrawer>) {
  const entry = useEntryAnimation('slideDown');
  return <ChatComposerDrawer {...props} xstyle={entry ?? undefined} />;
}
function Chip(props: ComponentProps<typeof Token>) {
  const entry = useEntryAnimation('scaleIn');
  return <Token {...props} xstyle={entry ?? undefined} />;
}
function Verb(props: ComponentProps<typeof Button>) {
  const entry = useEntryAnimation('fadeIn');
  return <Button {...props} xstyle={entry ?? undefined} />;
}
/** A screen reader hears what the eye sees enter: the chip's name, once, when it is added. Removing is the chip's own button. */
function useAddedAnnouncement(chips: { ref: string; label: string }[]) {
  const seen = useRef<Set<string> | null>(null);
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    const refs = new Set(chips.map(c => c.ref));
    const before = seen.current;
    seen.current = refs;
    if (!before) return;
    const added = chips.filter(c => !before.has(c.ref));
    if (added.length > 0) setAnnounced(`${added[added.length - 1]!.label} är med i samtalet`);
  }, [chips]);
  return announced;
}

/** Microphone inside the composer; the browser's speech recognition writes into the same input. */
function Dictation({ onResult }: { onResult: (text: string) => void }) {
  const dictation = useChatDictation({ lang: 'sv-SE', onResult });
  return <ChatDictationButton dictation={dictation} />;
}
/**
 * Where the box sits (D126 rule 5: the assistant has two homes): `landing` is the box on Hem, under the greeting, which
 * starts a conversation; `conversation` is the box docked under a conversation's transcript, which continues it. No
 * other page has a box.
 */
export type ComposerPlace = 'landing' | 'conversation';
/**
 * The "Till:" menu held open from outside the box: Ny fråga's "Visa alla" under its list of other systems' assistants
 * opens the same menu the box's own button does (D126 item 14), so there is one place to choose from them all.
 */
export interface RecipientMenu {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}
/**
 * The box (D31, D34; boards Hem and Samtal): Astryx's ChatComposer, in the page flow on Hem and docked by ChatLayout in a
 * conversation. Above the field, whom it talks to (`Recipient`, D125 item 5) and, while that is another system's
 * assistant, what leaves Clew. The chips the person pointed at sit in the composer's drawer as removable tokens; `@` in
 * the field inserts a token for anything on the page. With one chip and nothing typed the footer offers the verbs about
 * it. The row keeps focus throughout; sending never moves it. `about` is what the conversation's page is about by its
 * address, the thing beside the transcript: it goes with every question and is drawn beside, not in the drawer.
 */
export function Composer({
  place,
  near = [],
  about,
  placeholder: aboutPlaceholder,
  recipientMenu,
}: {
  place: ComposerPlace;
  near?: string[];
  about?: ChipRef[] | undefined;
  /** What the empty box says in a conversation about someone ("Fråga om Johan"); else whom it writes to. */
  placeholder?: string | undefined;
  /** The "Till:" menu's open state, where the page opens it from outside the box (`RecipientMenu`). */
  recipientMenu?: RecipientMenu | undefined;
}) {
  const talk = useConversation();
  // While a conversation's own box is on the page, "Lägg till i samtalet" is offered: no other page has a box.
  useClaimBox(place === 'conversation');
  // A token and an `@` row carry the glyph of the system the ref belongs to (D71, artboard 8): the glyph beside the word, no hue.
  const markOf = useObjectMark();
  const glyph = (ref: string, threadId?: string) => {
    const icon = markOf(ref, threadId)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  // Hem's box hands the conversation nothing to ask about, only the way back: Esc returns to Hem as it stood. A
  // conversation's own box has nothing to hand over.
  const from: AskFrom | undefined = place === 'landing' ? { chips: [], search: '' } : undefined;
  // What `@` treats as the context: what the page shows (`near`), what is in the drawer and the field, and in a
  // conversation every card and row it has touched (the chips of its turns, a draft's card, a proposal's card).
  const context = useRef<string[]>([]);
  context.current = [
    ...new Set([
      ...near,
      ...talk.chipped,
      ...(place === 'conversation'
        ? (talk.conversation?.messages ?? []).flatMap(m => [
            ...(m.meta?.chips ?? []).map(c => c.ref),
            ...(m.meta?.draft ? ['thread:' + m.meta.draft.threadId] : []),
          ])
        : []),
      ...(place === 'conversation' && talk.latest?.forslag ? ['thread:' + talk.latest.forslag.threadId] : []),
    ]),
  ].slice(0, 40);
  // `@` in the row: with nothing typed, only the context; typing searches everything in scope with the context first.
  const trigger = useMemo<ChatComposerTrigger>(() => {
    const toItems = (objects: ClewObject[]): SearchableItem<ClewObject>[] =>
      objects.map(o => ({ id: o.ref, label: o.label, auxiliaryData: o }));
    return {
      character: '@',
      hasMultiWordQuery: true,
      menuLabel: 'Objekt',
      loadingText: 'Söker …',
      emptySearchText: 'Inget här matchar. Skriv för att söka bland alla ärenden, rader och system.',
      searchSource: {
        search: async q => toItems((await api.objects(q, context.current)).objects),
        bootstrap: async () => toItems((await api.objects('', context.current)).objects),
        cancel: () => undefined,
      },
      renderItem: item => {
        const o = (item as SearchableItem<ClewObject>).auxiliaryData;
        return <TypeaheadItem item={item} icon={o ? glyph(o.ref, o.threadId) : undefined} description={o?.detail} />;
      },
      onSelect: item => {
        const o = (item as SearchableItem<ClewObject>).auxiliaryData!;
        talk.rememberObject(o);
        return { value: tokenValue(o.ref), label: o.label, variant: 'neutral' };
      },
    };
  }, [talk.rememberObject, markOf]);
  // Handed to another system's assistant: the box says whom it talks to and takes no chips and no `@`.
  const handed = talk.handed;
  // Whom the box writes to, as the boards say it; Hem's says what the box is for.
  const placeholder = handed
    ? `Skriv till ${handed.name}`
    : place === 'conversation'
      ? (aboutPlaceholder ?? 'Skriv till Clew')
      : 'Fråga något eller be Clew göra det åt dig';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  const announced = useAddedAnnouncement(talk.chips);
  // Above the field, whom the box talks to (D125 item 5), on both boxes, when the person has another system's
  // assistant to ask: with none the box is Clew's and there is no one to choose.
  const assistants = useQuery(handoverAssistantsQuery).data ?? [];
  const choosable = assistants.length > 0 || !!talk.conversation?.handover;
  // While an answer is on its way the send button is Stoppa and the field stays open, so the person can write the next
  // question meanwhile (D36); Enter waits until the answer is written (the input empties itself on a submit, so it is
  // held back through the input's own key seam). Acting on a card's verbs still rests the whole box.
  return (
    <ChatComposer
      value={talk.value}
      onChange={talk.setValue}
      onSubmit={text => void talk.submit(text, from, about)}
      isDisabled={talk.busy && !talk.pending}
      /* While a turn runs the send button is Stop (D126 item 5); a suggestion waiting for the person's answer is no turn to stop. */
      isStopShown={!!talk.pending && !talk.pending.offer}
      onStop={talk.stop}
      density="compact"
      placeholder={placeholder}
      drawer={
        !handed && talk.chips.length > 0 ? (
          <Drawer count={talk.chips.length} label="Objekt i samtalet">
            {talk.chips.map(c => (
              <Chip
                key={c.ref}
                label={c.label}
                icon={glyph(c.ref)}
                onRemove={() => talk.removeChip(c.ref)}
                data-chip-remove=""
              />
            ))}
          </Drawer>
        ) : undefined
      }
      input={
        <ChatComposerInput
          handleRef={talk.input}
          label={handed ? `Fråga ${handed.name}` : place === 'conversation' ? 'Svara i samtalet' : 'Vad vill du göra'}
          maxRows={place === 'landing' ? 4 : 3}
          hasHistory={false}
          triggers={handed ? [] : [trigger]}
          placeholder={placeholder}
          onKeyDown={e => {
            if (talk.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      /* In a conversation the box is Clew's, always: another system's assistant is talked to in the panel beside it. */
      headerActions={
        choosable && place === 'landing' ? <Recipient isDisabled={talk.busy} menu={recipientMenu} /> : undefined
      }
      /* What leaves Clew while another system's assistant is asked (D125 items 4 and 5, board SamtalEneo). */
      headerContext={
        handed ? (
          <Text type="supporting" color="secondary">
            {`Det du skriver går till ${handed.source}. Inget annat ur samtalet följer med.`}
          </Text>
        ) : undefined
      }
      footerActions={
        <HStack gap={1} wrap="wrap">
          {/* The verbs about a card the person added with "Lägg till i samtalet", the one chip with nothing typed. */}
          {!handed && talk.chips.length === 1 && !plain && talk.verbs.length > 0 && (
            <HStack gap={1} wrap="wrap" role="group" aria-label="Om ärendet">
              {talk.verbs.map(v => (
                <Verb
                  key={v.id}
                  size="sm"
                  variant="ghost"
                  label={v.label}
                  isDisabled={talk.busy}
                  onClick={() => talk.ask(v.label, from, about)}
                />
              ))}
            </HStack>
          )}
          {!handed && <ModelMenu isDisabled={talk.busy} />}
          <VisuallyHidden role="status">{announced}</VisuallyHidden>
        </HStack>
      }
      sendActions={<Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
      /* While the box talks to another system's assistant it says so in the composer's own status line, above the
         field where it is read before the first word is written (D125 item 13, which D126 leaves as it is); an error
         takes its place. */
      status={
        talk.error
          ? { type: 'error', message: talk.error }
          : handed
            ? { type: 'warning', message: `Du skriver till ${handed.name} i ${handed.source}, inte till Clew.` }
            : undefined
      }
      statusPosition={!talk.error && handed ? 'top' : 'bottom'}
    />
  );
}
