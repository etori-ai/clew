import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClewObject } from '@clew/contracts';
import {
  AreaGlyph,
  Button,
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatDictationButton,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  HStack,
  Link,
  List,
  ListItem,
  Text,
  Token,
  TypeaheadItem,
  VisuallyHidden,
  useChatDictation,
  useEntryAnimation,
  useToast,
  type ChatComposerTrigger,
  type SearchableItem,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery } from './shell';
import { api } from '../api';
import { assistantQuery, completionsQuery, threadsQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage } from '../query-policy';
import { addDays, displayDate, shortDayLabel, timeLabel, today } from '@clew/calendar/dates';
import { tokenValue, useClaimBox, useConversation, type AskFrom } from './conversation-context';
import { useObjectMark } from '../marks';

/**
 * The model choice (D24), in the composer's footer slot that Astryx keeps for a model selector: the person's models
 * with what each is good for. It is there whenever a model answers, also when there is only one, so the box always says
 * which model the next question goes to (D36); without a model the router answers and there is nothing to choose.
 * Choosing saves their own preference on the server, which resolves the model on every question; the toast says which
 * one the next question uses.
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
 * Where the box sits decides what it says about itself (the canvas's rule H3.3: the scope line always says what the box
 * talks to). On Hem it is the page and says nothing above the field, also with a card open beside it: opening is not
 * asking (D111 rule 6), and a card is what the box asks about only once the person has added it as a chip. In a
 * conversation (H1) it says "Det här samtalet" with the way to a new question; at the foot of a tool's page (D50) the
 * placeholder says what the box asks about, or that it starts a new conversation, and the box keeps to one line.
 */
const STOP = new Set([
  'att',
  'och',
  'som',
  'för',
  'med',
  'den',
  'det',
  'ett',
  'jag',
  'vad',
  'hur',
  'när',
  'var',
  'min',
  'mitt',
  'mina',
  'har',
  'kan',
  'vill',
  'ska',
  'till',
  'från',
  'över',
  'om',
]);
/**
 * `thing` is the box at the foot of the panel beside an opened thing (D112 item 7): it asks about that thing only, so it
 * has no drawer, no `@`, no model menu and no verbs, and its placeholder names the thing ("Fråga om ärendet …").
 */
export type ComposerPlace = 'landing' | 'conversation' | 'page' | 'thing';
/** What a box asks about (D50): its name in the placeholder, and what the conversation takes with it. */
export type ComposerAbout = AskFrom & { label: string };
/** The landing's field is three lines tall from the start, as the `ai-chat-landing` template sets it on its `ChatComposerInput` (D41). */
const landingField = { minHeight: 84 };
/**
 * The box (D31, D34): Astryx's ChatComposer, in the page flow on the landing and docked by ChatLayout in a
 * conversation. The chips the person pointed at sit in the composer's drawer as removable tokens; `@` in the field
 * inserts a token for anything on the page. With one chip and nothing typed the footer offers the verbs about it. The
 * row keeps focus throughout; sending never moves it. `roomy` is the landing's box in the page flow (D41); docked on a
 * phone it keeps the field's own height.
 */
export function Composer({
  place,
  near = [],
  roomy = false,
  about,
}: {
  place: ComposerPlace;
  near?: string[];
  roomy?: boolean;
  about?: ComposerAbout | undefined;
}) {
  const talk = useConversation();
  // While a conversation's own box is on the page, "Lägg till i samtalet" is offered (D112 item 7): elsewhere an opened
  // thing has its own box beside it, which asks about that thing.
  useClaimBox(place === 'conversation');
  const thing = place === 'thing';
  // A token and an `@` row carry the glyph of the system the ref belongs to (D71, artboard 8): the glyph beside the word, no hue.
  const markOf = useObjectMark();
  const glyph = (ref: string, threadId?: string) => {
    const icon = markOf(ref, threadId)?.icon;
    return icon ? <AreaGlyph icon={icon} /> : undefined;
  };
  // A tool page's box hands the conversation what the page shows. Hem's box hands over nothing to ask about, only the
  // way back: the card or view open beside Hem goes beside the transcript and "Stäng samtalet" returns to Hem as it
  // stood (D111 rule 6). A conversation's own box has nothing to hand over.
  const from: AskFrom | undefined =
    place === 'conversation' ? undefined : { chips: about?.chips ?? [], search: about?.search ?? '' };
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
  const placeholder =
    place === 'conversation'
      ? 'Svara, eller @ för att peka på något …'
      : about
        ? `Fråga om ${about.label} …`
        : place === 'page'
          ? 'Nytt samtal: skriv eller säg vad du vill göra …'
          : 'Skriv eller säg vad du vill göra …';
  const plain = talk.value.replace(/@\[[^\]]+\]/g, '').trim();
  // The thing beside the box is named in the panel's header and in the placeholder; its chip is not drawn again here.
  const aboutChips = thing ? [] : (about?.chips ?? []).filter(c => !talk.chips.some(t => t.ref === c.ref));
  const announced = useAddedAnnouncement(talk.chips);
  const mobile = useMediaQuery(mobileQuery);
  // The scope line (H3.3): in a conversation, the conversation. Hem's box has none, also with a card open beside it.
  const scope =
    place === 'conversation' ? (
      <Text type="supporting">
        <Text as="span" weight="semibold" color="primary">
          Det här samtalet
        </Text>
        {mobile ? '' : '\u00a0· svaret kommer under frågan'}
      </Text>
    ) : undefined;
  // While an answer is on its way the send button is Stoppa and the field stays open, so the person can write the next
  // question meanwhile (D36); Enter waits until the answer is written (the input empties itself on a submit, so it is
  // held back through the input's own key seam). Acting on a card's verbs still rests the whole box.
  return (
    <ChatComposer
      value={talk.value}
      onChange={talk.setValue}
      onSubmit={text => void talk.submit(text, from)}
      isDisabled={talk.busy && !talk.pending}
      isStopShown={!!talk.pending}
      onStop={talk.stop}
      density={place === 'landing' ? 'balanced' : 'compact'}
      placeholder={placeholder}
      drawer={
        talk.chips.length > 0 || aboutChips.length > 0 ? (
          <Drawer
            {...(talk.chips.length > 0 ? { count: talk.chips.length + aboutChips.length } : {})}
            label="Objekt i samtalet"
          >
            {/* What a tool page's box asks about: the page's own view as a token, which stays while the page does. */}
            {aboutChips.map(c => (
              <Chip key={c.ref} label={c.label} icon={glyph(c.ref)} />
            ))}
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
          label={place === 'conversation' ? 'Svara i samtalet' : thing ? 'Fråga Clew' : 'Vad vill du göra'}
          maxRows={place === 'landing' ? 4 : 3}
          style={place === 'landing' && roomy ? landingField : undefined}
          hasHistory={false}
          triggers={thing ? [] : [trigger]}
          placeholder={placeholder}
          onKeyDown={e => {
            if (talk.pending && e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
        />
      }
      headerActions={scope}
      headerContext={
        place === 'conversation' ? (
          <Link
            href="/"
            onClick={e => {
              e.preventDefault();
              talk.newConversation();
            }}
          >
            Ny fråga i stället
          </Link>
        ) : undefined
      }
      footerActions={
        <HStack gap={1} wrap="wrap">
          {/* The verbs about a card the person added with "Lägg till i samtalet", the one chip with nothing typed;
              a card merely open beside Hem brings none (D111 rule 6). */}
          {!thing && talk.chips.length === 1 && !plain && talk.verbs.length > 0 && (
            <HStack gap={1} wrap="wrap" role="group" aria-label="Om ärendet">
              {talk.verbs.map(v => (
                <Verb
                  key={v.id}
                  size="sm"
                  variant="ghost"
                  label={v.label}
                  isDisabled={talk.busy}
                  onClick={() => talk.ask(v.label, from)}
                />
              ))}
            </HStack>
          )}
          {place !== 'page' && !thing && <ModelMenu isDisabled={talk.busy} />}
          <VisuallyHidden role="status">{announced}</VisuallyHidden>
        </HStack>
      }
      sendActions={<Dictation onResult={text => talk.setValue((talk.value + ' ' + text).trim())} />}
      status={talk.error ? { type: 'error', message: talk.error } : undefined}
    />
  );
}

/**
 * "Menar du" under the box while the person types (G): what the router finds without the model (D8), an open card that
 * matches first, then the connectors' standing actions, then the questions a connector answers, then an earlier conversation to continue. A read
 * opens its view, everything else is asked in the box, a conversation opens. Nothing here waits for the model.
 */
export function Suggestions({
  viewHref,
  cardHref,
}: {
  viewHref: (capability: string, title: string) => string;
  cardHref: (threadId: string) => string;
}) {
  const talk = useConversation();
  const navigate = useNavigate();
  const completions = useQuery(completionsQuery).data;
  const threads = useQuery(threadsQuery).data?.threads;
  const query = talk.value
    .replace(/@\[[^\]]+\]/g, '')
    .trim()
    .toLowerCase();
  if (!completions || query.length < 2) return null;
  // Word stems, so "faktura" finds "fakturor"; short words and the little words of a question find nothing on their own.
  const words = query
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
    .map(w => (w.length > 5 ? w.slice(0, w.length - 2) : w));
  const hits = (text: string) => {
    const t = text.toLowerCase();
    return t !== query && words.length > 0 && words.some(w => t.includes(w));
  };
  const todayDate = today();
  const when = (at: string) => {
    const day = displayDate(at);
    return day === todayDate
      ? timeLabel(at)
      : day === addDays(todayDate, -1)
        ? `i går ${timeLabel(at)}`
        : shortDayLabel(day);
  };
  // The card the push already made comes first: asking for it and being told about it land on the same card (G).
  const cards = (threads ?? []).filter(t => t.state === 'open' && t.kind === 'pushed' && hits(t.title));
  const rows = [
    ...cards.map(t => ({
      key: 'card:' + t.id,
      label: t.title,
      detail: `${t.trigger.source}\u00a0· öppnar ärendet`,
      go: () => navigate(cardHref(t.id)),
    })),
    ...completions.do
      .filter(d => hits(d.text))
      .map(d => ({
        key: 'do:' + d.capability,
        label: d.text,
        detail: `${d.source}\u00a0· ${d.kind === 'read' ? 'öppnar vyn' : 'öppnar ärendet'}`,
        go: () => (d.kind === 'read' ? navigate(viewHref(d.capability, d.text)) : talk.ask(d.text)),
      })),
    ...completions.ask
      .filter(a => hits(a.text))
      .map(a => ({
        key: 'ask:' + a.capability,
        label: a.text,
        detail: `${a.source}\u00a0· svarar utan modellen`,
        go: () => talk.ask(a.text),
      })),
    ...completions.recent
      .filter(r => hits(r.title))
      .map(r => ({
        key: 'recent:' + r.conversationId,
        label: `Fortsätt samtalet\u00a0· ${r.title}`,
        detail: when(r.at),
        go: () => navigate(`/conversations/${r.conversationId}`),
      })),
  ].slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <List
      density="compact"
      hasDividers
      header={
        <Text type="supporting" weight="semibold">
          Menar du
        </Text>
      }
    >
      {rows.map(r => (
        <ListItem
          key={r.key}
          label={<Text>{r.label}</Text>}
          endContent={<Text type="supporting">{r.detail}</Text>}
          onClick={r.go}
        />
      ))}
    </List>
  );
}
